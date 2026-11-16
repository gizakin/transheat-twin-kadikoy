// Geometric shadow casting drawn straight onto the analysis grid (same method as backend/app/core/shadow.py):
// prisms cast footprint + translate + edge quads; trees are spheres casting ellipses; raised shade
// structures cast their translated canopy. Horizontal ground, opaque crowns, clear sky.
import type { Building, Grid, Poly, Tree, XY } from './data'
import { fillPolys, fillRing, read, surface, type Window } from './raster'
import type { Sun } from './sun'

export function offset(h: number, sun: Sun): XY {
  const el = (Math.max(sun.elevation, 0.5) * Math.PI) / 180
  const L = h / Math.tan(el)
  const az = (sun.azimuth * Math.PI) / 180
  return [-L * Math.sin(az), -L * Math.cos(az)]
}

function drawPrism(c: OffscreenCanvasRenderingContext2D, ps: Poly[], h: number, sun: Sun) {
  const [dx, dy] = offset(h, sun)
  fillPolys(c, ps)
  fillPolys(c, ps.map(p => p.map(r => r.map(([x, y]) => [x + dx, y + dy] as XY))))
  for (const p of ps) {
    const r = p[0]
    for (let i = 1; i < r.length; i++) {
      const [x0, y0] = r[i - 1], [x1, y1] = r[i]
      fillRing(c, [[x0, y0], [x1, y1], [x1 + dx, y1 + dy], [x0 + dx, y0 + dy]])
    }
  }
}

export function ellipse(x: number, y: number, h: number, d: number, sun: Sun, n = 28): XY[] {
  const r = Math.max(d, 0.5) / 2
  const zc = Math.max(h - r, r)
  const [dx, dy] = offset(zc, sun)
  const el = (Math.max(sun.elevation, 0.5) * Math.PI) / 180
  const major = r * Math.min(1 / Math.sin(el), 20)
  const az = (sun.azimuth * Math.PI) / 180
  const u: XY = [-Math.sin(az), -Math.cos(az)]      // along the shadow
  const v: XY = [-u[1], u[0]]                        // across
  const cx = x + dx, cy = y + dy
  const out: XY[] = []
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n
    out.push([cx + u[0] * major * Math.cos(t) + v[0] * r * Math.sin(t), cy + u[1] * major * Math.cos(t) + v[1] * r * Math.sin(t)])
  }
  return out
}

export interface Structure { poly: Poly[]; height: number; opacity: number; kind: string }

/** Opaque shadow mask (buildings + trees + opaque structures) on a window. */
export function shadowMask(G: Grid, win: Window, sun: Sun, buildings: Building[], trees: Tree[], structures: Structure[]) {
  const c = surface(G)
  if (sun.elevation <= 0) return read(c, win)
  const wx0 = G.x0 + win.x * G.res - 300, wx1 = G.x0 + (win.x + win.w) * G.res + 300
  const wy1 = G.ytop - win.y * G.res + 300, wy0 = G.ytop - (win.y + win.h) * G.res - 300
  const near = (x: number, y: number) => x > wx0 && x < wx1 && y > wy0 && y < wy1
  for (const b of buildings) {
    const p0 = b.p[0]?.[0]?.[0]
    if (p0 && near(p0[0], p0[1])) drawPrism(c, b.p, b.h, sun)
  }
  for (const t of trees) if (near(t.x, t.y)) fillRing(c, ellipse(t.x, t.y, t.h, t.d, sun))
  for (const s of structures) if (s.opacity >= 0.999) fillPolys(c, translated(s, sun))
  return read(c, win)
}

export function translated(s: Structure, sun: Sun): Poly[] {
  if (s.height <= 0 || sun.elevation <= 0) return s.poly
  const [dx, dy] = offset(s.height, sun)
  return s.poly.map(p => p.map(r => r.map(([x, y]) => [x + dx, y + dy] as XY)))
}

/** Partial-shade structures: list of (mask, opacity). */
export function partialMasks(G: Grid, win: Window, sun: Sun, structures: Structure[]) {
  if (sun.elevation <= 0) return []
  return structures.filter(s => s.opacity < 0.999).map(s => {
    const c = surface(G)
    fillPolys(c, translated(s, sun))
    return { mask: read(c, win), op: s.opacity }
  })
}

export function crownMask(G: Grid, win: Window, trees: Tree[]) {
  const c = surface(G)
  c.beginPath()
  for (const t of trees) { c.moveTo(t.x + t.d / 2, t.y); c.arc(t.x, t.y, Math.max(t.d, 0.5) / 2, 0, Math.PI * 2) }
  c.fill()
  return read(c, win)
}
