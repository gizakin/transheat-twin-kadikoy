// KPIs for a state inside an analysis area, computed by counting cells of the 0.5 m analysis grid.
// Port of backend/app/core/kpi.py — same indicators, labels, method tags and "how was this computed" text.
import type { Kpi, Method } from '../types'
import { bboxOf, lineLength, pointInPolys, type Data, type Poly, type Tree, type TransferPoint, type XY } from './data'
import { distanceField, pathsFrom } from './network'
import { pointInPolys as pip } from './data'
import { cellOf, fullWindow, maskImage, polyMask, windowOf, type Window } from './raster'
import { crownMask, partialMasks, shadowMask, type Structure } from './shadow'
import { sunPosition, type Sun } from './sun'

export const C = { yesil: 1, gecirgen: 2, sert: 3, asfalt: 4, bina: 5, su: 6 }
export const PERM_BIT = 16

export interface EState {
  key: string; base: 'mevcut' | 'proje'; label: string
  cls: Uint8Array; mat: Uint8Array; alb: Uint8Array | null
  trees: Tree[]; structures: Structure[]; routes: XY[][]; extraTransfer: TransferPoint[]; notes: string[]
}

export function lit(D: Data, pid: string) {
  const L = D.meta.literature
  const p = L.parameters.find((x: any) => x.id === pid) ?? { id: pid, tanimlanmamis: true, parametre: pid }
  const s = L.sources[p.kaynak] ?? {}
  return { ...p, kaynak_kunye: s.kunye, calisma_alani: s.calisma_alani }
}
export const assumption = (D: Data, id: string) => D.meta.literature.assumptions.find((a: any) => a.id === id)

export function albedoRange(D: Data, code: number): [number, number] | null {
  const ids = code === 1 ? ['albedo_asfalt_yeni', 'albedo_asfalt_eski'] : code === 2 ? ['albedo_beton_yeni', 'albedo_beton_eski'] : null
  if (!ids) return null
  const v = ids.flatMap(i => lit(D, i).deger ?? [])
  return v.length ? [Math.min(...v), Math.max(...v)] : null
}
export const MATERIAL_CODE: Record<string, number> = { asfalt: 1, beton: 2 }

const pct = (a: number, b: number) => (b > 0 ? Math.round((10000 * a) / b) / 100 : null)
const kpi = (id: string, label: string, value: Kpi['value'], unit: string, method: Method, explain: Kpi['explain'], group = 'Kentsel tasarım'): Kpi =>
  ({ id, label, value, unit, method, explain, group })
const ex = (veri_kaynagi: string, veri_tarihi: string, parametre: string, formul: string, literatur: string[] = [], varsayim: any[] = [], belirsizlik = '') =>
  ({ veri_kaynagi, veri_tarihi, parametre, formul, literatur, varsayim, belirsizlik })

const ORTHO_NOTE = 'Ortofoto çekim tarihi bilinmiyor'
const GRID_NOTE = '0,5 m analiz ızgarasında hücre sayımı'

export interface Computed {
  kpis: Kpi[]; sun: Sun; area_m2: number
  raw: { a_open: number; a_sh: number; a_yesil: number; a_hard: number; a_crown: number; a_exposed: number; n_trees: number; a_gec: number }
  shadow: { win: Window; mask: Uint8Array }
}

