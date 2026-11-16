// Live İBB traffic linked to the other analyses — observations only, no traffic model:
//   * pedestrian exposure: parts of a transfer walking path lying ≤ EXPOSE_M from a road segment that is "Yoğun"/"Çok yoğun" now
//   * scenario context: road segments crossing an intervention area, their live speed/class and the number of bus lines there
//   * bus line travel time: the live time to drive a line's route inside the context area (Σ length / live speed)
// All geometry is handled in TUREF/TM30 metres.
import { pointInPolys, toTM, type Poly, type XY } from './data'
import type { TrafficState } from './traffic'

export const EXPOSE_M = 10       // a walking path counts as next to a road within this distance
export const CONGESTED_C = 4     // İBB class 4 = Yoğun, 5 = Çok yoğun
export const ROUTE_MATCH_M = 12  // a bus route sample takes the speed of a traffic segment within this distance

export interface Seg { S: number; C: number; V: number | null; D: string; c: XY[]; box: [number, number, number, number]; ilce: string }

const bboxOf = (c: XY[], pad = 0): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}

/** Traffic segments in TM30 with the live record merged (C = 0 when the segment has no data now). */
export function prepSegs(fc: GeoJSON.FeatureCollection, st: TrafficState): Seg[] {
  return fc.features.map(f => {
    const g = f.geometry as GeoJSON.LineString
    const c = g.coordinates.map(([lon, lat]) => toTM(lon, lat))
    const r = st.recs[Number(f.properties!.S)]
    return { S: Number(f.properties!.S), C: r?.C ?? 0, V: r && r.C ? r.V : null, D: r?.D ?? '', c, box: bboxOf(c), ilce: String(f.properties!.ilce ?? '') }
  })
}

function distToLine([px, py]: XY, c: XY[]) {
  let best = Infinity
  for (let i = 1; i < c.length; i++) {
    const [x0, y0] = c[i - 1], [x1, y1] = c[i]
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0
    best = Math.min(best, Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)))
  }
  return best
}

/** Samples along a line every `step` metres: [point, length represented]. */
function samples(line: XY[], step: number): [XY, number][] {
  const out: [XY, number][] = []
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i]
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / step))
    for (let k = 0; k < n; k++) out.push([[x0 + ((x1 - x0) * (k + 0.5)) / n, y0 + ((y1 - y0) * (k + 0.5)) / n], L / n])
  }
  return out
}

const near = (p: XY, s: Seg, d: number) => p[0] >= s.box[0] - d && p[0] <= s.box[2] + d && p[1] >= s.box[1] - d && p[1] <= s.box[3] + d && distToLine(p, s.c) <= d

export interface Exposure { len: number; tot: number; stretches: XY[][]; worst: number }
/** Length of a walking path next to congested road segments right now. */
export function pathExposure(path: XY[], segs: Seg[]): Exposure {
  const hot = segs.filter(s => s.C >= CONGESTED_C)
  let len = 0, tot = 0, worst = 0
  const stretches: XY[][] = []
  let cur: XY[] | null = null
  for (const [p, L] of samples(path, 1)) {
    tot += L
    const hit = hot.find(s => near(p, s, EXPOSE_M))
    if (hit) { len += L; worst = Math.max(worst, hit.C); (cur ??= []).push(p) } else if (cur) { if (cur.length > 2) stretches.push(cur); cur = null }
  }
  if (cur && cur.length > 2) stretches.push(cur)
  return { len, tot, stretches, worst }
}

export interface AreaTraffic { segs: { S: number; C: number; V: number | null; inside: number }[]; inside: number; meanSpeed: number | null; worst: number; lines: number; lineNames: string[]; time: string }
/** Road segments crossing intervention areas (TM30 polygons) and the bus corridors there. */
export function areaTraffic(areas: Poly[], segs: Seg[], corridors: GeoJSON.FeatureCollection | null): AreaTraffic {
  const out: AreaTraffic['segs'] = []
  let inside = 0, vs = 0, vl = 0, worst = 0, time = ''
  for (const s of segs) {
    let L = 0
    for (const [p, l] of samples(s.c, 2)) if (pointInPolys(p, areas)) L += l
    if (L < 1) continue
    out.push({ S: s.S, C: s.C, V: s.V, inside: L })
    inside += L; worst = Math.max(worst, s.C); if (s.D) time = s.D
    if (s.V != null) { vs += s.V * L; vl += L }
  }
  let lines = 0
  const names = new Set<string>()
  for (const f of corridors?.features ?? []) {
    const c = (f.geometry as GeoJSON.LineString).coordinates.map(([lon, lat]) => toTM(lon, lat))
    if (samples(c, 3).some(([p]) => pointInPolys(p, areas))) {
      lines = Math.max(lines, Number(f.properties!.hat_sayisi) || 0)
      String(f.properties!.hatlar ?? '').split(',').map(x => x.trim()).filter(Boolean).forEach(x => names.add(x))
    }
  }
  return { segs: out.sort((a, b) => b.inside - a.inside), inside, meanSpeed: vl ? vs / vl : null, worst, lines, lineNames: [...names], time }
}

export interface LineTime { dir: string; covered: number; total: number; minutes: number | null; meanSpeed: number | null }
/** Live drive time of a bus line inside the traffic context area, per direction (only where a live speed is available). */
export function lineLiveTime(routes: GeoJSON.Feature[], segs: Seg[]): LineTime[] {
  const live = segs.filter(s => s.V != null && s.V > 0)
  return routes.map(f => {
    const g = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString
    const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).map(l => l.map(([lon, lat]) => toTM(lon, lat)))
    let total = 0, covered = 0, sec = 0
    for (const l of lines) for (const [p, L] of samples(l, 5)) {
      total += L
      let best: Seg | null = null, bd = Infinity
      for (const s of live) { if (!near(p, s, ROUTE_MATCH_M)) continue; const d = distToLine(p, s.c); if (d < bd) { bd = d; best = s } }
      if (best) { covered += L; sec += L / ((best.V as number) / 3.6) }
    }
    return { dir: String(f.properties?.YON ?? ''), covered, total, minutes: covered ? sec / 60 : null, meanSpeed: sec ? (covered / sec) * 3.6 : null }
  })
}
