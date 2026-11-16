// In-browser ingestion of user data: detect type, check CRS, build metadata, prepare a map overlay.
// A layer without a usable CRS is never placed on the map silently.
import proj4 from 'proj4'
import { fromArrayBuffer } from 'geotiff'
import { kml } from '@tmcw/togeojson'
import shp from 'shpjs'
import { bboxOf, pointInPolys, toTM, type Data, type Poly, type XY } from './data'

export interface Upload {
  id: string; name: string; kind: 'vector' | 'raster' | 'table' | 'document'; created_at: string
  metadata: Record<string, any>
  geojson?: GeoJSON.FeatureCollection
  raster?: { values: Float32Array; w: number; h: number; toLL: (c: number, r: number) => XY; nodata: number | null; canvas: HTMLCanvasElement; corners: XY[]; p2: number; p98: number }
}

const KNOWN: Record<number, string> = { 4326: 'EPSG:4326', 3857: 'EPSG:3857', 32635: 'EPSG:32635', 5254: 'EPSG:5254' }
const uid = () => Math.random().toString(36).slice(2, 10)

function siteOverlap(D: Data, b: number[]) {
  const [x0, y0, x1, y1] = bboxOf(D.boundary)
  const ll0 = proj4('EPSG:5254', 'EPSG:4326', [x0, y0]), ll1 = proj4('EPSG:5254', 'EPSG:4326', [x1, y1])
  return !(b[2] < ll0[0] || b[0] > ll1[0] || b[3] < ll0[1] || b[1] > ll1[1])
}

function fcBounds(fc: GeoJSON.FeatureCollection) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c: any) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]) } else c.forEach(walk) }
  fc.features.forEach(f => f.geometry && 'coordinates' in f.geometry && walk(f.geometry.coordinates))
  return b
}

function reproject(fc: GeoJSON.FeatureCollection, from: string): GeoJSON.FeatureCollection {
  const tr = proj4(from, 'EPSG:4326')
  const walk = (c: any): any => (typeof c[0] === 'number' ? tr.forward([c[0], c[1]]) : c.map(walk))
  return { ...fc, features: fc.features.map(f => ({ ...f, geometry: f.geometry && 'coordinates' in f.geometry ? { ...f.geometry, coordinates: walk(f.geometry.coordinates) } as any : f.geometry })) }
}

function ramp(t: number): [number, number, number] {
  // diverging blue → pale → red (same poles as the charts)
  const a: [number, number, number] = [42, 120, 214], m: [number, number, number] = [240, 239, 236], b: [number, number, number] = [227, 73, 72]
  const lerp = (p: number[], q: number[], k: number) => p.map((v, i) => Math.round(v + (q[i] - v) * k)) as [number, number, number]
  return t < 0.5 ? lerp(a, m, t * 2) : lerp(m, b, (t - 0.5) * 2)
}

