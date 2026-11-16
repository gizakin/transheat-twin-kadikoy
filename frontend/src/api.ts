// Application API backed by the in-browser engine (no server). Same call shapes the UI used with FastAPI,
// so the page runs anywhere static files are served — including a shared claude.ai Artifact link.
import { bboxOf, geomToPolys, lineToGeom, loadData, polyArea, type Data, type Poly } from './engine/data'
import { accessCanvas, compute, shadowOverlay, stopAccess, transportKpis } from './engine/kpi'
import { toLL } from './engine/data'
import { baseState, apply as applyScenario, run as runScenario, symbol, WORSE } from './engine/scenario'
import { heatStats, ingest, rasterFromGrid, zonalMean, type Upload } from './engine/uploads'
import { simCanvas, simulate, type HeatSim, type SimMode, type SimView } from './engine/heatsim'
import { comfortProfile, type ComfortProfile, type LstGrid } from './engine/comfort'
import { buildNet, zoneRaster, type PedNet } from './engine/pedsim'
import type { LayerMeta, ScenarioDef, ScenarioResult, StateKpis } from './types'

const KEY = 'transheat.scenarios.v1'
const yieldUI = () => new Promise(r => setTimeout(r, 30))
const uid = () => Math.random().toString(36).slice(2, 12)

interface Saved { id: string; name: string; created_at: string; definition: ScenarioDef }
let examples: Saved[] | null = null
const uploads: Upload[] = []
let heatId: string | null = null
const comfortCache = new Map<string, ComfortProfile>()
const pedCache = new Map<string, PedNet>()
let lstGridP: Promise<LstGrid | null> | null = null

function readStore(): Saved[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
function writeStore(list: Saved[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage unavailable: kept for this session only */ }
  memory = list
}
let memory: Saved[] | null = null

async function allScenarios(): Promise<Saved[]> {
  if (!examples) {
    try { examples = await (await fetch('data/examples.json')).json() } catch { examples = [] }
  }
  const own = memory ?? readStore()
  memory = own
  const deleted = new Set(own.filter(s => (s as any).deleted).map(s => s.id))
  return [...examples!.filter(e => !deleted.has(e.id)), ...own.filter(s => !(s as any).deleted)]
}

// Built-in heat layer: Landsat LST supplied by the project team, shipped with the page and active by default.
let builtinHeat: Promise<void> | null = null
function ensureBuiltinHeat(D: Data) {
  if (builtinHeat) return builtinHeat
  builtinHeat = (async () => {
    const info = D.meta.lst
    if (!info) return
    try {
      const r = await fetch('data/' + info.file)
      if (!r.ok) return
      const u = rasterFromGrid(D, info.title, await r.json())
      u.id = 'lst_builtin'
      u.created_at = info.date
      u.metadata.kaynak = info.source
      u.metadata.not = info.notes
      uploads.unshift(u)
      if (!heatId) heatId = u.id
    } catch { /* heat layer stays unavailable */ }
  })()
  return builtinHeat
}

const heatFn = () => {
  const u = uploads.find(x => x.id === heatId)
  return u ? (ps: Poly[]) => zonalMean(u, ps) : null
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })

async function stateKpis(D: Data, key: 'mevcut' | 'proje', time: string): Promise<StateKpis> {
  const st = baseState(D, key)
  const h = heatFn()
  const r = compute(D, st, D.boundary, time, h ? h(D.boundary) : null)
  const t = transportKpis(D, st, time)
  return {
    label: st.label, notes: st.notes, sun: r.sun, area_m2: r.area_m2, kpis: [...r.kpis, ...t.kpis],
    shadow: shadowOverlay(D, r.shadow) as any,
    transfer_paths: fc(t.paths.map(p => ({ type: 'Feature', properties: { from: p.from, to: p.to, pair: p.pair, dist_m: p.dist_m, shaded_pct: p.shaded_pct }, geometry: lineToGeom(p.c) }))),
  }
}

const cmpCache = new Map<string, any>()
const simCache = new Map<string, HeatSim>()

