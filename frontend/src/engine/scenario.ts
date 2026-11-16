// Scenario engine — port of backend/app/core/scenario.py. Interventions modify a copy of the base state
// (class/material rasters, trees, structures, routes, transfer points); results compare base vs scenario.
import type { Kpi, ScenarioDef, ScenarioResult } from '../types'
import {
  bboxOf, distToLine, distToRing, geomToLine, geomToPoint, geomToPolys, lineToGeom, pointInPolys, pointToGeom, polyArea, polysToGeom,
  type Data, type Poly, type XY,
} from './data'
import { albedoRange, C, compute, lit, MATERIAL_CODE, PERM_BIT, shadowOverlay, transportKpis, type EState } from './kpi'
import { cellOf, maskImage, polyMask, windowOf } from './raster'
import { sunPosition } from './sun'

export const INTERVENTIONS: Record<string, string> = {
  tree_planting: 'Ağaçlandırma', green_conversion: 'Yeşil alan', hard_reduction: 'Sert zemini azalt (yeşile dönüştür)',
  shade_structure: 'Gölgeleme elemanı', pv_shading: 'Fotovoltaik gölgeleme', permeable_surface: 'Geçirgen yüzey',
  cool_pavement: 'Açık renkli / cool pavement', surface_change: 'Zemin malzemesi değişimi', pedestrian_route: 'Yaya güzergâhı', transfer_area: 'Aktarma alanı',
}
// material key → [label, class, permeable]
export const MATERIALS: Record<string, [string, number, boolean]> = {
  asfalt: ['Asfalt', C.asfalt, false], beton: ['Beton', C.sert, false], granit: ['Granit plak taş', C.sert, false], bazalt: ['Bazalt plak taş', C.sert, false],
  acik_renkli: ['Açık renkli kaplama (cool pavement)', C.sert, false], gecirgen_beton: ['Geçirgen beton / kaplama', C.sert, true],
  agac_kabugu: ['Ağaç kabuğu (malç)', C.gecirgen, true], cim: ['Çim', C.yesil, true],
}

const n0 = (x: number) => Math.round(x).toLocaleString('tr-TR')
const fmt2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2)

export function baseState(D: Data, key: 'mevcut' | 'proje'): EState {
  return {
    key, base: key, label: key === 'mevcut' ? 'Mevcut durum' : 'Proje durumu (İBB Meydan Düzenleme Projesi)',
    cls: D.cls[key], mat: D.mat[key], alb: null, trees: D.trees, structures: [], routes: [], extraTransfer: [],
    notes: key === 'proje' ? ['Proje çiziminde ağaç katmanı bulunmadığından mevcut ağaçların korunduğu varsayılmıştır.',
      'Proje çiziminin kapsamadığı alanlarda mevcut yüzey sınıfları korunmuştur.'] : [],
  }
}

function applySurface(D: Data, st: EState, ps: Poly[], cls: number, matCode: number, perm: boolean, albedo: number | null) {
  const G = D.meta.grid
  const win = windowOf(G, bboxOf(ps))
  const m = polyMask(G, ps, win)
  let n = 0
  for (let r = 0; r < win.h; r++) for (let c = 0; c < win.w; c++) {
    if (!m[r * win.w + c]) continue
    const g = (win.y + r) * G.w + win.x + c
    const cur = st.cls[g]
    if (!cur || cur === C.bina || cur === C.su) continue
    st.cls[g] = cls
    st.mat[g] = matCode | (perm ? PERM_BIT : 0)
    if (st.alb) st.alb[g] = albedo != null ? Math.round(albedo * 100) : 0
    n++
  }
  return n * G.res * G.res
}

