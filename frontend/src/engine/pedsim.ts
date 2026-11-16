// Pedestrian agent simulation on the walking grid (in-browser, GAMA-style "people move on a network" model).
// Two demand models:
//  * simple  – the original one-window model: fixed passengers per ferry / train (assumption) or İBB hourly volume × transfer share.
//  * dynamic – 24 h, weekday/weekend, per flow (engine/demand.ts): Şehir Hatları timetable arrivals and departures, Turyol on a
//              headway assumption, M4 trains, non-transfer passengers walking to/from the city gates, çarşı and meydan/sahil
//              pedestrians; boarding passengers wait at the pier until departure, transfer passengers wait at bus/minibus stops.
// Sun/shade along every path comes from the geometric shadow mask of the hour (clear sky); paths are shared between hours.
import { toLL, toTM, type Data, type Poly, type TransferPoint, type XY } from './data'
import { pathsFrom } from './network'
import { siteShadow, transferPaths, type EState } from './kpi'
import { sunPosition } from './sun'
import { GATES, SPOTS, flowDemand, onService, type DemandCfg, type FerryData, type FlowId } from './demand'

export interface PedPath { key: string; from: string; to: string; pair: string; w: number; len: number; ll: Float64Array; zone: Uint8Array; shade: Uint8Array }
export interface PedNet { time: string; night: boolean; paths: PedPath[]; byKey: Map<string, number>; groups: Map<string, { idx: number[]; cum: number[] }> }

interface RawPath { from: string; to: string; pair: string; w: number; c: XY[] }
const routeCache = new Map<string, RawPath[]>()
const gateName = (id: string) => `kapı:${id}`

/** Walking routes: from every pier and M4 structure to EVERY bus stop (weight = number of lines serving it) and every
 *  minibus stop (equal weight); pier → metro keeps the nearest M4 structure; from every city gate to every pier, M4 structure
 *  and meydan/sahil spot. Shortest paths on the 2 m walk grid. */
function routes(D: Data, st: EState): { key: string; paths: RawPath[] } {
  const extra = st.extraTransfer
  const key = extra.map(e => `${e.tur}:${e.x.toFixed(1)},${e.y.toFixed(1)}`).join(';')
  const hit = routeCache.get(key)
  if (hit) return { key, paths: hit }
  const pts = [...D.transfer, ...extra]
  const lines = (t: TransferPoint) => Math.max(1, String(t.hat ?? '').split(',').filter(x => x.trim()).length)
  const targets = pts.filter(t => t.tur === 'otobus' || t.tur === 'minibus')
  const out: RawPath[] = []
  for (const o of pts.filter(t => t.tur === 'iskele' || t.tur === 'metro')) {
    const res = pathsFrom(D, [o.x, o.y], targets.map(t => [t.x, t.y] as XY))
    targets.forEach((t, i) => {
      if (res[i].d == null || res[i].path.length < 2) return
      out.push({ from: o.ad, to: t.ad, pair: `${o.tur}→${t.tur}`, w: t.tur === 'otobus' ? lines(t) : 1, c: res[i].path })
    })
  }
  for (const p of transferPaths(D, extra)) if (p.pair === 'iskele→metro') out.push({ from: p.from, to: p.to, pair: p.pair, w: 1, c: p.c })
  const hubs = pts.filter(t => t.tur === 'iskele' || t.tur === 'metro')
  for (const g of GATES) {
    const tg = [...hubs.map(h => ({ ad: h.ad, pair: `kent→${h.tur}`, xy: [h.x, h.y] as XY })), ...SPOTS.map(s => ({ ad: s.label, pair: 'kent→meydan', xy: toTM(...s.ll) }))]
    const res = pathsFrom(D, toTM(...g.ll), tg.map(t => t.xy))
    tg.forEach((t, i) => { if (res[i].d != null && res[i].path.length >= 2) out.push({ from: gateName(g.id), to: t.ad, pair: t.pair, w: 1, c: res[i].path }) })
  }
  routeCache.set(key, out)
  if (routeCache.size > 6) routeCache.delete(routeCache.keys().next().value!)
  return { key, paths: out }
}