export const api = {
  ready: async (onProgress?: (s: string) => void) => { const D = await loadData(onProgress); onProgress?.('Isı haritası hazırlanıyor…'); await ensureBuiltinHeat(D); return D },

  layers: async (): Promise<LayerMeta[]> => {
    const D = await loadData()
    const out: LayerMeta[] = Object.entries(D.meta.layers).map(([id, m]: [string, any]) => ({ id, ...m }))
    if (D.meta.lst) out.push({ id: 'lst_2025', title: D.meta.lst.title, group: 'Isı ve gölge', method: 'data', source: D.meta.lst.source, date: D.meta.lst.date,
      notes: D.meta.lst.notes, kind: 'raster', url: null } as any)
    for (const u of uploads.filter(x => x.id !== 'lst_builtin')) out.push({ id: `upload_${u.id}`, title: u.name, group: 'Yüklenen veriler', method: 'data', source: `Kullanıcı yüklemesi (${u.metadata.dosya})`,
      date: u.created_at, kind: u.kind, metadata: u.metadata, url: null, tiles: null, geojson: u.geojson, image: u.raster ? { canvas: u.raster.canvas, corners: u.raster.corners } : undefined } as any)
    return out
  },
  literature: async () => (await loadData()).meta.literature,

  stateKpis: async (key: string, time: string) => {
    const D = await loadData(); await yieldUI()
    return stateKpis(D, key as 'mevcut' | 'proje', time)
  },

  shadeProfile: async (key: string, date: string) => {
    const D = await loadData()
    const st = baseState(D, key as 'mevcut' | 'proje')
    const out = []
    for (let h = 6; h <= 20; h++) {
      await yieldUI()
      const t = `${date}T${String(h).padStart(2, '0')}:00`
      const r = compute(D, st, D.boundary, t)
      const k = Object.fromEntries(r.kpis.map(x => [x.id, x.value]))
      out.push({ time: t, elevation: r.sun.elevation, golge_oran: k.golge_oran as number, gunes_acik_sert_m2: k.gunes_acik_sert_m2 as number })
    }
    return out
  },

  select: async (geometry: GeoJSON.Geometry, base: string, time: string) => {
    const D = await loadData(); await yieldUI()
    const ps = geomToPolys(geometry)
    const st = baseState(D, base as 'mevcut' | 'proje')
    const h = heatFn()
    const r = compute(D, st, ps, time, h ? h(ps) : null)
    const raw = r.raw
    const mix = [
      { sinif: 'yesil', ad: 'Yeşil alan', alan_m2: Math.round(raw.a_yesil), malzeme: '' },
      { sinif: 'gecirgen', ad: 'Geçirgen yüzey', alan_m2: Math.round(raw.a_gec), malzeme: '' },
      { sinif: 'sert', ad: 'Sert zemin / asfalt', alan_m2: Math.round(raw.a_hard), malzeme: '' },
    ].filter(m => m.alan_m2 > 0).sort((a, b) => b.alan_m2 - a.alan_m2)
    return { area_m2: Math.round(polyArea(ps)), kpis: r.kpis, surface_mix: mix, sun: r.sun }
  },

  run: async (definition: ScenarioDef): Promise<ScenarioResult> => {
    const D = await loadData(); await yieldUI()
    return runScenario(D, definition, heatFn())
  },

  save: async (definition: ScenarioDef) => {
    const D = await loadData(); await yieldUI()
    const def = { ...definition, id: definition.id ?? uid(), created_at: new Date().toISOString().slice(0, 19) }
    const results = runScenario(D, def, heatFn())
    def.analysis_method = results.methods
    const list = (memory ?? readStore()).filter(s => s.id !== def.id)
    writeStore([...list, { id: def.id!, name: def.scenario_name, created_at: def.created_at!, definition: def }])
    return { definition: def, results }
  },

  scenarios: async () => allScenarios(),
  scenario: async (id: string) => {
    const s = (await allScenarios()).find(x => x.id === id)
    if (!s) throw new Error('Senaryo bulunamadı')
    const D = await loadData(); await yieldUI()
    return { ...s, results: runScenario(D, s.definition, heatFn()) }
  },
  deleteScenario: async (id: string) => {
    const own = memory ?? readStore()
    const isExample = (examples ?? []).some(e => e.id === id)
    writeStore(isExample ? [...own, { id, name: '', created_at: '', definition: {} as any, deleted: true } as any] : own.filter(s => s.id !== id))
  },
  importScenario: async (text: string) => {
    const d = JSON.parse(text) as ScenarioDef
    if (!d.interventions || !d.scenario_name) throw new Error('Geçerli bir senaryo JSON\'u değil (scenario_name ve interventions gerekli).')
    const def = { ...d, id: uid(), created_at: new Date().toISOString().slice(0, 19) }
    writeStore([...(memory ?? readStore()), { id: def.id!, name: def.scenario_name, created_at: def.created_at!, definition: def }])
    return def
  },

  compare: async (ids: string[], time: string) => {
    const D = await loadData()
    const all = await allScenarios()
    const h = heatFn()
    const rv = h ? h(D.boundary) : null
    const site = async (key: string, st: ReturnType<typeof baseState>) => {
      const ck = `${key}|${time}|${heatId}`
      if ((key === 'mevcut' || key === 'proje') && cmpCache.has(ck)) return cmpCache.get(ck)
      await yieldUI()
      const r = compute(D, st, D.boundary, time, rv)
      const t = transportKpis(D, st, time)
      const out = [...r.kpis, ...t.kpis]
      if (key === 'mevcut' || key === 'proje') cmpCache.set(ck, out)
      return out
    }
    const cols: any[] = [
      { id: 'mevcut', name: 'Mevcut', kind: 'state', kpis: await site('mevcut', baseState(D, 'mevcut')), confidence: 'Yüksek' },
      { id: 'proje', name: 'Proje', kind: 'state', kpis: await site('proje', baseState(D, 'proje')), confidence: 'Orta' },
    ]
    for (const id of ids) {
      const s = all.find(x => x.id === id)
      if (!s) continue
      const { st } = applyScenario(D, baseState(D, s.definition.base), s.definition)
      await yieldUI()
      const local = runScenario(D, { ...s.definition, time }, h)
      cols.push({ id, name: s.definition.scenario_name, kind: 'scenario', base: s.definition.base, kpis: await site(id, st), confidence: local.confidence,
        literature_effects: local.literature_effects, narrative: local.narrative })
    }
    const ref = Object.fromEntries(cols[0].kpis.map((k: any) => [k.id, k]))
    for (const c of cols.slice(1)) {
      c.symbols = {}
      for (const k of c.kpis) {
        const a = typeof ref[k.id]?.value === 'number' ? ref[k.id].value : null, b = typeof k.value === 'number' ? k.value : null
        c.symbols[k.id] = symbol(a != null && b != null ? b - a : null, a, WORSE.has(k.id) ? 'worse' : 'better')
      }
    }
    const { sunPosition } = await import('./engine/sun')
    return { time, sun: sunPosition(time), columns: cols,
      note: 'Tüm sütunlar tüm çalışma alanı ve aynı saat için hesaplanmıştır; semboller Mevcut duruma göre göreli değişimdir (<%1: 0, %1–10: ±, %10–30: ±±, >%30: ±±±).' }
  },

  heat: async () => {
    const D = await loadData()
    const u = uploads.find(x => x.id === heatId && x.raster)
    if (!u) return { available: false, message: 'Bu analiz için veri bulunmamaktadır. Uydu tabanlı ısı haritası (GeoTIFF) yükleyin.' }
    return { available: true, id: u.id, name: u.name, metadata: u.metadata, stats: heatStats(u, D), image: { canvas: u.raster!.canvas, corners: u.raster!.corners },
      builtin: u.id === 'lst_builtin', yorum: u.id === 'lst_builtin' ? D.meta.lst?.yorum : null }
  },
  setHeat: async (id: string) => { heatId = id; cmpCache.clear(); return api.heat() },
  uploads: async () => uploads.map(u => ({ id: u.id, name: u.name, kind: u.kind, created_at: u.created_at, metadata: u.metadata })),
  /** Literature-based simulated heat map for the project state or a scenario (null definition = project state). */
  heatSim: async (target: 'proje' | ScenarioDef, mode: SimMode, view: SimView) => {
    const D = await loadData()
    const u = uploads.find(x => x.id === heatId && x.raster)
    if (!u) return { available: false }
    const key = `${typeof target === 'string' ? target : JSON.stringify(target.interventions) + target.base}|${mode}|${u.id}`
    let h: HeatSim | undefined = simCache.get(key)
    if (!h) {
      await yieldUI()
      const base = baseState(D, 'mevcut')
      const st = typeof target === 'string' ? baseState(D, 'proje')
        : applyScenario(D, baseState(D, target.base), target).st
      // a scenario on the project base is compared with the existing state too, so both effects add up
      h = simulate(D, u, base, st, mode)
      simCache.set(key, h)
    }
    const img = simCanvas(u, h, view)
    return { available: true, mode, view, stats: h.stats, changed: h.changed, image: { canvas: img.canvas, corners: img.corners }, scaleMax: img.scaleMax,
      p2: u.raster!.p2, p98: u.raster!.p98, kalibrasyon: D.meta.lst?.kalibrasyon ?? null, name: u.name }
  },
  iettLines: async (): Promise<{ kod: string; ad: string }[]> => {
    try { return await (await fetch('data/iett_lines.json')).json() } catch { return [] }
  },
  /** Hour-by-hour shade along every transfer path for a base state or a scenario (cached per date and target). */
  /** Walking network for the pedestrian agent simulation (paths sampled per metre with sun/shade at `time`). */
  pedNet: async (target: 'mevcut' | 'proje' | ScenarioDef, time: string): Promise<PedNet> => {
    const key = `${time}|${typeof target === 'string' ? target : JSON.stringify(target)}`
    const hit = pedCache.get(key)
    if (hit) return hit
    const D = await loadData(); await yieldUI()
    const st = typeof target === 'string' ? baseState(D, target) : applyScenario(D, baseState(D, target.base), target).st
    const net = buildNet(D, st, time)
    pedCache.set(key, net)
    if (pedCache.size > 90) pedCache.delete(pedCache.keys().next().value!)   // one net per simulated hour and state (paths shared)
    return net
  },
  /** walkable area (m²) of the pedestrian density zones A–E (index 1…5) */
  pedZones: async () => zoneRaster(await loadData()).area,
  comfort: async (target: 'mevcut' | 'proje' | ScenarioDef, date: string): Promise<ComfortProfile> => {
    const key = `${date}|${typeof target === 'string' ? target : JSON.stringify(target)}`
    const hit = comfortCache.get(key)
    if (hit) return hit
    const D = await loadData(); await yieldUI()
    const st = typeof target === 'string' ? baseState(D, target) : applyScenario(D, baseState(D, target.base), target).st
    lstGridP ??= fetch('data/lst_2025.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
    const prof = await comfortProfile(D, st, date, await lstGridP, yieldUI)
    if (typeof target !== 'string') prof.state = `Senaryo: ${target.scenario_name}`
    comfortCache.set(key, prof)
    if (comfortCache.size > 8) comfortCache.delete(comfortCache.keys().next().value!)
    return prof
  },
  /** Walking-distance bands to the nearest İETT stop (scenario stops included when a definition is given). */
  accessImage: async (def: ScenarioDef | null) => {
    const D = await loadData(); await yieldUI()
    const st = def ? applyScenario(D, baseState(D, def.base), def).st : baseState(D, 'mevcut')
    const a = stopAccess(D, st)
    const W = D.meta.walk
    const x1 = W.x0 + W.w * W.res, y1 = W.ytop - W.h * W.res
    return { canvas: accessCanvas(D, a.dist), corners: [toLL(W.x0, W.ytop), toLL(x1, W.ytop), toLL(x1, y1), toLL(W.x0, y1)] as [number, number][], share: a.share }
  },
  clearHeat: async () => { heatId = null; cmpCache.clear(); return api.heat() },
  deleteUpload: async (id: string) => {
    const i = uploads.findIndex(u => u.id === id)
    if (i >= 0) uploads.splice(i, 1)
    if (heatId === id) heatId = null
  },
  upload: async (file: File, crs: string, useAsHeat: boolean) => {
    const D = await loadData()
    const u = await ingest(D, file, crs)
    u.metadata.kaynak_kaydi = { yukleme_zamani: u.created_at, orijinal_dosya: file.name, saklama: 'yalnızca bu tarayıcı oturumu' }
    uploads.push(u)
    if (u.kind === 'raster' && useAsHeat) { heatId = u.id; cmpCache.clear() }
    return { id: u.id, kind: u.kind, metadata: u.metadata }
  },
}

export { bboxOf }