function placeTrees(D: Data, st: EState, ps: Poly[], n: number, d: number): XY[] {
  const G = D.meta.grid
  const sp = Math.max(d, 2)
  const [x0, y0, x1, y1] = bboxOf(ps)
  const near = st.trees.filter(t => t.x > x0 - d && t.x < x1 + d && t.y > y0 - d && t.y < y1 + d)
  const pts: XY[] = []
  let row = 0
  for (let y = y0 + sp / 2; y <= y1; y += (sp * Math.sqrt(3)) / 2, row++) {
    for (let x = x0 + sp / 2 + (row % 2 ? sp / 2 : 0); x <= x1; x += sp) {
      const p: XY = [x, y]
      if (!pointInPolys(p, ps)) continue
      if (ps.some(poly => poly.some(r => distToRing(p, r) < d / 4))) continue
      const cl = st.cls[cellOf(G, p)]
      if (!cl || cl === C.bina || cl === C.su) continue
      if (near.some(t => Math.hypot(x - t.x, y - t.y) <= ((d + t.d) / 2) * 0.8)) continue
      pts.push(p)
    }
  }
  if (pts.length > n) {
    const out: XY[] = []
    for (let i = 0; i < n; i++) out.push(pts[Math.round((i * (pts.length - 1)) / Math.max(1, n - 1))])
    return out
  }
  return pts
}

export function apply(D: Data, base: EState, sc: ScenarioDef) {
  const st: EState = {
    ...base, key: sc.id ?? 'senaryo', label: sc.scenario_name, cls: base.cls.slice(), mat: base.mat.slice(),
    alb: base.alb ? base.alb.slice() : new Uint8Array(base.cls.length), trees: base.trees.slice(), structures: base.structures.slice(),
    routes: base.routes.slice(), extraTransfer: base.extraTransfer.slice(), notes: base.notes.slice(),
  }
  const log: string[] = [], warnings: string[] = [], areas: { type: string; ps: Poly[] }[] = []
  const newTrees: XY[] = []
  const boundary = D.boundary
  for (const iv of sc.interventions) {
    const t = iv.type
    const g = iv.geometry
    if (!g) continue
    const ps = geomToPolys(g)
    if (ps.length) areas.push({ type: t, ps })
    if (t === 'tree_planting') {
      const n = Number(iv.tree_count ?? 10), d = Number(iv.canopy_diameter ?? 5), h = Number(iv.tree_height ?? Math.max(d * 1.4, 4))
      const pts = g.type === 'Point' ? [geomToPoint(g)!] : placeTrees(D, st, ps, n, d)
      if (pts.length < n && g.type !== 'Point') warnings.push(`Seçilen alana taç çapı ${d} m ile en fazla ${pts.length} ağaç yerleştirilebildi (istenen ${n}).`)
      for (const p of pts) st.trees.push({ x: p[0], y: p[1], h, d, no: null, tr: String(iv.species ?? 'Senaryo ağacı'), la: '', sa: '—', es: 'senaryo', bk: 'kullanıcı', yeni: true })
      newTrees.push(...pts)
      log.push(`${pts.length} ağaç (taç çapı ${d} m, boy ${h} m) eklendi.`)
    } else if (t === 'green_conversion' || t === 'hard_reduction') {
      const a = applySurface(D, st, ps, C.yesil, 0, true, null)
      log.push(`${n0(a)} m² yüzey yeşil alana dönüştürüldü.`)
    } else if (t === 'shade_structure' || t === 'pv_shading') {
      const h = Number(iv.height ?? 4), op = Number(iv.shade_ratio ?? 100) / 100
      st.structures.push({ poly: ps, height: h, opacity: op, kind: t === 'pv_shading' ? 'Fotovoltaik gölgeleme' : String(iv.shade_type ?? 'Gölgeleme elemanı') })
      log.push(`${n0(polyArea(ps))} m² gölgeleme elemanı (yükseklik ${h} m, gölgeleme oranı %${Math.round(op * 100)}) eklendi.`)
    } else if (t === 'surface_change' || t === 'cool_pavement' || t === 'permeable_surface') {
      const mat = String(iv.new_material || (t === 'cool_pavement' ? 'acik_renkli' : 'gecirgen_beton'))
      const [lbl, cls, perm0] = MATERIALS[mat] ?? [mat, C.sert, false]
      const perm = t === 'permeable_surface' ? true : perm0
      const alb = iv.albedo !== undefined && iv.albedo !== '' && iv.albedo !== null ? Number(iv.albedo) : null
      const a = applySurface(D, st, ps, cls, MATERIAL_CODE[mat] ?? 0, perm, alb)
      log.push(`${n0(a)} m² yüzey '${lbl}' olarak değiştirildi${alb != null ? ` (albedo ${alb})` : ''}.`)
    } else if (t === 'pedestrian_route') {
      const l = geomToLine(g)
      st.routes.push(l)
      log.push(`${n0(l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0))} m yaya güzergâhı tanımlandı.`)
    } else if (t === 'transfer_area') {
      let c = geomToPoint(g)
      if (!c && ps.length) { const b = bboxOf(ps); c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] }
      if (c) st.extraTransfer.push({ tur: String(iv.transfer_type ?? 'otobus'), ad: String(iv.name ?? 'Önerilen aktarma noktası'), hat: 'senaryo', x: c[0], y: c[1], yontem: 'kullanıcı', bel: 0 })
      log.push(`Önerilen aktarma noktası (${iv.transfer_type ?? 'otobus'}) eklendi.`)
    }
  }
  void boundary
  return { st, log, warnings, areas, newTrees }
}