/** Opaque shadow on open ground, restricted to the area, as a window mask (for display and diffs). */
export function compute(D: Data, st: EState, area: Poly[], time: string, rasterValue: number | null = null): Computed {
  const G = D.meta.grid
  const res2 = G.res * G.res
  const win = windowOf(G, bboxOf(area), 1)
  const A = polyMask(G, area, win)
  const sun = sunPosition(time)
  const sh = shadowMask(G, win, sun, D.buildings, st.trees, st.structures)
  const partial = partialMasks(G, win, sun, st.structures)
  const crowns = crownMask(G, win, st.trees.filter(t => { const b = bboxOf(area); return t.x > b[0] - 15 && t.x < b[2] + 15 && t.y > b[1] - 15 && t.y < b[3] + 15 }))
  let land = 0, bina = 0, open = 0, yesil = 0, gec = 0, hard = 0, permPaved = 0, crown = 0, shN = 0, partialW = 0, exposed = 0
  let albA = 0, albLo = 0, albHi = 0
  const shOpen = new Uint8Array(win.w * win.h)
  for (let r = 0; r < win.h; r++) {
    for (let c = 0; c < win.w; c++) {
      const i = r * win.w + c
      if (!A[i]) continue
      const g = (win.y + r) * G.w + win.x + c
      const cl = st.cls[g]
      if (!cl) continue
      land++
      if (cl === C.bina) { bina++; continue }
      if (cl === C.su) continue
      open++
      const isHard = cl === C.sert || cl === C.asfalt
      const perm = (st.mat[g] & PERM_BIT) !== 0
      if (cl === C.yesil) yesil++
      else if (cl === C.gecirgen) gec++
      else if (isHard) { hard++; if (perm) permPaved++ }
      if (crowns[i]) crown++
      let p = 0
      if (sh[i]) { shN++; shOpen[i] = 1 } else for (const pm of partial) if (pm.mask[i]) p = Math.max(p, pm.op)
      partialW += p
      if (isHard) {
        if (!sh[i]) exposed += 1 - p
        const custom = st.alb ? st.alb[g] : 0
        if (custom) { albA++; albLo += custom / 100; albHi += custom / 100 }
        else {
          const rng = albedoRange(D, st.mat[g] & 15)
          if (rng) { albA++; albLo += rng[0]; albHi += rng[1] }
        }
      }
    }
  }
  const a = (n: number) => n * res2
  const nTrees = st.trees.filter(t => pointInPolys([t.x, t.y], area) && st.cls[cellOf(G, [t.x, t.y])] > 0).length
  const meta = D.meta.layers
  let surfSrc = (meta[st.base === 'mevcut' ? 'surfaces_existing' : 'surfaces_project'] ?? {}).source ?? ''
  if (st.key !== 'mevcut' && st.key !== 'proje') surfSrc += ' + senaryo müdahaleleri (kullanıcı tanımlı)'
  const aVeg = assumption(D, 'veg_threshold'), hardAs = assumption(D, 'hard_surface_impervious')
  const shAs = ['flat_terrain_shadow', 'opaque_canopy', 'tree_crown_shape', 'storey_height'].map(x => assumption(D, x))
  const sunTxt = `güneş yüksekliği ${sun.elevation.toFixed(1)}°, azimut ${sun.azimuth.toFixed(1)}° (${time}, NOAA güneş konumu algoritması)`
  const aOpen = a(open)
  const ks: Kpi[] = [
    kpi('alan', 'Analiz alanı (kara)', Math.round(a(land)), 'm²', 'geometric', ex('Çalışma alanı sınırı, kara maskesi', '—', GRID_NOTE, 'alan(seçili alan ∩ kara)')),
    kpi('yesil_oran', 'Yeşil alan oranı', pct(yesil, open), '%', 'data', ex(surfSrc, ORTHO_NOTE, `ExG eşiği ${aVeg?.deger}`, 'alan(yeşil) / alan(açık zemin) × 100', [], [aVeg],
      'Ortofoto RGB indeksi gölgede kalan bitkiyi kaçırabilir; çim/çalı ayrımı yapılmaz.')),
    kpi('yesil_m2', 'Yeşil alan', Math.round(a(yesil)), 'm²', 'data', ex(surfSrc, ORTHO_NOTE, GRID_NOTE, 'alan(yeşil ∩ analiz alanı)')),
    kpi('gecirgen_oran', 'Geçirgen yüzey oranı', pct(yesil + gec + permPaved, open), '%', 'geometric', ex(surfSrc, ORTHO_NOTE,
      'geçirgen = yeşil ∪ ağaç kabuğu ∪ geçirgen kaplama', 'alan(geçirgen) / alan(açık zemin) × 100', [], [hardAs])),
    kpi('sert_oran', 'Sert zemin oranı', pct(hard - permPaved, open), '%', 'geometric', ex(surfSrc, ORTHO_NOTE, 'sert = sert zemin ∪ asfalt − geçirgen kaplama',
      'alan(sert) / alan(açık zemin) × 100', [], [hardAs], 'Mevcut durumda sert zemin, kalan alan olarak türetilmiştir.')),
    kpi('bina_oran', 'Yapı izi oranı', pct(bina, land), '%', 'data', ex('Halihazır bina poligonları / proje yapıları', 'bilinmiyor', '—', 'alan(bina) / alan(kara) × 100')),
    kpi('agac_sayisi', 'Ağaç sayısı', nTrees, 'adet', 'data', ex(meta.trees?.source ?? '', '2020-06', '—', 'sayı(ağaç ∈ alan)', [], [], meta.trees?.notes ?? '')),
    kpi('agac_yogunluk', 'Ağaç yoğunluğu', aOpen > 0 ? Math.round((10 * nTrees) / (aOpen / 10000)) / 10 : null, 'adet/ha', 'geometric',
      ex(meta.trees?.source ?? '', '2020-06', '—', 'ağaç sayısı / açık zemin (ha)')),
    kpi('agac_tac_oran', 'Ağaç taç örtüsü oranı', pct(crown, open), '%', 'geometric', ex('Ağaç rölevesi taç çapları', '2020-06', 'taç = daire (çap rölöveden)',
      'alan(∪ taç ∩ açık zemin) / alan(açık zemin) × 100')),
    kpi('golge_oran', 'Gölgeli alan oranı', pct(shN + partialW, open), '%', 'geometric', ex('Bina yükseklikleri (halihazır), ağaç boy/taç (rölöve), gölgeleme elemanları (senaryo)', '—', sunTxt,
      'alan(gölge ∩ açık zemin) / alan(açık zemin) × 100; kısmi gölgeleme elemanı opaklık oranıyla ağırlıklandırılır', [], shAs,
      'Gölge, yatay zemin varsayımıyla ve meteorolojik koşul (bulutluluk) dikkate alınmadan hesaplanmıştır.'), 'Gölge'),
    kpi('golgeli_yaya_m2', 'Gölgeli yaya (açık zemin) alanı', Math.round(a(shN + partialW)), 'm²', 'geometric', ex('Gölge hesabı', '—', sunTxt,
      'alan(gölge ∩ (kara − bina − su))', [], shAs, 'Açık zeminin tamamı yaya kullanımına açık kabul edilmiştir (taşıt yolları ayrıştırılamadı).'), 'Gölge'),
    kpi('gunes_acik_sert_m2', 'Güneşe açık sert zemin (ısı maruziyeti vekili)', Math.round(Math.max(a(exposed), 0)), 'm²', 'geometric',
      ex('Yüzey sınıfları + gölge hesabı', '—', sunTxt, 'alan(sert zemin − gölge)', [], [...shAs, hardAs],
        'Bu bir sıcaklık değeri değildir; güneş alan geçirimsiz yüzeyin geometrik büyüklüğüdür.'), 'Isı'),
    albA > 0
      ? kpi('albedo', 'Alan ağırlıklı albedo (tanımlı yüzeylerde)', `${(albLo / albA).toFixed(2)}–${(albHi / albA).toFixed(2)}`, '—', 'literature',
        ex('Malzeme sınıfı (CAD/senaryo)', '—', 'Albedo aralıkları: literatür kütüphanesi', 'Σ(alan × albedo) / Σ alan', ['santamouris2013'], [],
          `Yalnızca sert zeminin %${pct(albA, hard)}'ında malzeme albedosu tanımlıdır.`), 'Isı')
      : kpi('albedo', 'Alan ağırlıklı albedo', 'Literatür parametresi tanımlanmamış', '—', 'literature',
        ex('Malzeme sınıfı', '—', '—', '—', [], [], 'Bu alandaki sert zemin malzemeleri için doğrulanmış albedo değeri yoktur.'), 'Isı'),
    kpi('lst', 'Yüzey sıcaklığı (uydu)', rasterValue ?? 'Bu analiz için veri bulunmamaktadır', rasterValue != null ? '°C' : '—', 'data',
      ex(rasterValue != null ? 'Yüklenen GeoTIFF ısı haritası' : '—', 'raster metaverisi', '—', rasterValue != null ? 'ortalama(piksel ∈ alan)' : '—', [], [],
        'Uydu LST\'si yüzey (deri) sıcaklığıdır; hava sıcaklığı veya termal konfor değildir.'), 'Isı'),
    kpi('termal_konfor', 'Termal konfor (Tmrt / UTCI / PET)', 'Model çalıştırılmadı', '—', 'model', ex('—', '—', '—', '—', [], [],
      'Meteorolojik veri ve fiziksel mikroklima modeli (ör. SOLWEIG) bulunmadığından hesaplanmamıştır. Senaryo sonuçlarında yalnızca literatür tabanlı etki aralıkları verilir.'), 'Isı'),
  ]
  return {
    kpis: ks, sun, area_m2: Math.round(a(land)),
    raw: { a_open: aOpen, a_sh: a(shN + partialW), a_yesil: a(yesil), a_hard: a(hard), a_crown: a(crown), a_exposed: a(exposed), n_trees: nTrees, a_gec: a(gec + permPaved) },
    shadow: { win, mask: shOpen },
  }
}

