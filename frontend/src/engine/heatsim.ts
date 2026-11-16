// Literature-based heat simulation: how the observed Landsat LST could change when surface cover changes.
// This is NOT a physical model. Per LST pixel (≈23×30 m):
//   ΔLST = β · Δ(vegetation share)                       — local calibration (default), β from Kadıköy LST vs orthophoto cover
//   ΔLST = −24 · Δ(green ground share) − 19 · Δ(new canopy share)  — literature upper bound (Armson et al. 2012, max surface temp)
//   + albedo term for cool pavements in both modes: −4.5 K per +0.1 albedo × changed share (Santamouris 2013, derived, low confidence)
// Shade structures and PV are not simulated: the satellite would see their roofs, not the shaded ground.
import { pointInPolys, toTM, type Data } from './data'
import { C, albedoRange, lit, type EState } from './kpi'
import { crownMask } from './shadow'
import { fullWindow } from './raster'
import type { Upload } from './uploads'

export type SimMode = 'local' | 'literature'
export type SimView = 'lst' | 'delta'

const S = 8 // samples per pixel side

interface Sampler { pix: Int32Array; cells: Int32Array; n: number; inSite: Uint8Array }
let sampler: Sampler | null = null

/** For each LST pixel that overlaps the analysis grid: S×S sample cells of the 0.5 m grid. */
function getSampler(D: Data, u: Upload): Sampler {
  if (sampler) return sampler
  const G = D.meta.grid, R = u.raster!
  const pix: number[] = [], cells: number[] = [], inSite: number[] = []
  for (let r = 0; r < R.h; r++) for (let c = 0; c < R.w; c++) {
    if (!isFinite(R.values[r * R.w + c])) continue
    const idx: number[] = []
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const [lon, lat] = R.toLL(c + (j + 0.5) / S, r + (i + 0.5) / S)
      const [x, y] = toTM(lon, lat)
      const col = Math.floor((x - G.x0) / G.res), row = Math.floor((G.ytop - y) / G.res)
      idx.push(col < 0 || row < 0 || col >= G.w || row >= G.h ? -1 : row * G.w + col)
    }
    if (idx.every(k => k < 0)) continue
    pix.push(r * R.w + c)
    cells.push(...idx)
    const [clon, clat] = R.toLL(c + 0.5, r + 0.5)
    inSite.push(pointInPolys(toTM(clon, clat), D.boundary) ? 1 : 0)
  }
  sampler = { pix: Int32Array.from(pix), cells: Int32Array.from(cells), n: pix.length, inSite: Uint8Array.from(inSite) }
  return sampler
}

const crownCache = new Map<string, Uint8Array>()
function crowns(D: Data, st: EState) {
  const key = `${st.key}|${st.trees.length}`
  if (!crownCache.has(key)) crownCache.set(key, crownMask(D.meta.grid, fullWindow(D.meta.grid), st.trees))
  return crownCache.get(key)!
}

export interface HeatSim {
  mode: SimMode; delta: Float32Array; sim: Float32Array; stats: Record<string, number>; changed: number
}