const num = (v: unknown) => (typeof v === 'number' ? v : null)

export function symbol(delta: number | null, base: number | null, higherIs: 'better' | 'worse' = 'better') {
  if (delta == null || base == null || base === 0) {
    if (delta) return (delta > 0) === (higherIs === 'better') ? '+' : '−'
    return '0'
  }
  const r = (Math.abs(delta) / Math.abs(base)) * 100
  const n = r < 1 ? 0 : r < 10 ? 1 : r < 30 ? 2 : 3
  if (!n) return '0'
  return ((delta > 0) === (higherIs === 'better') ? '+' : '−').repeat(n)
}
export const WORSE = new Set(['sert_oran', 'gunes_acik_sert_m2', 'aktarma_ort_mesafe'])

function litEffects(D: Data, sc: ScenarioDef, bRaw: any, sRaw: any, sunEl: number) {
  const out: ScenarioResult['literature_effects'] = []
  const types = new Set(sc.interventions.map(i => i.type))
  const dSh = sRaw.a_sh - bRaw.a_sh
  if (dSh > 1 && sunEl > 0 && (types.has('tree_planting') || types.has('shade_structure') || types.has('pv_shading'))) {
    const pid = ['shade_globe', 'shade_tair', 'shade_pet_steps', ...(types.has('tree_planting') ? ['shade_tsurf_tree'] : [])]
    const ps = pid.map(p => lit(D, p))
    let txt = `Seçilen saatte yeni gölgelenen yaklaşık ${n0(dSh)} m² açık zemin için literatürde gölge altında raporlanan etkiler: ` +
      `glob sıcaklığında en fazla ${ps[0].deger[0]}–${ps[0].deger[1]} °C düşüş (Armson vd., 2012; Manchester), ` +
      `hava sıcaklığında en fazla ${ps[1].deger[1]} °C düşüş ve PET'te ${ps[2].deger[0]} termal duyum kademesi iyileşme (Lee vd., 2013; Freiburg).`
    if (types.has('tree_planting')) txt += ` Ağaç gölgesi altında en yüksek yüzey sıcaklığında en fazla ${ps[3].deger[1]} °C düşüş raporlanmıştır (Armson vd., 2012).`
    out.push({ text: txt + ' Bu değerler Kadıköy koşullarında ölçülmemiş veya modellenmemiştir.', method: 'literature', params: pid, confidence: 'orta' })
  }
  if (types.has('pv_shading')) out.push({ text: 'Fotovoltaik gölgeleme elemanının gölge dışındaki termal etkisi için literatür parametresi tanımlanmamış.', method: 'literature', params: ['pv_shade_thermal'], confidence: '—' })
  const dG = sRaw.a_yesil - bRaw.a_yesil
  if (dG > 1) {
    const p = lit(D, 'grass_tsurf')
    out.push({ text: `Yeşile dönüştürülen ${n0(dG)} m² alanda, çimin sert zemine göre en yüksek yüzey sıcaklığının en fazla ${p.deger[1]} °C daha düşük olabildiği raporlanmıştır (Armson vd., 2012). Aynı çalışma, çimin yaya düzeyindeki hava konforuna etkisinin sınırlı olduğunu belirtir.`, method: 'literature', params: ['grass_tsurf'], confidence: 'orta' })
    if (dG >= 10000) {
      const p1 = lit(D, 'park_cooling_day'), p2 = lit(D, 'park_cooling_night')
      out.push({ text: `Park ölçeğinde (≥1 ha) meta-analiz sonucu: parklar çevrelerine göre gündüz ortalama ${p1.deger[0]} °C, gece ${p2.deger[0]} °C daha serindir (Bowler vd., 2010). Parkların büyüklüğüne ve yapısına göre geniş değişkenlik gösterir.`, method: 'literature', params: ['park_cooling_day', 'park_cooling_night'], confidence: 'orta' })
    } else out.push({ text: 'Park ölçeğindeki serinleme bulguları (Bowler vd., 2010) 1 ha altındaki yeşil alanlara uygulanmamıştır.', method: 'literature', params: ['park_cooling_day'], confidence: '—' })
  }
  for (const iv of sc.interventions) {
    if (iv.type === 'surface_change' || iv.type === 'cool_pavement') {
      const old = String(iv.current_material ?? '')
      const newAlb = iv.albedo
      const rng = old ? albedoRange(D, MATERIAL_CODE[old] ?? 0) : null
      if (rng && newAlb !== '' && newAlb != null) {
        const lo = Number(newAlb) - rng[1], hi = Number(newAlb) - rng[0]
        const k = lit(D, 'tsurf_per_albedo_derived').deger[0]
        out.push({ text: `Albedo değişimi ${fmt2(lo)} ile ${fmt2(hi)} arasında (mevcut '${old}' için literatür aralığı ${rng[0]}–${rng[1]}, yeni değer ${newAlb}). Santamouris (2013)'te aktarılan duyarlılık analizinden doğrusal türetimle en yüksek yüzey sıcaklığında yaklaşık ${(k * hi * 10).toFixed(1)} ile ${(k * lo * 10).toFixed(1)} K arası değişim beklenebilir (düşük güven: türetilmiş, tek iklim koşulu).`, method: 'literature', params: [`albedo_${old}_yeni`, 'tsurf_per_albedo_derived', 'tsurf_albedo_pair'], confidence: 'düşük' })
      } else {
        const why = !old ? 'mevcut malzeme belirtilmemiş' : !rng ? `'${old}' için doğrulanmış albedo değeri yok` : 'yeni albedo girilmemiş'
        out.push({ text: `Zemin değişiminin yüzey sıcaklığına etkisi hesaplanamadı: ${why}. Literatür parametresi tanımlanmamış.`, method: 'literature', params: [], confidence: '—' })
      }
    }
    if (iv.type === 'permeable_surface') {
      const p = lit(D, 'permeable_effect')
      out.push({ text: 'Geçirgen yüzeyin sıcaklık etkisi için sayısal literatür parametresi tanımlanmamış. ' + (p.not ?? ''), method: 'literature', params: ['permeable_effect'], confidence: '—' })
    }
  }
  return out
}