export function shadowOverlay(D: Data, s: Computed['shadow'], rgba: [number, number, number, number] = [31, 42, 68, 110]) {
  return maskImage(D.meta.grid, s.mask, s.win, rgba)
}

// ------------------------------------------------------------------ transport
const PAIRS: [string, string][] = [['iskele', 'metro'], ['iskele', 'otobus'], ['metro', 'otobus'], ['iskele', 'minibus'], ['metro', 'minibus']]

export interface TPath { from: string; to: string; pair: string; dist_m: number; c: XY[]; shaded_pct?: number }

export function transferPaths(D: Data, extra: TransferPoint[]): TPath[] {
  let paths: TPath[] = D.paths.map(p => ({ ...p }))
  for (const e of extra) {
    const others = D.transfer.concat(extra.filter(x => x !== e))
    const rel = others.filter(o => PAIRS.some(([a, b]) => (a === e.tur && b === o.tur) || (b === e.tur && a === o.tur)))
    const res = pathsFrom(D, [e.x, e.y], rel.map(o => [o.x, o.y]))
    // e as origin: nearest target per pair type
    for (const [a, b] of PAIRS) {
      if (a === e.tur) {
        const cands = rel.map((o, i) => ({ o, r: res[i] })).filter(x => x.o.tur === b && x.r.d != null)
        const best = cands.sort((x, y) => x.r.d! - y.r.d!)[0]
        if (best) paths.push({ from: e.ad, to: best.o.ad, pair: `${a}→${b}`, dist_m: Math.round(best.r.d!), c: best.r.path })
      }
      if (b === e.tur) {
        rel.forEach((o, i) => {
          if (o.tur !== a || res[i].d == null) return
          const cur = paths.find(p => p.from === o.ad && p.pair === `${a}→${b}`)
          if (!cur || res[i].d! < cur.dist_m) {
            paths = paths.filter(p => p !== cur)
            paths.push({ from: o.ad, to: e.ad, pair: `${a}→${b}`, dist_m: Math.round(res[i].d!), c: res[i].path.slice().reverse() })
          }
        })
      }
    }
  }
  return paths
}