export async function ingest(D: Data, file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer>; text: () => Promise<string> }, crsHint: string): Promise<Upload> {
  const name = file.name
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const meta: Record<string, any> = { dosya: name, uzanti: '.' + ext, boyut_kb: Math.round(file.size / 1024), uyarilar: [] as string[] }
  const base = { id: uid(), name, created_at: new Date().toISOString().slice(0, 19), metadata: meta }
  const hint = crsHint.trim().toUpperCase()
  if (['tif', 'tiff'].includes(ext)) {
    const tiff = await fromArrayBuffer(await file.arrayBuffer())
    const img = await tiff.getImage()
    const geo = img.getGeoKeys?.() ?? {}
    const epsg = (geo as any).ProjectedCSTypeGeoKey ?? (geo as any).GeographicTypeGeoKey
    const crs = KNOWN[epsg] ?? (hint && proj4.defs(hint) ? hint : null)
    const w = img.getWidth(), h = img.getHeight()
    Object.assign(meta, { tur: 'raster', bant: img.getSamplesPerPixel(), boyut: [w, h], crs: crs ?? (epsg ? `EPSG:${epsg} (tanınmıyor)` : null), cozunurluk: img.getResolution().map(Math.abs) })
    if (!crs) { meta.uyarilar.push('Raster CRS içermiyor veya CRS desteklenmiyor (EPSG:4326, 3857, 32635, 5254). Haritaya eklenmedi.'); return { ...base, kind: 'document' } }
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution()
    const toLL = (c: number, r: number): XY => proj4(crs, 'EPSG:4326', [ox + c * rx, oy + r * ry]) as XY
    const ras = (await img.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>
    let nodata = img.getGDALNoData()
    const values = Float32Array.from(ras as any)
    // a second band holding only 0/255 (or 0/1) is a validity mask (e.g. GEE exports): masked pixels become NaN
    if (img.getSamplesPerPixel() >= 2) {
      const m = (await img.readRasters({ samples: [1], interleave: true })) as unknown as ArrayLike<number>
      const uniq = new Set<number>()
      for (let i = 0; i < m.length && uniq.size < 4; i++) uniq.add(m[i])
      if ([...uniq].every(u => u === 0 || u === 1 || u === 255)) {
        let n = 0
        for (let i = 0; i < values.length; i++) if (!m[i]) { values[i] = NaN; n++ }
        meta.uyarilar.push(`2. bant geçerlilik maskesi olarak kullanıldı (${n.toLocaleString('tr-TR')} piksel maskeli).`)
      }
    }
    if (nodata == null) {
      // no nodata tag: exact zeros far below the rest of the data are treated as "no data" (warned)
      let zeros = 0, minNZ = Infinity
      for (const v of values) { if (v === 0) zeros++; else if (isFinite(v)) minNZ = Math.min(minNZ, v) }
      if (zeros && minNZ > 5) { for (let i = 0; i < values.length; i++) if (values[i] === 0) values[i] = NaN; meta.uyarilar.push(`Nodata tanımsız; ${zeros.toLocaleString('tr-TR')} adet 0 değeri veri yok kabul edildi.`) }
      nodata = null
    }
    const valid = Array.from(values).filter(v => v !== nodata && isFinite(v)).sort((a, b) => a - b)
    const p2 = valid[Math.floor(valid.length * 0.02)], p98 = valid[Math.floor(valid.length * 0.98)]
    meta.istatistik = { min: valid[0], max: valid[valid.length - 1], ortalama: valid.reduce((s, v) => s + v, 0) / Math.max(1, valid.length), p2, p98 }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const id = new ImageData(w, h)
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v === nodata || !isFinite(v)) continue
      const [r, g, b] = ramp(Math.max(0, Math.min(1, (v - p2) / Math.max(1e-9, p98 - p2))))
      id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 190
    }
    cv.getContext('2d')!.putImageData(id, 0, 0)
    const corners = [toLL(0, 0), toLL(w, 0), toLL(w, h), toLL(0, h)]
    meta.renk_olcegi = { min_C: p2, max_C: p98, not: '%2–%98 değer aralığı mavi→kırmızı' }
    meta.alanla_cakisma = siteOverlap(D, [Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1]))])
    if (!meta.alanla_cakisma) meta.uyarilar.push('Raster çalışma alanıyla çakışmıyor; CRS hatalı olabilir.')
    return { ...base, kind: 'raster', raster: { values, w, h, toLL, nodata, canvas: cv, corners, p2, p98 } }
  }
  if (['png', 'jpg', 'jpeg', 'pdf'].includes(ext)) {
    meta.tur = 'belge'
    meta.uyarilar.push('Görsel/PDF belge olarak kaydedildi; koordinat bilgisi olmadığı için haritaya eklenmedi.')
    return { ...base, kind: 'document' }
  }
  let fc: GeoJSON.FeatureCollection
  let crs = 'EPSG:4326'
  if (ext === 'csv') {
    const text = await file.text()
    const rows = text.split(/\r?\n/).filter(Boolean)
    const sep = rows[0].includes(';') ? ';' : ','
    const head = rows[0].split(sep).map(s => s.trim().toLowerCase())
    const pair = [['lon', 'lat'], ['longitude', 'latitude'], ['boylam', 'enlem'], ['x', 'y']].find(([a, b]) => head.includes(a) && head.includes(b))
    Object.assign(meta, { tur: 'tablo', satir: rows.length - 1, sutunlar: head })
    if (!pair) { meta.uyarilar.push('Koordinat sütunu bulunamadı (lon/lat, x/y). Tablo olarak kaydedildi.'); return { ...base, kind: 'table' } }
    if (pair[0] === 'x') { if (!hint) { meta.uyarilar.push('x/y sütunları için CRS belirtilmedi; haritaya eklenmedi.'); return { ...base, kind: 'table' } } crs = hint }
    const [ix, iy] = [head.indexOf(pair[0]), head.indexOf(pair[1])]
    fc = { type: 'FeatureCollection', features: rows.slice(1).map(r => r.split(sep)).filter(c => c.length > Math.max(ix, iy)).map(c => ({
      type: 'Feature', properties: Object.fromEntries(head.map((h, i) => [h, c[i]])), geometry: { type: 'Point', coordinates: [Number(c[ix].replace(',', '.')), Number(c[iy].replace(',', '.'))] } })) }
  } else if (ext === 'kml') {
    fc = kml(new DOMParser().parseFromString(await file.text(), 'text/xml')) as GeoJSON.FeatureCollection
  } else if (ext === 'zip') {
    const r = await shp(await file.arrayBuffer())
    fc = (Array.isArray(r) ? { type: 'FeatureCollection', features: r.flatMap(x => x.features) } : r) as GeoJSON.FeatureCollection
    meta.uyarilar.push('Shapefile .prj ile WGS84\'e dönüştürüldü (prj yoksa koordinatlar olduğu gibi kullanılır).')
  } else if (['geojson', 'json'].includes(ext)) {
    const j = JSON.parse(await file.text())
    fc = j.type === 'FeatureCollection' ? j : { type: 'FeatureCollection', features: [j.type === 'Feature' ? j : { type: 'Feature', properties: {}, geometry: j }] }
    const named = j.crs?.properties?.name as string | undefined
    if (named) { const m = named.match(/EPSG::?(\d+)/); crs = m && KNOWN[Number(m[1])] ? KNOWN[Number(m[1])] : crs }
    else if (hint) crs = hint
  } else {
    meta.uyarilar.push(`.${ext} desteklenmiyor (GeoJSON, KML, Shapefile .zip, CSV, GeoTIFF yükleyin; KMZ/GeoPackage için önce GeoJSON'a dönüştürün).`)
    return { ...base, kind: 'document' }
  }
  if (crs !== 'EPSG:4326') {
    if (!proj4.defs(crs)) { meta.uyarilar.push(`${crs} tanınmıyor; haritaya eklenmedi.`); return { ...base, kind: 'document' } }
    fc = reproject(fc, crs)
  }
  const b = fcBounds(fc)
  Object.assign(meta, { tur: meta.tur ?? 'vektör', crs, obje: fc.features.length, sinirlar_wgs84: b })
  meta.alanla_cakisma = siteOverlap(D, b)
  if (!meta.alanla_cakisma) meta.uyarilar.push('Veri çalışma alanıyla çakışmıyor; CRS hatalı olabilir.')
  return { ...base, kind: 'vector', geojson: fc }
}