function contextChecks(D: Data, areas: { ps: Poly[] }[], newTrees: XY[]) {
  const G = D.meta.grid
  const out = { infra: {} as Record<string, number>, heritage: 0, priv: 0, commercial: false }
  for (const p of newTrees) {
    const hit = new Set<string>()
    for (const l of D.infra) if (!hit.has(l.k) && Math.abs(l.c[0][0] - p[0]) < 400 && distToLine(p, l.c) < 1.5) hit.add(l.k)
    hit.forEach(k => { out.infra[k] = (out.infra[k] ?? 0) + 1 })
  }
  for (const a of areas) {
    const win = windowOf(G, bboxOf(a.ps))
    const m = polyMask(G, a.ps, win)
    let her = 0, pr = 0
    for (let r = 0; r < win.h; r++) for (let c = 0; c < win.w; c++) {
      if (!m[r * win.w + c]) continue
      const g = (win.y + r) * G.w + win.x + c
      if (D.constraints.heritage[g]) her++
      if (D.constraints.priv[g]) pr++
      if (D.constraints.commercial[g]) out.commercial = true
    }
    if (her > 4) out.heritage++
    if (pr > 4) out.priv++
  }
  return out
}

export function run(D: Data, sc: ScenarioDef, heatFn?: ((ps: Poly[]) => number | null) | null): ScenarioResult {
  const base = baseState(D, sc.base)
  const time = sc.time
  const { st, log, warnings, areas, newTrees } = apply(D, base, sc)
  // analysis area: intervention areas buffered by 50 m (as a bounding square ring around each), else whole site
  let A: Poly[]
  if (areas.length) {
    A = areas.map(a => { const [x0, y0, x1, y1] = bboxOf(a.ps); return [[[x0 - 50, y0 - 50], [x1 + 50, y0 - 50], [x1 + 50, y1 + 50], [x0 - 50, y1 + 50], [x0 - 50, y0 - 50]]] as Poly })
  } else if (st.routes.length || st.extraTransfer.length) {
    const pts = [...st.routes.flat(), ...st.extraTransfer.map(e => [e.x, e.y] as XY)]
    const [x0, y0, x1, y1] = bboxOf([pts as any])
    A = [[[[x0 - 50, y0 - 50], [x1 + 50, y0 - 50], [x1 + 50, y1 + 50], [x0 - 50, y1 + 50], [x0 - 50, y0 - 50]]]]
  } else A = D.boundary
  const rv = heatFn ? heatFn(A) : null
  const kb = compute(D, base, A, time, rv)
  const ks = compute(D, st, A, time, rv)
  const tb = transportKpis(D, base, time)
  const ts = transportKpis(D, st, time)
  const baseK: Record<string, Kpi> = Object.fromEntries([...kb.kpis, ...tb.kpis].map(k => [k.id, k]))
  const scnK: Record<string, Kpi> = Object.fromEntries([...ks.kpis, ...ts.kpis].map(k => [k.id, k]))
  const deltas: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(scnK)) {
    const a = num(baseK[k]?.value), b = num(v.value)
    deltas[k] = a != null && b != null ? Math.round((b - a) * 100) / 100 : null
  }
  const wb = compute(D, base, A, '2026-12-21T12:00'), ws = compute(D, st, A, '2026-12-21T12:00')
  const winterExtra = ws.raw.a_sh - wb.raw.a_sh
  const ctx = contextChecks(D, areas, newTrees)

  // new shade = scenario shadow − base shadow (same window)
  const newShade = new Uint8Array(ks.shadow.mask.length)
  for (let i = 0; i < newShade.length; i++) newShade[i] = ks.shadow.mask[i] && !kb.shadow.mask[i] ? 1 : 0
  // structures shade (partial ones are not in the opaque mask): draw their translated footprint for display
  const G = D.meta.grid
  const sun = ks.sun
  const affected = ts.paths.filter(p => areas.some(a => p.c.some(pt => pointInPolys(pt, a.ps))) ||
    p.c.some(pt => { const col = Math.floor((pt[0] - G.x0) / G.res) - ks.shadow.win.x, row = Math.floor((G.ytop - pt[1]) / G.res) - ks.shadow.win.y
      return col >= 0 && row >= 0 && col < ks.shadow.win.w && row < ks.shadow.win.h && newShade[row * ks.shadow.win.w + col] }))

  // impacts
  const d = (k: string) => deltas[k] ?? null
  const pos: { text: string; basis: string }[] = [], neg: { text: string; basis: string }[] = [], aff: { text: string; basis: string }[] = []
  const stake = new Set<string>(['Yayalar', 'İBB'])
  const types = new Set(sc.interventions.map(i => i.type))
  if ((d('yesil_oran') ?? 0) > 0) pos.push({ text: `Yeşil alan oranı ${fmt2(d('yesil_oran')!)} puan değişir.`, basis: 'geometrik hesap' })
  if ((d('golge_oran') ?? 0) > 0) pos.push({ text: `Seçilen saatte gölgeli alan oranı ${fmt2(d('golge_oran')!)} puan artar.`, basis: 'geometrik hesap' })
  if ((d('gunes_acik_sert_m2') ?? 0) < 0) pos.push({ text: `Güneşe açık sert zemin ${n0(Math.abs(d('gunes_acik_sert_m2')!))} m² azalır.`, basis: 'geometrik hesap' })
  if ((d('gecirgen_oran') ?? 0) > 0) pos.push({ text: `Geçirgen yüzey oranı ${fmt2(d('gecirgen_oran')!)} puan artar.`, basis: 'geometrik hesap' })
  if ((d('sert_oran') ?? 0) < 0 && (types.has('green_conversion') || types.has('hard_reduction')))
    neg.push({ text: `Sert zemin oranı ${fmt2(d('sert_oran')!)} puan azalır; toplanma, etkinlik ve yaya akışı için kullanılabilir açık sert alan küçülür.`, basis: 'geometrik hesap' })
  if (winterExtra > 1) neg.push({ text: `21 Aralık 12:00'de ek gölge ${n0(winterExtra)} m²: kış aylarında güneş erişimi azalabilir.`, basis: 'geometrik hesap' })
  for (const [k, n] of Object.entries(ctx.infra)) { neg.push({ text: `${n} yeni ağaç, ${k} hattına 1,5 m'den yakın: kök–altyapı çakışma riski (eşik varsayımdır).`, basis: 'veri + varsayım' }); stake.add(k.split(' ')[0]) }
  if (ctx.heritage) { neg.push({ text: `Müdahale alanı tescilli yapı/sit alanı ile kesişiyor; ilgili Koruma Bölge Kurulu onayı gerekir (1/5000 KANİP plan hükmü 1.2).`, basis: 'veri' }); stake.add('Kültür Varlıklarını Koruma Bölge Kurulu') }
  if (ctx.priv) { neg.push({ text: `Müdahale özel mülkiyetli parsel(ler) ile kesişiyor.`, basis: 'veri' }); stake.add('Parsel malikleri') }
  if (types.has('tree_planting')) { neg.push({ text: 'Ağaçların sulama, budama ve bakım ihtiyacı doğar (genel bilgi, sayısallaştırılmamıştır).', basis: 'varsayım / genel bilgi' }); stake.add('İBB Park ve Bahçeler'); stake.add('Kadıköy Belediyesi bakım ekipleri') }
  if (types.has('shade_structure') || types.has('pv_shading')) neg.push({ text: 'Gölgeleme elemanı için taşıyıcı, rüzgâr yükü ve bakım gereksinimi doğar (genel bilgi, sayısallaştırılmamıştır).', basis: 'varsayım / genel bilgi' })
  if (types.has('pv_shading')) stake.add('Enerji dağıtım şirketi (AYEDAŞ)')
  for (const a of areas) aff.push({ text: `${INTERVENTIONS[a.type] ?? a.type} alanı: ${n0(polyArea(a.ps))} m²`, basis: 'geometrik hesap' })
  for (const p of affected) aff.push({ text: `Aktarma güzergâhı ${p.from} → ${p.to} (${p.dist_m} m) müdahale/gölge alanından geçiyor.`, basis: 'geometrik hesap' })
  if (affected.length || types.has('pedestrian_route') || types.has('transfer_area')) ['Toplu taşıma kullanıcıları', 'İETT', 'Metro İstanbul', 'Şehir Hatları ve özel deniz işletmeleri'].forEach(s => stake.add(s))
  if (ctx.commercial) stake.add('Esnaf (zemin kat ticaret)')

  const narrative: string[] = []
  for (const [k, l] of [['yesil_oran', 'yeşil alan oranı'], ['golge_oran', 'gölgeli alan oranı'], ['sert_oran', 'sert zemin oranı'], ['agac_tac_oran', 'ağaç taç örtüsü oranı'], ['gecirgen_oran', 'geçirgen yüzey oranı']] as const)
    if (deltas[k]) narrative.push(`Bu senaryoda ${l} %${baseK[k].value} → %${scnK[k].value} (${fmt2(deltas[k]!)} puan) değişmektedir.`)
  if (deltas.aktarma_ort_mesafe) narrative.push(`Ortalama aktarma yürüme mesafesi %${fmt2((100 * deltas.aktarma_ort_mesafe) / (baseK.aktarma_ort_mesafe.value as number)).replace('.', ',')} değişmektedir.`)
  if (deltas.yesil_oran && deltas.golge_oran) narrative.push(`Bu senaryo yeşil alanı ${deltas.yesil_oran > 0 ? 'artırırken' : 'azaltırken'} gölgeli alanı da ${deltas.golge_oran > 0 ? 'artırmaktadır.' : 'azaltmaktadır.'}`)
  for (const r of ts.routes) narrative.push(`${r.name} ${r.length_m} m uzunluğunda; seçilen saatte %${r.shaded_pct}'i gölgede.`)
  if (!narrative.length) narrative.push('Hesaplanan göstergelerde anlamlı bir değişim bulunmadı.')
  if (sun.elevation <= 0) narrative.push('Seçilen saatte güneş ufkun altındadır; gölge göstergeleri anlamlı değildir.')

  const lits = litEffects(D, sc, kb.raw, ks.raw, sun.elevation)
  const methods = [...new Set([...ks.kpis.map(k => k.method), ...lits.map(e => e.method)])]
  const confidence = methods.every(m => m === 'data' || m === 'geometric') ? 'Yüksek' : methods.includes('literature') ? 'Orta' : 'Düşük'
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
  const imgNew = maskImage(G, newShade, ks.shadow.win, [59, 111, 182, 150])
  const imgBase = shadowOverlay(D, kb.shadow)
  const symbols: Record<string, string> = {}
  for (const k of Object.keys(deltas)) symbols[k] = symbol(deltas[k], num(baseK[k]?.value), WORSE.has(k) ? 'worse' : 'better')
  const changed = sc.interventions.filter(iv => ['green_conversion', 'hard_reduction', 'surface_change', 'cool_pavement', 'permeable_surface'].includes(iv.type) && iv.geometry)
  return {
    scenario: sc, base_label: base.label, time, sun: { elevation: sun.elevation, azimuth: sun.azimuth }, area_m2: ks.area_m2,
    kpis_base: [...kb.kpis, ...tb.kpis], kpis_scenario: [...ks.kpis, ...ts.kpis], deltas, symbols, literature_effects: lits, narrative,
    impacts: { positive: pos, negative: neg, affected: aff, stakeholders: [...stake].sort().map(name => ({ name, basis: 'mekânsal kesişim / müdahale türü (varsayım içerir)' })) },
    log, warnings,
    notes: [...st.notes, 'Bu senaryo tarihsel/varsayımsal meteorolojik koşullar üzerinden çalıştırılmıştır: meteorolojik veri bulunmadığından yalnızca güneş geometrisi kullanılmıştır.'],
    methods, confidence,
    geoms: {
      new_trees: fc(newTrees.map((p, i) => ({ type: 'Feature', properties: { i }, geometry: pointToGeom(p) }))),
      new_tree_crowns: fc(st.trees.filter(t => t.yeni).map(t => ({ type: 'Feature', properties: { tac_cap_m: t.d, boy_m: t.h, turkce: t.tr },
        geometry: polysToGeom([[Array.from({ length: 25 }, (_, k) => [t.x + (t.d / 2) * Math.cos((k / 24) * 2 * Math.PI), t.y + (t.d / 2) * Math.sin((k / 24) * 2 * Math.PI)] as XY)]]) }))),
      intervention_areas: fc(areas.map(a => ({ type: 'Feature', properties: { type: a.type, label: INTERVENTIONS[a.type] }, geometry: polysToGeom(a.ps) }))),
      structures: fc(st.structures.map(s => ({ type: 'Feature', properties: { height: s.height, opacity: s.opacity, kind: s.kind }, geometry: polysToGeom(s.poly) }))),
      affected_paths: fc(affected.map(p => ({ type: 'Feature', properties: { from: p.from, to: p.to, dist_m: p.dist_m, shaded_pct: p.shaded_pct }, geometry: lineToGeom(p.c) }))),
      transfer_paths: fc(ts.paths.map(p => ({ type: 'Feature', properties: { from: p.from, to: p.to, pair: p.pair, dist_m: p.dist_m, shaded_pct: p.shaded_pct }, geometry: lineToGeom(p.c) }))),
      routes: fc(ts.routes.map(r => ({ type: 'Feature', properties: { name: r.name, length_m: r.length_m, shaded_pct: r.shaded_pct }, geometry: lineToGeom(r.c) }))),
      analysis_area: { type: 'Feature', properties: {}, geometry: polysToGeom(A) },
      changed_surfaces: fc(changed.map(iv => {
        const m = iv.type === 'green_conversion' || iv.type === 'hard_reduction' ? 'cim' : String(iv.new_material || (iv.type === 'cool_pavement' ? 'acik_renkli' : 'gecirgen_beton'))
        const cls = MATERIALS[m]?.[1] ?? C.sert
        return { type: 'Feature', properties: { sinif: Object.keys(C).find(k => (C as any)[k] === cls), ad: MATERIALS[m]?.[0] ?? m }, geometry: iv.geometry! }
      })),
    } as any,
    images: { new_shade: imgNew, base_shade: imgBase },
  } as ScenarioResult
}

export { sunPosition }