// ------------------------------------------------------------------ zones (each walker is counted in at most one zone)
export const ZONES = [
  { id: 1, key: 'A', label: 'A · İskele' }, { id: 2, key: 'C', label: 'C · M4 Kadıköy' }, { id: 3, key: 'D', label: 'D · Otobüs/dolmuş durakları' },
  { id: 4, key: 'E', label: 'E · Çarşı girişi' }, { id: 5, key: 'B', label: 'B · Meydan (diğer)' },
]
const ZONE_R = { iskele: 35, metro: 25, durak: 15, carsi: 40 }
function inRing(r: XY[], x: number, y: number) {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const inPolys = (ps: Poly[], x: number, y: number) => ps.some(p => inRing(p[0], x, y) && !p.slice(1).some(h => inRing(h, x, y)))
let zoneCache: { D: Data; extraKey: string; raster: Uint8Array; area: number[] } | null = null
/** Zone of every walk-grid cell inside the study boundary (priority A > C > D > E > B) and the walkable area per zone (m²). */
export function zoneRaster(D: Data, extra: TransferPoint[] = []) {
  const extraKey = extra.map(e => `${e.tur}${e.x}${e.y}`).join()
  if (zoneCache && zoneCache.D === D && zoneCache.extraKey === extraKey) return zoneCache
  const W = D.meta.walk, pts = [...D.transfer, ...extra]
  const raster = new Uint8Array(W.w * W.h), area = [0, 0, 0, 0, 0, 0]
  const sets: [number, XY[], number][] = [
    [1, pts.filter(p => p.tur === 'iskele').map(p => [p.x, p.y]), ZONE_R.iskele],
    [2, pts.filter(p => p.tur === 'metro').map(p => [p.x, p.y]), ZONE_R.metro],
    [3, pts.filter(p => p.tur === 'otobus' || p.tur === 'minibus').map(p => [p.x, p.y]), ZONE_R.durak],
    [4, [toTM(...GATES[0].ll)], ZONE_R.carsi],
  ]
  for (let r = 0; r < W.h; r++) for (let c = 0; c < W.w; c++) {
    const x = W.x0 + (c + 0.5) * W.res, y = W.ytop - (r + 0.5) * W.res
    let z = 0
    for (const [id, ps, rad] of sets) if (ps.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= rad * rad)) { z = id; break }
    if (!z && inPolys(D.boundary, x, y)) z = 5
    raster[r * W.w + c] = z
    if (z && D.walk[r * W.w + c]) area[z] += W.res * W.res
  }
  zoneCache = { D, extraKey, raster, area }
  return zoneCache
}

// ------------------------------------------------------------------ geometry (shared by all hours) and per-hour shade
interface Geo { paths: Omit<PedPath, 'shade'>[]; xy: Float64Array[]; byKey: Map<string, number>; groups: Map<string, { idx: number[]; cum: number[] }> }
const geoCache = new Map<string, Geo>()
function geometry(D: Data, st: EState): Geo {
  const { key, paths: raw } = routes(D, st)
  const hit = geoCache.get(key)
  if (hit) return hit
  const W = D.meta.walk
  const zr = zoneRaster(D, st.extraTransfer).raster
  const xy: Float64Array[] = []
  const paths = raw.map(p => {
    const pts: XY[] = []
    for (let i = 1; i < p.c.length; i++) {
      const [x0, y0] = p.c[i - 1], [x1, y1] = p.c[i]
      const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L))
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * (k + 0.5)) / n, y0 + ((y1 - y0) * (k + 0.5)) / n])
    }
    const ll = new Float64Array(pts.length * 2), zone = new Uint8Array(pts.length), t = new Float64Array(pts.length * 2)
    pts.forEach(([x, y], i) => {
      const [lo, la] = toLL(x, y); ll[2 * i] = lo; ll[2 * i + 1] = la; t[2 * i] = x; t[2 * i + 1] = y
      const c = Math.floor((x - W.x0) / W.res), r = Math.floor((W.ytop - y) / W.res)
      zone[i] = c >= 0 && r >= 0 && c < W.w && r < W.h ? zr[r * W.w + c] : 0
    })
    xy.push(t)
    return { key: `${p.from}|${p.pair}|${p.to}`, from: p.from, to: p.to, pair: p.pair, w: p.w, len: pts.length, ll, zone }
  })
  const groups = new Map<string, { idx: number[]; cum: number[] }>()
  paths.forEach((p, i) => {
    const g = groups.get(`${p.from}|${p.pair}`) ?? { idx: [], cum: [] }
    g.idx.push(i); g.cum.push((g.cum[g.cum.length - 1] ?? 0) + p.w)
    groups.set(`${p.from}|${p.pair}`, g)
  })
  const geo = { paths, xy, byKey: new Map(paths.map((p, i) => [p.key, i])), groups }
  geoCache.set(key, geo)
  if (geoCache.size > 6) geoCache.delete(geoCache.keys().next().value!)
  return geo
}

