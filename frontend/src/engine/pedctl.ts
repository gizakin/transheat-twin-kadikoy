import { useSyncExternalStore } from 'react'
import { DEFAULT_CFG, type DemandCfg } from './demand'

/** Shared playback state of the pedestrian simulation: the panel runs the simulation, the map timeline controls it.
 *  A tiny store instead of React state in App, so the 60 fps clock and the counters do not re-render the whole app. */
export interface PedInfo {
  tEnd: number; n: number; walking: number; inSun: number; nearPier: number; nearMetro: number
  ferries: number[]; start: string; ibb: boolean; night: boolean; windowMin: number; busy: string
  waitPier?: number; waitStop?: number; label?: string; deps?: number[]
}
interface S { running: boolean; speed: number; info: PedInfo | null; cfg: DemandCfg }
const CFG_KEY = 'transheat.demand'
const loadCfg = (): DemandCfg => {
  try { const v = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); return { ...DEFAULT_CFG, ...v, event: { ...DEFAULT_CFG.event, ...(v.event ?? {}) } } } catch { return DEFAULT_CFG }
}
let st: S = { running: true, speed: 30, info: null, cfg: loadCfg() }
const subs = new Set<() => void>()

export const ped = {
  /** simulated seconds since the window start (mutated by the animation loop and by the timeline) */
  t: 0,
  get: () => st,
  set: (p: Partial<S>) => {
    st = { ...st, ...p }
    if (p.cfg) try { localStorage.setItem(CFG_KEY, JSON.stringify(p.cfg)) } catch { /* storage unavailable */ }
    subs.forEach(f => f())
  },
  setCfg: (p: Partial<DemandCfg>) => ped.set({ cfg: { ...st.cfg, ...p } }),
  sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
}
export const usePed = () => useSyncExternalStore(ped.sub, ped.get)

/** hh:mm of a simulation second, from the window start "YYYY-MM-DDTHH:MM" */
export const simClock = (time: string, t: number) => {
  const [h, m] = time.slice(11, 16).split(':').map(Number)
  const s = h * 3600 + m * 60 + Math.floor(t)
  return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}

/** Demand settings only: components that edit them do not re-render on every simulation tick. */
export const useCfg = () => useSyncExternalStore(ped.sub, () => ped.get().cfg)

// automation hook for the film/E2E scripts (only with ?e2e in the address)
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')) (window as any).__ped = ped
