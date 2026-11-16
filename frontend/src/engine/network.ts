// Shortest walking paths on the 2 m walkable grid (land − buildings), 8-connected Dijkstra.
// Same surface and assumptions as backend/app/core/network.py: carriageways are not separated,
// so distances are an optimistic lower bound.
import type { Data, XY } from './data'

class Heap {
  k: number[] = []; v: number[] = []
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p }
    k[i] = key; v[i] = val
  }
  pop(): [number, number] | null {
    const k = this.k, v = this.v
    if (!k.length) return null
    const top: [number, number] = [k[0], v[0]]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= k.length) break
        if (c + 1 < k.length && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

function snap(D: Data, [x, y]: XY) {
  const W = D.meta.walk
  let c = Math.round((x - W.x0) / W.res), r = Math.round((W.ytop - y) / W.res)
  c = Math.max(0, Math.min(W.w - 1, c)); r = Math.max(0, Math.min(W.h - 1, r))
  if (D.walk[r * W.w + c]) return r * W.w + c
  for (let rad = 1; rad < 60; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr >= 0 && cc >= 0 && rr < W.h && cc < W.w && D.walk[rr * W.w + cc]) return rr * W.w + cc
    }
  }
  return r * W.w + c
}

/** Distances (m) and paths from one origin to each target. */
export function pathsFrom(D: Data, origin: XY, targets: XY[]): { d: number | null; path: XY[] }[] {
  const W = D.meta.walk
  const n = W.w * W.h
  const dist = new Float32Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const s = snap(D, origin)
  const goals = new Set(targets.map(t => snap(D, t)))
  let left = goals.size
  dist[s] = 0
  const h = new Heap()
  h.push(0, s)
  const nb = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]]
  for (let it = h.pop(); it; it = h.pop()) {
    const [d, i] = it
    if (d > dist[i]) continue
    if (goals.has(i)) { left--; if (!left) break }
    const r = (i / W.w) | 0, c = i - r * W.w
    for (const [dr, dc, w] of nb) {
      const rr = r + dr, cc = c + dc
      if (rr < 0 || cc < 0 || rr >= W.h || cc >= W.w) continue
      const j = rr * W.w + cc
      if (!D.walk[j]) continue
      const nd = d + w
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; h.push(dist[j], j) } // push the stored float32 value so the stale-entry check stays exact
    }
  }
  return targets.map(t => {
    const g = snap(D, t)
    if (!isFinite(dist[g])) return { d: null, path: [] }
    const path: XY[] = []
    for (let i = g; i >= 0; i = prev[i]) {
      const r = (i / W.w) | 0, c = i - r * W.w
      path.push([W.x0 + c * W.res, W.ytop - r * W.res])
      if (i === s) break
    }
    return { d: dist[g] * W.res, path: path.reverse() }
  })
}

/** Walking distance (m) from the nearest of several sources to every cell of the 2 m walk grid. */
export function distanceField(D: Data, sources: XY[]): Float32Array {
  const W = D.meta.walk
  const dist = new Float32Array(W.w * W.h).fill(Infinity)
  const h = new Heap()
  for (const s of sources) { const i = snap(D, s); dist[i] = 0; h.push(0, i) }
  const nb = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]]
  for (let it = h.pop(); it; it = h.pop()) {
    const [d, i] = it
    if (d > dist[i]) continue
    const r = (i / W.w) | 0, c = i - r * W.w
    for (const [dr, dc, w] of nb) {
      const rr = r + dr, cc = c + dc
      if (rr < 0 || cc < 0 || rr >= W.h || cc >= W.w) continue
      const j = rr * W.w + cc
      if (!D.walk[j]) continue
      const nd = d + w
      if (nd < dist[j]) { dist[j] = nd; h.push(dist[j], j) }
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] *= W.res
  return dist
}