export function simulate(D: Data, u: Upload, base: EState, st: EState, mode: SimMode): HeatSim {
  const R = u.raster!
  const sm = getSampler(D, u)
  const cB = crowns(D, base), cS = crowns(D, st)
  const beta = D.meta.lst?.kalibrasyon?.beta_veg_C_per_full_cover ?? -1.54
  const grass = -(lit(D, 'grass_tsurf').deger?.[1] ?? 24)
  const shade = -(lit(D, 'shade_tsurf_tree').deger?.[1] ?? 19)
  const kAlb = lit(D, 'tsurf_per_albedo_derived').deger?.[0] ?? -4.5 // K per 0.1 albedo
  const delta = new Float32Array(R.values.length)
  let changed = 0
  for (let k = 0; k < sm.n; k++) {
    let vegB = 0, vegS = 0, grB = 0, grS = 0, canNew = 0, alb = 0, n = 0
    for (let s = 0; s < S * S; s++) {
      const g = sm.cells[k * S * S + s]
      if (g < 0) continue
      n++
      const b = base.cls[g], a = st.cls[g]
      const gb = b === C.yesil, ga = a === C.yesil
      vegB += gb || cB[g] ? 1 : 0
      vegS += ga || cS[g] ? 1 : 0
      grB += gb ? 1 : 0; grS += ga ? 1 : 0
      if (cS[g] && !cB[g] && !ga) canNew++
      const custom = st.alb ? st.alb[g] : 0
      if (custom) {
        const rng = albedoRange(D, base.mat[g] & 15)
        if (rng) alb += custom / 100 - (rng[0] + rng[1]) / 2
      }
    }
    if (!n) continue
    let d = mode === 'local' ? beta * (vegS - vegB) / n : (grass * (grS - grB) + shade * canNew) / n
    d += (kAlb * (alb / n)) / 0.1
    if (Math.abs(d) > 0.005) { delta[sm.pix[k]] = d; changed++ }
  }
  const sim = new Float32Array(R.values.length)
  let sumObs = 0, sumSim = 0, cnt = 0, hotObs = 0, hotSim = 0, minD = 0, maxD = 0, sumD = 0, nD = 0
  const site = D.meta.lst?.yorum?.calisma_alani_kara?.p90 ?? 38.9
  for (let i = 0; i < sim.length; i++) {
    const v = R.values[i]
    sim[i] = isFinite(v) ? v + delta[i] : NaN
  }
  for (let k = 0; k < sm.n; k++) {
    if (!sm.inSite[k]) continue // statistics: pixels whose centre lies inside the study-area boundary
    const i = sm.pix[k], v = R.values[i]
    sumObs += v; sumSim += sim[i]; cnt++
    if (v >= site) hotObs++
    if (sim[i] >= site) hotSim++
    if (delta[i]) { minD = Math.min(minD, delta[i]); maxD = Math.max(maxD, delta[i]); sumD += delta[i]; nD++ }
  }
  return { mode, delta, sim, changed, stats: { ort_gozlem: sumObs / cnt, ort_sim: sumSim / cnt, sicak_gozlem: hotObs, sicak_sim: hotSim,
    sicak_esik: site, en_fazla_serinleme: minD, en_fazla_isinma: maxD, degisen_ort: nD ? sumD / nD : 0, piksel: cnt } }
}

function lerp(p: number[], q: number[], k: number) { return p.map((v, i) => Math.round(v + (q[i] - v) * k)) }
const BLUE = [42, 120, 214], MID = [240, 239, 236], RED = [227, 73, 72]

/** Colour a value grid like the observed heat layer (same p2–p98 scale), or the change grid on a symmetric scale. */
export function simCanvas(u: Upload, h: HeatSim, view: SimView) {
  const R = u.raster!
  const cv = document.createElement('canvas'); cv.width = R.w; cv.height = R.h
  const img = new ImageData(R.w, R.h)
  const m = Math.max(0.5, ...Array.from(h.delta).map(Math.abs))
  for (let i = 0; i < h.sim.length; i++) {
    let rgb: number[] | null = null, a = 190
    if (view === 'lst') {
      const v = h.sim[i]
      if (!isFinite(v)) continue
      const t = Math.max(0, Math.min(1, (v - R.p2) / Math.max(1e-9, R.p98 - R.p2)))
      rgb = t < 0.5 ? lerp(BLUE, MID, t * 2) : lerp(MID, RED, (t - 0.5) * 2)
    } else {
      const d = h.delta[i]
      if (!d || !isFinite(R.values[i])) continue
      const t = Math.max(-1, Math.min(1, d / m))
      rgb = t < 0 ? lerp(MID, BLUE, -t) : lerp(MID, RED, t)
      a = 220
    }
    img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = a
  }
  cv.getContext('2d')!.putImageData(img, 0, 0)
  return { canvas: cv, corners: R.corners, scaleMax: m }
}