/** Mean raster value inside TM30 polygons (pixel centres), or null. */
export function zonalMean(u: Upload, ps: Poly[]) {
  if (!u.raster) return null
  const R = u.raster
  let s = 0, n = 0
  const [x0, y0, x1, y1] = bboxOf(ps)
  for (let r = 0; r < R.h; r++) for (let c = 0; c < R.w; c++) {
    const v = R.values[r * R.w + c]
    if (v === R.nodata || !isFinite(v)) continue
    const [lon, lat] = R.toLL(c + 0.5, r + 0.5)
    const p = toTM(lon, lat)
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1 || !pointInPolys(p, ps)) continue
    s += v; n++
  }
  return n ? Math.round((s / n) * 100) / 100 : null
}

export function heatStats(u: Upload, D: Data, pct = 90): any {
  const R = u.raster!
  const inside: number[] = []
  for (let r = 0; r < R.h; r++) for (let c = 0; c < R.w; c++) {
    const v = R.values[r * R.w + c]
    if (v === R.nodata || !isFinite(v)) continue
    const [lon, lat] = R.toLL(c + 0.5, r + 0.5)
    if (pointInPolys(toTM(lon, lat), D.boundary)) inside.push(v)
  }
  if (!inside.length) return { bos: true }
  const s = inside.slice().sort((a, b) => a - b)
  const thr = s[Math.floor(s.length * (pct / 100))]
  return { min: s[0], max: s[s.length - 1], ortalama: s.reduce((a, b) => a + b, 0) / s.length, esik_p: pct, esik_deger: thr, piksel: s.length,
    cozunurluk: u.metadata.cozunurluk, p2: R.p2, p98: R.p98 }
}

/** Build a raster upload from a plain grid (used for the built-in LST layer shipped as JSON). */
export function rasterFromGrid(D: Data, name: string, g: { w: number; h: number; crs: string; origin: number[]; res: number[]; values: (number | null)[] }): Upload {
  const crs = g.crs.toUpperCase().includes('4326') ? 'EPSG:4326' : g.crs
  const toLL = (c: number, r: number): XY => proj4(crs, 'EPSG:4326', [g.origin[0] + c * g.res[0], g.origin[1] + r * g.res[1]]) as XY
  const values = Float32Array.from(g.values.map(v => (v == null ? NaN : v)))
  const valid = Array.from(values).filter(v => isFinite(v)).sort((a, b) => a - b)
  const p2 = valid[Math.floor(valid.length * 0.02)], p98 = valid[Math.floor(valid.length * 0.98)]
  const cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h
  const id = new ImageData(g.w, g.h)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!isFinite(v)) continue
    const [r, gg, b] = ramp(Math.max(0, Math.min(1, (v - p2) / Math.max(1e-9, p98 - p2))))
    id.data[i * 4] = r; id.data[i * 4 + 1] = gg; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 190
  }
  cv.getContext('2d')!.putImageData(id, 0, 0)
  const corners = [toLL(0, 0), toLL(g.w, 0), toLL(g.w, g.h), toLL(0, g.h)]
  const metadata: Record<string, any> = { dosya: name, tur: 'raster', boyut: [g.w, g.h], crs, cozunurluk: g.res.map(Math.abs), uyarilar: [],
    istatistik: { min: valid[0], max: valid[valid.length - 1], ortalama: valid.reduce((s2, v) => s2 + v, 0) / Math.max(1, valid.length), p2, p98 },
    renk_olcegi: { min_C: p2, max_C: p98, not: '%2–%98 değer aralığı mavi→kırmızı' }, alanla_cakisma: true }
  void D
  return { id: Math.random().toString(36).slice(2, 10), name, kind: 'raster', created_at: '', metadata,
    raster: { values, w: g.w, h: g.h, toLL, nodata: null, canvas: cv, corners, p2, p98 } }
}
