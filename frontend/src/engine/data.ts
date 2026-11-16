// Static data loading and coordinate handling for the in-browser engine.
// Engine geometry is TUREF/TM30 (EPSG:5254, metres); the map shows WGS84.
import proj4 from 'proj4'

proj4.defs('EPSG:5254', '+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')
proj4.defs('EPSG:32635', '+proj=utm +zone=35 +ellps=WGS84 +datum=WGS84 +units=m +no_defs')
const TM = proj4('EPSG:4326', 'EPSG:5254')

export type XY = [number, number]
export type Ring = XY[]
export type Poly = Ring[]          // exterior + holes

export const toTM = (lon: number, lat: number): XY => TM.forward([lon, lat]) as XY
export const toLL = (x: number, y: number): XY => TM.inverse([x, y]) as XY

export interface Grid { x0: number; ytop: number; res: number; w: number; h: number; corners: XY[] }
export interface Building { p: Poly[]; h: number; t: string; k: number | null; s: string; in: boolean }
export interface Tree { x: number; y: number; h: number; d: number; no: number | null; tr: string; la: string; sa: string; es: string; bk: string; yeni?: boolean }
export interface TransferPoint { tur: string; ad: string; hat: string; x: number; y: number; yontem: string; bel: number }
export interface TransferPath { from: string; to: string; pair: string; dist_m: number; c: XY[] }
export interface Overlay { file: string; corners: XY[]; px_m: number }

export interface Meta {
  grid: Grid
  walk: { x0: number; ytop: number; res: number; w: number; h: number }
  classes: Record<string, number>
  materials: Record<string, number>
  layers: Record<string, any>
  literature: any
  ortho: Overlay
  insitu: Overlay
  lst?: { file: string; title: string; date: string; source: string; notes: string; yorum: any; kalibrasyon: any }
}

export interface Data {
  meta: Meta
  cls: Record<'mevcut' | 'proje', Uint8Array>
  mat: Record<'mevcut' | 'proje', Uint8Array>
  constraints: { heritage: Uint8Array; priv: Uint8Array; commercial: Uint8Array }
  walk: Uint8Array
  buildings: Building[]
  trees: Tree[]
  infra: { k: string; c: XY[] }[]
  transfer: TransferPoint[]
  paths: TransferPath[]
  boundary: Poly[]
}

export const DATA_URL = 'data/'

async function json<T>(f: string): Promise<T> {
  const r = await fetch(DATA_URL + f)
  if (!r.ok) throw new Error(`${f} yüklenemedi (${r.status})`)
  return r.json()
}

async function pixels(f: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const r = await fetch(DATA_URL + f)
  const blob = await r.blob()
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height }
}

function channel(p: { data: Uint8ClampedArray; w: number; h: number }, ch: number, mask = false) {
  const out = new Uint8Array(p.w * p.h)
  for (let i = 0, j = ch; i < out.length; i++, j += 4) out[i] = mask ? (p.data[j] > 127 ? 1 : 0) : p.data[j]
  return out
}

let cache: Promise<Data> | null = null

export function loadData(onProgress?: (s: string) => void): Promise<Data> {
  if (cache) return cache
  cache = (async () => {
    onProgress?.('Veri yükleniyor…')
    const meta = await json<Meta>('meta.json')
    const [cm, cp, cons, wk, buildings, trees, infra, transfer, paths, boundary] = await Promise.all([
      pixels('classes_mevcut.png'), pixels('classes_proje.png'), pixels('constraints.png'), pixels('walk.png'),
      json<Building[]>('buildings.json'), json<Tree[]>('trees.json'), json<{ k: string; c: XY[] }[]>('infra_tm.json'),
      json<TransferPoint[]>('transfer_tm.json'), json<TransferPath[]>('transfer_paths_tm.json'), json<Poly[]>('boundary_tm.json'),
    ])
    return {
      meta,
      cls: { mevcut: channel(cm, 0), proje: channel(cp, 0) },
      mat: { mevcut: channel(cm, 1), proje: channel(cp, 1) },
      constraints: { heritage: channel(cons, 0, true), priv: channel(cons, 1, true), commercial: channel(cons, 2, true) },
      walk: channel(wk, 0, true),
      buildings, trees, infra, transfer, paths, boundary,
    }
  })()
  return cache
}

// ------------------------------------------------------------------ GeoJSON <-> TM30 polygons
export function geomToPolys(g: GeoJSON.Geometry): Poly[] {
  const conv = (r: number[][]): Ring => r.map(([lon, lat]) => toTM(lon, lat))
  if (g.type === 'Polygon') return [g.coordinates.map(conv)]
  if (g.type === 'MultiPolygon') return g.coordinates.map(p => p.map(conv))
  return []
}

export function geomToLine(g: GeoJSON.Geometry): XY[] {
  if (g.type === 'LineString') return g.coordinates.map(([lon, lat]) => toTM(lon, lat))
  if (g.type === 'MultiLineString') return g.coordinates.flat().map(([lon, lat]) => toTM(lon, lat))
  return []
}

export function geomToPoint(g: GeoJSON.Geometry): XY | null {
  if (g.type === 'Point') return toTM(g.coordinates[0], g.coordinates[1])
  return null
}

export function polysToGeom(ps: Poly[]): GeoJSON.Geometry {
  const conv = (r: Ring) => r.map(([x, y]) => toLL(x, y))
  return ps.length === 1 ? { type: 'Polygon', coordinates: ps[0].map(conv) } : { type: 'MultiPolygon', coordinates: ps.map(p => p.map(conv)) }
}

export const lineToGeom = (l: XY[]): GeoJSON.Geometry => ({ type: 'LineString', coordinates: l.map(([x, y]) => toLL(x, y)) })
export const pointToGeom = ([x, y]: XY): GeoJSON.Geometry => ({ type: 'Point', coordinates: toLL(x, y) })

export function ringArea(r: Ring) {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return Math.abs(a / 2)
}
export const polyArea = (ps: Poly[]) => ps.reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((t, h) => t + ringArea(h), 0), 0)

export function pointInRing([x, y]: XY, r: Ring) {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export const pointInPolys = (p: XY, ps: Poly[]) => ps.some(poly => pointInRing(p, poly[0]) && !poly.slice(1).some(h => pointInRing(p, h)))

export function segDist([px, py]: XY, [ax, ay]: XY, [bx, by]: XY) {
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
export const distToLine = (p: XY, l: XY[]) => { let m = Infinity; for (let i = 1; i < l.length; i++) m = Math.min(m, segDist(p, l[i - 1], l[i])); return m }
export const distToRing = (p: XY, r: Ring) => distToLine(p, r)

export function bboxOf(ps: Poly[] | XY[][]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (a: any) => { if (typeof a[0] === 'number') { b[0] = Math.min(b[0], a[0]); b[1] = Math.min(b[1], a[1]); b[2] = Math.max(b[2], a[0]); b[3] = Math.max(b[3], a[1]) } else a.forEach(walk) }
  walk(ps)
  return b
}

export const lineLength = (l: XY[]) => l.reduce((s, p, i) => i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0, 0)