/** Shaded share of lines, sampled every metre against a site-wide shadow mask. */
export function shadedShare(D: Data, line: XY[], site: { win: Window; mask: Uint8Array }) {
  const G = D.meta.grid
  let tot = 0, sh = 0
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i]
    const L = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(1, Math.round(L))
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * (k + 0.5)) / n, y = y0 + ((y1 - y0) * (k + 0.5)) / n
      const col = Math.floor((x - G.x0) / G.res) - site.win.x, row = Math.floor((G.ytop - y) / G.res) - site.win.y
      tot += L / n
      if (col >= 0 && row >= 0 && col < site.win.w && row < site.win.h && site.mask[row * site.win.w + col]) sh += L / n
    }
  }
  return { tot, sh }
}

export function siteShadow(D: Data, st: EState, time: string) {
  const G = D.meta.grid
  const win = fullWindow(G)
  return { win, mask: shadowMask(G, win, sunPosition(time), D.buildings, st.trees, st.structures) }
}

export function transportKpis(D: Data, st: EState, time: string) {
  const site = siteShadow(D, st, time)
  const paths = transferPaths(D, st.extraTransfer)
  let tot = 0, shaded = 0
  for (const p of paths) {
    const s = shadedShare(D, p.c, site)
    p.shaded_pct = s.tot ? Math.round((1000 * s.sh) / s.tot) / 10 : 0
    tot += s.tot; shaded += s.sh
  }
  const routes = st.routes.map((r, i) => {
    const s = shadedShare(D, r, site)
    return { name: `Önerilen güzergâh ${i + 1}`, length_m: Math.round(lineLength(r)), shaded_pct: s.tot ? Math.round((1000 * s.sh) / s.tot) / 10 : 0, c: r }
  })
  const meanD = paths.length ? Math.round(paths.reduce((s, p) => s + p.dist_m, 0) / paths.length) : null
  const e = ex('Aktarma noktaları (CAD kümeleme + DURAKLAR.shp), yürünebilir yüzey (kara − bina)', 'bilinmiyor', '2 m maliyet ızgarası, 8-komşuluk',
    'en kısa yol (Dijkstra) her A noktasından en yakın B türü noktaya', [], [],
    'Taşıt yolları ayrıştırılamadığı için mesafeler iyimser alt sınırdır; T3 tramvay durakları veride yoktur; metro giriş/şaft ayrımı doğrulanamamıştır.')
  const acc = stopAccess(D, st)
  const sun = sunPosition(time)
  const ks: Kpi[] = [
    kpi('durak_erisim', 'İETT durağına ≤400 m yürüme mesafesindeki alan', acc.share, '%', 'geometric',
      ex('İETT aktif durakları (07.10.2026), yürünebilir yüzey (kara − deniz − bina, iskeleler dahil)', '2026-10-07',
        'eşik 400 m (≈5 dk yürüme), 2 m ızgara, 8-komşuluk', 'alan(çalışma alanında yürünebilir ve en yakın durağa ≤400 m) / alan(çalışma alanında yürünebilir) × 100', [], [],
        'Taşıt yolları ayrıştırılamadığı için mesafeler iyimser alt sınırdır; senaryodaki yeni otobüs durakları hesaba katılır.'), 'Ulaşım'),
    kpi('aktarma_ort_mesafe', 'Ortalama aktarma yürüme mesafesi', meanD, 'm', 'geometric', e, 'Ulaşım'),
    kpi('aktarma_golge', 'Aktarma güzergâhlarının gölgeli payı', tot ? Math.round((1000 * shaded) / tot) / 10 : null, '%', 'geometric',
      ex('Aktarma güzergâhları + gölge hesabı', '—', `güneş yüksekliği ${sun.elevation.toFixed(1)}°`, 'uzunluk(güzergâh ∩ gölge) / uzunluk(güzergâh) × 100'), 'Ulaşım'),
  ]
  for (const r of routes) {
    ks.push(kpi(`rota_${r.name}`, `${r.name} uzunluğu`, r.length_m, 'm', 'geometric', ex('Kullanıcının çizdiği güzergâh', '—', '—', 'uzunluk(çizgi)'), 'Ulaşım'))
    ks.push(kpi(`rota_golge_${r.name}`, `${r.name} gölgeli payı`, r.shaded_pct, '%', 'geometric', ex('Güzergâh + gölge hesabı', '—', '—', 'uzunluk(güzergâh ∩ gölge) / uzunluk × 100'), 'Ulaşım'))
  }
  return { kpis: ks, paths, routes, site, access: acc }
}

