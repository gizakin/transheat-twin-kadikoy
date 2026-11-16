// Pedestrian comfort along the transfer walking paths, hour by hour. No thermal comfort index is computed (no microclimate
// model, no weather data); the indicators are geometric or observed proxies, reported separately and never combined:
//   * shaded share of the path at each hour (sun geometry + buildings, trees, structures; clear sky)  → geometric
//   * minutes walked in the sun (unshaded length / assumed walking speed)                                → geometric + assumption
//   * mean satellite surface temperature along the path (Landsat 2025, one daytime overpass)            → observed
//   * the longest continuous sun-exposed stretches — candidate places for shade                           → geometric
import { toLL, type Data, type XY } from './data'
import { siteShadow, transferPaths, type EState } from './kpi'
import { sunPosition } from './sun'

export const COMFORT_HOURS = Array.from({ length: 14 }, (_, i) => 7 + i)   // 07:00 … 20:00
export const WALK_SPEED = 1.2   // m/s — assumption, labelled as such in the UI
export const MIN_STRETCH_M = 15

export interface Stretch { len: number; c: XY[] }
export interface ComfortPath {
  id: number; from: string; to: string; pair: string; dist_m: number; c: XY[]
  shade: (number | null)[]     // per hour, 0–1; null = sun below the horizon
  sunMin: (number | null)[]    // minutes walked in the sun, per hour
  stretches: Stretch[][]       // per hour, longest sun-exposed stretches first (≥ MIN_STRETCH_M)
  lst: number | null           // mean Landsat surface temperature along the path (°C)
}
export interface ComfortProfile { date: string; state: string; hours: number[]; elev: number[]; paths: ComfortPath[] }

export interface LstGrid { w: number; h: number; origin: [number, number]; res: [number, number]; values: (number | null)[] }

function walkLine(D: Data, line: XY[], site: ReturnType<typeof siteShadow>) {
  const G = D.meta.grid
  let tot = 0, sh = 0
  const runs: Stretch[] = []
  let cur: Stretch | null = null
  const close = () => { if (cur && cur.len >= MIN_STRETCH_M) runs.push(cur); cur = null }
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i]
    const L = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(1, Math.round(L))
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * (k + 0.5)) / n, y = y0 + ((y1 - y0) * (k + 0.5)) / n
      const col = Math.floor((x - G.x0) / G.res) - site.win.x, row = Math.floor((G.ytop - y) / G.res) - site.win.y
      const shaded = col >= 0 && row >= 0 && col < site.win.w && row < site.win.h && !!site.mask[row * site.win.w + col]
      tot += L / n
      if (shaded) { sh += L / n; close() }
      else { cur ??= { len: 0, c: [] }; cur.len += L / n; cur.c.push([x, y]) }
    }
  }
  close()
  runs.sort((a, b) => b.len - a.len)
  return { tot, sh, runs: runs.slice(0, 3) }
}

function lstAlong(lst: LstGrid | null, line: XY[]) {
  if (!lst) return null
  let s = 0, n = 0
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i]
    const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5))
    for (let j = 0; j < k; j++) {
      const [lon, lat] = toLL(x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k)
      const c = Math.floor((lon - lst.origin[0]) / lst.res[0]), r = Math.floor((lat - lst.origin[1]) / lst.res[1])
      if (c < 0 || r < 0 || c >= lst.w || r >= lst.h) continue
      const v = lst.values[r * lst.w + c]
      if (v != null) { s += v; n++ }
    }
  }
  return n ? s / n : null
}

export async function comfortProfile(D: Data, st: EState, date: string, lst: LstGrid | null, yieldUI: () => Promise<unknown>): Promise<ComfortProfile> {
  const paths = transferPaths(D, st.extraTransfer)
  const out: ComfortPath[] = paths.map((p, id) => ({ id, from: p.from, to: p.to, pair: p.pair, dist_m: p.dist_m, c: p.c,
    shade: [], sunMin: [], stretches: [], lst: lstAlong(lst, p.c) }))
  const elev: number[] = []
  for (const h of COMFORT_HOURS) {
    await yieldUI()
    const time = `${date}T${String(h).padStart(2, '0')}:00`
    const sun = sunPosition(time)
    elev.push(sun.elevation)
    if (sun.elevation <= 0) { out.forEach(p => { p.shade.push(null); p.sunMin.push(null); p.stretches.push([]) }); continue }
    const site = siteShadow(D, st, time)
    paths.forEach((p, i) => {
      const r = walkLine(D, p.c, site)
      out[i].shade.push(r.tot ? r.sh / r.tot : 0)
      out[i].sunMin.push((r.tot - r.sh) / WALK_SPEED / 60)
      out[i].stretches.push(r.runs)
    })
  }
  return { date, state: st.label, hours: COMFORT_HOURS, elev, paths: out }
}

/** Map features: every path coloured by its shaded share at hour index `hi`; the selected path's sun-exposed stretches on top. */
export function comfortFC(prof: ComfortProfile, hi: number, sel: number | null, focus: Stretch | null, traffic: XY[][] = []): GeoJSON.FeatureCollection {
  const line = (c: XY[]) => ({ type: 'LineString' as const, coordinates: c.map(([x, y]) => toLL(x, y)) })
  const fs: GeoJSON.Feature[] = prof.paths.map(p => ({ type: 'Feature', properties: { kind: 'path', id: p.id, sel: p.id === sel,
    shade: hi >= 0 ? p.shade[hi] ?? -1 : -1, from: p.from, to: p.to, dist_m: p.dist_m }, geometry: line(p.c) }))
  const sp = sel != null ? prof.paths[sel] : null
  for (const s of sp && hi >= 0 ? sp.stretches[hi] ?? [] : []) fs.push({ type: 'Feature', properties: { kind: 'sun', len: Math.round(s.len) }, geometry: line(s.c) })
  if (focus) fs.push({ type: 'Feature', properties: { kind: 'focus', len: Math.round(focus.len) }, geometry: line(focus.c) })
  for (const c of traffic) fs.push({ type: 'Feature', properties: { kind: 'traffic' }, geometry: line(c) })
  return { type: 'FeatureCollection', features: fs }
}

/** A strip of `half` metres on each side of a stretch, as a lon/lat polygon (for a tree-planting intervention). */
export function stretchPolygon(s: Stretch, half = 3): GeoJSON.Polygon {
  const c = s.c.filter((_, i) => i % 2 === 0 || i === s.c.length - 1)
  const L: XY[] = [], R: XY[] = []
  c.forEach((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)]
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1
    L.push([p[0] - (dy / n) * half, p[1] + (dx / n) * half]); R.push([p[0] + (dy / n) * half, p[1] - (dx / n) * half])
  })
  const ring = [...L, ...R.reverse()]
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring.map(([x, y]) => toLL(x, y))] }
}