/** Paths sampled every metre: lon/lat for drawing, zone, and a shaded flag (1 = in shade) for this time. */
export function buildNet(D: Data, st: EState, time: string): PedNet {
  setPierLines([...D.transfer, ...st.extraTransfer])
  const night = sunPosition(time).elevation <= 0
  const site = night ? null : siteShadow(D, st, time)
  const G = D.meta.grid
  const geo = geometry(D, st)
  const paths: PedPath[] = geo.paths.map((p, pi) => {
    const sh = new Uint8Array(p.len)
    if (site) {
      const t = geo.xy[pi]
      for (let i = 0; i < p.len; i++) {
        const col = Math.floor((t[2 * i] - G.x0) / G.res) - site.win.x, row = Math.floor((G.ytop - t[2 * i + 1]) / G.res) - site.win.y
        sh[i] = col >= 0 && row >= 0 && col < site.win.w && row < site.win.h && site.mask[row * site.win.w + col] ? 1 : 0
      }
    }
    return { ...p, shade: sh }
  })
  return { time, night, paths, byKey: geo.byKey, groups: geo.groups }
}

/** A destination path for an origin and a mode pair, drawn by weight. */
function pickPath(net: PedNet, group: string, r: number) {
  const g = net.groups.get(group)
  if (!g) return null
  const x = r * g.cum[g.cum.length - 1]
  const j = g.cum.findIndex(c => x <= c)
  return net.paths[g.idx[j < 0 ? g.idx.length - 1 : j]].key
}

export interface PedParams {
  windowMin: number
  ferryHeadway: number; ferryPax: number
  metroHeadway: number; metroPax: number
  shIskele: { metro: number; otobus: number; minibus: number }
  shMetro: { otobus: number; minibus: number }
  speedMean: number; speedSd: number
  seed: number
  demand: 'assumed' | 'ibb'
  transferShare: number       // % of measured boardings/alightings that walk to/from another mode (İBB mode, manual)
  transferFromData: boolean   // use the measured İstanbulkart transfer share instead of transferShare
}

/** İBB demand data for Kadıköy (etl/ridership.py). */
export interface Ridership {
  transfer: { iskele: number; metro: number } | null; year: number; daily: { iskele: Record<string, number>; metro: Record<string, number> }
  profile: { iskele: number[]; metro: number[] }; piers: string[]; sources: string[]; notes: string
  profileByDay?: { iskele: { wd: number[]; we: number[] }; metro: { wd: number[]; we: number[] } }
  dayRatio?: { iskele: { wd: number; we: number }; metro: { wd: number; we: number } }
  operatorShare?: { ibb: number; note: string }
}
export interface Demand { iskele: number[]; metro: number[]; startHour: number; month: number; transfer: { iskele: number; metro: number } | null }
export function hourlyDemand(r: Ridership, month: number) {
  const di = r.daily.iskele[String(month)] ?? 0, dm = r.daily.metro[String(month)] ?? 0
  return { iskele: r.profile.iskele.map(x => di * x), metro: r.profile.metro.map(x => dm * x) }
}
export const DEFAULT_PARAMS: PedParams = {
  windowMin: 60, ferryHeadway: 15, ferryPax: 120, metroHeadway: 6, metroPax: 80,
  shIskele: { metro: 35, otobus: 45, minibus: 20 }, shMetro: { otobus: 70, minibus: 30 },
  speedMean: 1.3, speedSd: 0.2, seed: 7, demand: 'assumed', transferShare: 40, transferFromData: true,
}

/** One walker. t0: start of the walk (s from the window start); wait: seconds standing at the end of the walk
 *  (at the pier until departure, at the bus/minibus stop until the vehicle comes). */
export interface Agent {
  key: string; t0: number; v: number; origin: 'iskele' | 'metro' | 'kent'; rev: boolean; ev: number
  flow: FlowId; wait: number; wk: '' | 'iskele' | 'otobus' | 'minibus'; dur: number; j: number
}