// ------------------------------------------------------------------ stop accessibility
let siteWalkMask: Uint8Array | null = null
const accessCache = new Map<string, { share: number; dist: Float32Array }>()

/** Share of walkable study-area cells within 400 m walking distance of an İETT stop (scenario stops included). */
export function stopAccess(D: Data, st: EState) {
  const extra = st.extraTransfer.filter(e => e.tur === 'otobus')
  const key = extra.map(e => `${e.x.toFixed(1)},${e.y.toFixed(1)}`).join(';')
  if (accessCache.has(key)) return accessCache.get(key)!
  const W = D.meta.walk
  if (!siteWalkMask) {
    siteWalkMask = new Uint8Array(W.w * W.h)
    for (let r = 0; r < W.h; r++) for (let c = 0; c < W.w; c++) {
      const i = r * W.w + c
      if (D.walk[i] && pip([W.x0 + (c + 0.5) * W.res, W.ytop - (r + 0.5) * W.res], D.boundary)) siteWalkMask[i] = 1
    }
  }
  const src: XY[] = [...D.transfer.filter(t => t.tur === 'otobus').map(t => [t.x, t.y] as XY), ...extra.map(e => [e.x, e.y] as XY)]
  const dist = distanceField(D, src)
  let n = 0, ok = 0
  for (let i = 0; i < dist.length; i++) if (siteWalkMask[i]) { n++; if (dist[i] <= 400) ok++ }
  const out = { share: n ? Math.round((1000 * ok) / n) / 10 : 0, dist }
  accessCache.set(key, out)
  return out
}

/** Distance bands (0–200, 200–400, >400 m) as a canvas overlay on the walk grid. */
export function accessCanvas(D: Data, dist: Float32Array) {
  const W = D.meta.walk
  const cv = document.createElement('canvas'); cv.width = W.w; cv.height = W.h
  const img = new ImageData(W.w, W.h)
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]
    if (!isFinite(d) || !D.walk[i]) continue
    const c = d <= 200 ? [27, 94, 32, 150] : d <= 400 ? [102, 187, 106, 120] : [230, 120, 40, 90]
    img.data.set(c, i * 4)
  }
  cv.getContext('2d')!.putImageData(img, 0, 0)
  return cv
}