function rng(seed: number) {   // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function pick<T extends string>(r: number, sh: Record<T, number>): T {
  const tot = Object.values<number>(sh).reduce((s, v) => s + v, 0) || 1
  let acc = 0
  for (const [k, v] of Object.entries<number>(sh)) { acc += v / tot; if (r <= acc) return k as T }
  return Object.keys(sh)[0] as T
}
const lenOf = (net: PedNet, key: string) => { const i = net.byKey.get(key); return i == null ? 0 : net.paths[i].len }

/** Simple model (unchanged behaviour): deterministic arrivals for one window starting at the selected time. */
export function schedule(net: PedNet, P: PedParams, D: Demand | null = null): Agent[] {
  const R = rng(P.seed), W = P.windowMin * 60
  const gauss = () => { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  const speed = () => Math.max(0.6, P.speedMean + P.speedSd * gauss())
  const origins = (t: string) => [...new Set(net.paths.filter(p => p.pair.startsWith(t + '→')).map(p => p.from))]
  const out: Agent[] = []
  const piers = origins('iskele'), ms = origins('metro')
  const ibb = P.demand === 'ibb' && D
  const hourAt = (a: number) => Math.floor(((D?.startHour ?? 0) + a / 3600) % 24)
  const shI = ibb && P.transferFromData && D!.transfer ? D!.transfer.iskele : P.transferShare
  const shM = ibb && P.transferFromData && D!.transfer ? D!.transfer.metro : P.transferShare
  const perFerry = (a: number) => (ibb ? (D!.iskele[hourAt(a)] * shI / 100) / (Math.max(1, piers.length) * 60 / P.ferryHeadway) : P.ferryPax)
  const perTrain = (a: number) => (ibb ? (D!.metro[hourAt(a)] * shM / 100) / (60 / P.metroHeadway) : P.metroPax)
  const count = (x: number) => Math.floor(x) + (R() < x - Math.floor(x) ? 1 : 0)
  const add = (key: string, t0: number, origin: 'iskele' | 'metro', rev: boolean, ev: number) => {
    const v = speed()
    out.push({ key, t0, v, origin, rev, ev, flow: origin === 'iskele' ? (rev ? 'iskele_binen' : 'iskele_inen') : (rev ? 'metro_binen' : 'metro_inen'), wait: 0, wk: '', dur: lenOf(net, key) / v, j: out.length })
  }
  for (const rev of ibb ? [false, true] : [false]) {
    for (const pier of piers)
      for (let a = R() * P.ferryHeadway * 60; a < W; a += P.ferryHeadway * 60)
        for (let i = 0, n = count(perFerry(a)); i < n; i++) {
          const k = pickPath(net, `${pier}|iskele→${pick(R(), P.shIskele)}`, R())
          if (k) add(k, rev ? a - 60 - R() * 600 : a + R() * 120, 'iskele', rev, a)
        }
    if (ms.length) for (let a = R() * P.metroHeadway * 60; a < W; a += P.metroHeadway * 60)
      for (let i = 0, n = count(perTrain(a)); i < n; i++) {
        const k = pickPath(net, `${ms[Math.floor(R() * ms.length)]}|metro→${pick(R(), P.shMetro)}`, R())
        if (k) add(k, rev ? a - 60 - R() * 300 : a + 30 + R() * 90, 'metro', rev, a)
      }
  }
  for (const a of out) if (a.t0 < 0) a.t0 = R() * 60
  return out.sort((x, y) => x.t0 - y.t0)
}

// ------------------------------------------------------------------ dynamic 24 h model
export interface HourPlan {
  h: number; generated: number; byFlow: Record<FlowId, number>
  pierOut: number; pierIn: number; busTransfer: number; metroTransfer: number
  sailings: { sh: number; turyol: number; trains: number }
}
export interface Sailing { t: number; kind: 'arr' | 'dep'; op: 'sh' | 'turyol'; line: string; pier: string; est: boolean }
export interface DynamicPlan { agents: Agent[]; hours: HourPlan[]; sailings: Sailing[]; startH: number; endH: number; kind: 'wd' | 'we'; dayTotal: Record<FlowId, number>; demand: ReturnType<typeof flowDemand> }

const FLOW_IDS: FlowId[] = ['iskele_inen', 'iskele_binen', 'metro_inen', 'metro_binen', 'carsi', 'sosyal']
const zeroFlows = () => Object.fromEntries(FLOW_IDS.map(f => [f, 0])) as Record<FlowId, number>

/** 24 h schedule for a date; only walkers active inside [startH, endH) are kept (times relative to startH:00). */
export function scheduleDynamic(net: PedNet, P: PedParams, cfg: DemandCfg, rid: Ridership | null, ferry: FerryData | null, date: string,
  rain: (boolean | null)[], startH: number, endH: number): DynamicPlan {
  const R = rng(P.seed)
  const gauss = () => { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  const speed = () => Math.max(0.6, P.speedMean + P.speedSd * gauss())
  const count = (x: number) => Math.floor(x) + (R() < x - Math.floor(x) ? 1 : 0)
  const dem = flowDemand(cfg, rid, date, rain)
  const day = dem.day
  const vec = (f: FlowId) => dem.rows.filter(r => r.flow === f).sort((a, b) => a.h - b.h).map(r => r.n)
  const origins = (t: string) => [...new Set(net.paths.filter(p => p.pair.startsWith(t + '→')).map(p => p.from))]
  const piers = origins('iskele'), ms = origins('metro')
  const shI = P.transferFromData && rid?.transfer ? rid.transfer.iskele : P.transferShare
  const shM = P.transferFromData && rid?.transfer ? rid.transfer.metro : P.transferShare
  const ibbShare = rid?.operatorShare?.ibb ?? 0.71
  const gateW = cfg.gateShare
  const sosyalGates = { moda: gateW.moda, rihtim: gateW.rihtim, sahil: gateW.sahil }
  const hours: HourPlan[] = Array.from({ length: 24 }, (_, h) => ({ h, generated: 0, byFlow: zeroFlows(), pierOut: 0, pierIn: 0, busTransfer: 0, metroTransfer: 0, sailings: { sh: 0, turyol: 0, trains: 0 } }))
  const out: Agent[] = []
  const S0 = startH * 3600, S1 = endH * 3600
  /** until: absolute time the walker stands at the end of the walk until (departure); null = given waiting time */
  const add = (key: string | null, t0abs: number, origin: Agent['origin'], rev: boolean, ev: number, flow: FlowId, waitS: number, wk: Agent['wk'], mode: string, until: number | null = null) => {
    if (!key) return
    const i = net.byKey.get(key)
    if (i == null) return
    const v = speed(), dur = net.paths[i].len / v
    if (until != null) t0abs = until - waitS - dur        // reach the pier waitS seconds before departure
    const wait = waitS
    const h = Math.max(0, Math.min(23, Math.floor(ev / 3600)))
    const H = hours[h]
    H.generated++; H.byFlow[flow]++
    if (flow === 'iskele_inen') H.pierOut++
    if (flow === 'iskele_binen') H.pierIn++
    if (mode === 'otobus' || mode === 'minibus') H.busTransfer++
    if (mode === 'metro' || (flow.startsWith('metro') && (mode === 'otobus' || mode === 'minibus'))) H.metroTransfer++
    if (t0abs >= S1 || t0abs + dur + wait <= S0) return
    out.push({ key, t0: t0abs - S0, v, origin, rev, ev: ev - S0, flow, wait, wk, dur, j: out.length })
  }
  const busWait = (m: string) => (m === 'otobus' ? R() * cfg.busHeadway * 60 : m === 'minibus' ? R() * cfg.minibusHeadway * 60 : 0)
  const gateKey = (g: string, pair: string, to: string) => `${gateName(g)}|${pair}|${to}`

  // ---- ferry sailings: Şehir Hatları timetable (İBB share), Turyol on a headway (remaining share)
  const sailings: Sailing[] = []
  const lineIdx = new Map<string, number>()
  if (ferry) for (const e of ferry.events) {
    if (!e.days.includes(day.service)) continue
    const L = ferry.lines.find(l => l.name === e.line)
    const cand = (L?.piers ?? []).filter(p => piers.includes(p))
    const ps = cand.length ? cand : piers.slice(-1)
    const k = `${e.line}|${e.kind}`, n = lineIdx.get(k) ?? 0
    lineIdx.set(k, n + 1)
    const [hh, mm] = e.t.split(':').map(Number)
    sailings.push({ t: hh * 3600 + mm * 60, kind: e.kind, op: 'sh', line: e.line, pier: ps[n % ps.length], est: !!e.est })
  }
  const turyolPiers = piers.filter(p => /Turyol|eşleşen hat yok/i.test(netHat(net, p)))
  const tp = turyolPiers.length ? turyolPiers : piers
  for (const p of tp) for (let a = cfg.turyolHours[0] * 3600 + R() * cfg.turyolHeadway * 60; a < cfg.turyolHours[1] * 3600; a += cfg.turyolHeadway * 60) {
    sailings.push({ t: a, kind: 'arr', op: 'turyol', line: 'Turyol (sefer aralığı varsayımı)', pier: p, est: true })
    sailings.push({ t: a + 5 * 60, kind: 'dep', op: 'turyol', line: 'Turyol (sefer aralığı varsayımı)', pier: p, est: true })
  }
  sailings.sort((a, b) => a.t - b.t)
  const perEvent = (v: number[], share: number, evs: Sailing[]) => {
    const per: number[] = Array(24).fill(0), n = Array(24).fill(0)
    for (const e of evs) n[Math.floor(e.t / 3600) % 24]++
    const tot = onService(v.map(x => x * share), n.map(x => x > 0))
    for (let h = 0; h < 24; h++) per[h] = n[h] ? tot[h] / n[h] : 0
    return per
  }
  for (const op of ['sh', 'turyol'] as const) {
    const share = op === 'sh' ? ibbShare : 1 - ibbShare
    const arrs = sailings.filter(s => s.op === op && s.kind === 'arr'), deps = sailings.filter(s => s.op === op && s.kind === 'dep')
    for (const e of arrs) hours[Math.floor(e.t / 3600) % 24].sailings[op === 'sh' ? 'sh' : 'turyol']++
    const pa = perEvent(vec('iskele_inen'), share, arrs), pd = perEvent(vec('iskele_binen'), share, deps)
    for (const e of arrs) for (let i = 0, n = count(pa[Math.floor(e.t / 3600) % 24]); i < n; i++) {
      const t0 = e.t + 30 + R() * 180
      if (R() < shI / 100) { const m = pick(R(), P.shIskele); add(pickPath(net, `${e.pier}|iskele→${m}`, R()), t0, 'iskele', false, e.t, 'iskele_inen', busWait(m), m === 'metro' ? '' : m as Agent['wk'], m) }
      else add(gateKey(pick(R(), gateW), 'kent→iskele', e.pier), t0, 'iskele', true, e.t, 'iskele_inen', 0, '', 'kent')
    }
    for (const e of deps) for (let i = 0, n = count(pd[Math.floor(e.t / 3600) % 24]); i < n; i++) {
      const before = 60 * (cfg.accum.to + R() * Math.max(0, cfg.accum.from - cfg.accum.to))   // waiting at the pier
      if (R() < shI / 100) {
        const m = pick(R(), P.shIskele)
        add(pickPath(net, `${e.pier}|iskele→${m}`, R()), 0, 'iskele', true, e.t, 'iskele_binen', before, 'iskele', m, e.t)
      } else add(gateKey(pick(R(), gateW), 'kent→iskele', e.pier), 0, 'kent', false, e.t, 'iskele_binen', before, 'iskele', 'kent', e.t)
    }
  }

  // ---- M4 trains (headway assumption) in the hours with measured boardings
  const kind = dem.kind
  const prof = rid?.profileByDay?.metro[kind] ?? rid?.profile.metro ?? Array(24).fill(1 / 24)
  const served = prof.map(x => x > 0.001)
  const trains: number[] = []
  if (ms.length) for (let h = 0; h < 24; h++) if (served[h]) for (let a = h * 3600 + R() * P.metroHeadway * 60; a < (h + 1) * 3600; a += P.metroHeadway * 60) trains.push(a)
  const tn = Array(24).fill(0); for (const a of trains) tn[Math.floor(a / 3600)]++
  for (let h = 0; h < 24; h++) hours[h].sailings.trains = tn[h]
  const mi = onService(vec('metro_inen'), served), mb = onService(vec('metro_binen'), served)
  for (const a of trains) {
    const h = Math.floor(a / 3600)
    for (let i = 0, n = count(mi[h] / tn[h]); i < n; i++) {
      const m0 = ms[Math.floor(R() * ms.length)], t0 = a + 30 + R() * 90
      if (R() < shM / 100) { const m = pick(R(), P.shMetro); add(pickPath(net, `${m0}|metro→${m}`, R()), t0, 'metro', false, a, 'metro_inen', busWait(m), m as Agent['wk'], m) }
      else add(gateKey(pick(R(), gateW), 'kent→metro', m0), t0, 'metro', true, a, 'metro_inen', 0, '', 'kent')
    }
    for (let i = 0, n = count(mb[h] / tn[h]); i < n; i++) {
      const m0 = ms[Math.floor(R() * ms.length)], arrive = a - R() * P.metroHeadway * 60   // enters the station; waits underground (not drawn)
      if (R() < shM / 100) { const m = pick(R(), P.shMetro); add(pickPath(net, `${m0}|metro→${m}`, R()), 0, 'metro', true, a, 'metro_binen', 0, '', m, arrive) }
      else add(gateKey(pick(R(), gateW), 'kent→metro', m0), 0, 'kent', false, a, 'metro_binen', 0, '', 'kent', arrive)
    }
  }

  // ---- non-transit pedestrians: çarşı and meydan/sahil (half towards the spot, half back to the gate)
  for (const f of ['carsi', 'sosyal'] as const) {
    const v = vec(f)
    for (let h = 0; h < 24; h++) for (let i = 0, n = count(v[h]); i < n; i++) {
      const t0 = h * 3600 + R() * 3600
      const g = f === 'carsi' ? 'carsi' : pick(R(), sosyalGates)
      const spot = SPOTS[Math.floor(R() * SPOTS.length)].label
      add(gateKey(g, 'kent→meydan', spot), t0, 'kent', R() < 0.5, t0, f, 0, '', 'kent')
    }
  }
  const dayTotal = zeroFlows()
  for (const H of hours) for (const f of FLOW_IDS) dayTotal[f] += H.byFlow[f]
  return { agents: out.sort((x, y) => x.t0 - y.t0), hours, sailings: sailings.map(s => ({ ...s, t: s.t - S0 })).filter(s => s.t >= 0 && s.t <= S1 - S0), startH, endH, kind, dayTotal, demand: dem }
}
let hatByPier: Map<string, string> | null = null
/** The pier's ferry-line attribute (from the transfer points): which operators call there. */
function netHat(_net: PedNet, pier: string) { return hatByPier?.get(pier) ?? '' }
export function setPierLines(pts: TransferPoint[]) { hatByPier = new Map(pts.filter(p => p.tur === 'iskele').map(p => [p.ad, String(p.hat ?? '')])) }

// ------------------------------------------------------------------ exposure, positions, statistics
export interface PedMetrics { n: number; walkMin: number; sunMin: number; shadeMin: number; meanSunMin: number; sunShare: number; night: boolean }
const sunCache = new WeakMap<PedNet, Float64Array>()
const sunMetres = (net: PedNet) => {
  let s = sunCache.get(net)
  if (!s) { s = Float64Array.from(net.paths.map(p => p.shade.reduce((a, v) => a + (v ? 0 : 1), 0))); sunCache.set(net, s) }
  return s
}
/** Exact exposure of every scheduled trip: Σ metres in sun (or shade) / walking speed; each trip uses the shade of its hour. */
export function metrics(netAt: PedNet | ((t: number) => PedNet | null), agents: Agent[]): PedMetrics {
  let walk = 0, sun = 0, n = 0, allNight = true
  for (const a of agents) {
    const net = typeof netAt === 'function' ? netAt(a.t0) : netAt
    if (!net) continue
    const i = net.byKey.get(a.key)
    if (i == null) continue
    n++; walk += net.paths[i].len / a.v
    if (!net.night) { allNight = false; sun += sunMetres(net)[i] / a.v }
  }
  const w = walk / 60, s = sun / 60
  return { n, walkMin: w, sunMin: s, shadeMin: allNight ? 0 : w - s, meanSunMin: n ? s / n : 0, sunShare: w ? s / w : 0, night: allNight }
}

/** Walkers within this distance (along their path) of the pier or M4 structure count as "around the pier / metro" (simple model). */
export const NEAR_M = 50

/** Ferry arrival times (s) used by the simple model's schedule: the timeline marks them. */
export function ferryArrivals(agents: Agent[]) {
  return [...new Set(agents.filter(a => a.origin === 'iskele' && !a.rev).map(a => a.ev))].sort((x, y) => x - y)
}

const maxDur = new WeakMap<Agent[], number>()
function firstActive(agents: Agent[], t: number) {
  let m = maxDur.get(agents)
  if (m == null) { m = agents.reduce((s, a) => Math.max(s, a.dur + a.wait), 0); maxDur.set(agents, m) }
  let lo = 0, hi = agents.length
  const t0 = t - m - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (agents[mid].t0 < t0) lo = mid + 1; else hi = mid }
  return lo
}

export interface PosStats { walking: number; inSun: number; waitPier: number; waitStop: number; nearPier: number; nearMetro: number; zone: number[] }
/** Walkers and waiting passengers at simulation second t, as map features (s: 0 sun, 1 shade, 2 night, 3 waiting). */
export function positions(net: PedNet, agents: Agent[], t: number, features = true) {
  const fs: GeoJSON.Feature[] = []
  const S: PosStats = { walking: 0, inSun: 0, waitPier: 0, waitStop: 0, nearPier: 0, nearMetro: 0, zone: [0, 0, 0, 0, 0, 0] }
  for (let k = firstActive(agents, t); k < agents.length; k++) {
    const a = agents[k]
    if (a.t0 > t) break
    const i = net.byKey.get(a.key)
    if (i == null) continue
    const p = net.paths[i], d0 = Math.floor((t - a.t0) * a.v)
    let d: number, s: number
    if (d0 < p.len) {
      d = a.rev ? p.len - 1 - d0 : d0
      S.walking++
      s = net.night ? 2 : p.shade[d]
      if (s === 0) S.inSun++
      if (!a.wk && a.wait === 0 && p.pair.startsWith('iskele') && d <= NEAR_M) S.nearPier++
    } else {
      if (t - a.t0 - a.dur >= a.wait) continue
      d = a.rev ? 0 : p.len - 1
      s = 3
      if (a.wk === 'iskele') S.waitPier++; else S.waitStop++
    }
    S.zone[p.zone[d]]++
    if (features) {
      let lo = p.ll[2 * d], la = p.ll[2 * d + 1]
      if (s === 3) { const ang = a.j * 2.39996, r = 1.2 + (a.j % 7) * 0.7; lo += (r * Math.cos(ang)) / 84300; la += (r * Math.sin(ang)) / 111000 }
      fs.push({ type: 'Feature', properties: { s, o: a.origin }, geometry: { type: 'Point', coordinates: [lo, la] } })
    }
  }
  S.nearPier = S.zone[1]; S.nearMetro = S.zone[2]
  return { fc: { type: 'FeatureCollection', features: fs } as GeoJSON.FeatureCollection, ...S }
}

/** Seconds until the last scheduled agent arrives (and stops waiting). */
export function endTime(net: PedNet, agents: Agent[]) {
  let e = 0
  for (const a of agents) { const i = net.byKey.get(a.key); if (i != null) e = Math.max(e, a.t0 + net.paths[i].len / a.v + a.wait) }
  return e
}

export interface HourStats { h: number; walkAvg: number; walkMax: number; waitStopAvg: number; waitStopMax: number; waitPierMax: number; densMax: number[]; densZone: number }
/** Minute-by-minute sampling of the window: moving and waiting people, peak persons per m² of walkable area per zone. */
export function hourlyStats(net: PedNet, agents: Agent[], startH: number, endH: number, area: number[]): HourStats[] {
  const out: HourStats[] = []
  for (let h = startH; h < endH; h++) {
    let wS = 0, wM = 0, sS = 0, sM = 0, pM = 0, n = 0
    const dm = [0, 0, 0, 0, 0, 0]
    for (let t = (h - startH) * 3600; t < (h - startH + 1) * 3600; t += 60) {
      const r = positions(net, agents, t, false)
      n++; wS += r.walking; wM = Math.max(wM, r.walking); sS += r.waitStop; sM = Math.max(sM, r.waitStop); pM = Math.max(pM, r.waitPier)
      for (let z = 1; z < 6; z++) if (area[z] > 0) dm[z] = Math.max(dm[z], r.zone[z] / area[z])
    }
    let dz = 1
    for (let z = 1; z < 6; z++) if (dm[z] > dm[dz]) dz = z
    out.push({ h, walkAvg: wS / n, walkMax: wM, waitStopAvg: sS / n, waitStopMax: sM, waitPierMax: pM, densMax: dm, densZone: dz })
  }
  return out
}
