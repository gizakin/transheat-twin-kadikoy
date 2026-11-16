// Canvas-backed rasterisation on the analysis grid. The canvas transform maps TM30 metres straight to
// grid pixels, so shapes are drawn in map units and every area is a cell count × res².
import type { Grid, Poly, XY } from './data'

export interface Window { x: number; y: number; w: number; h: number }

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null

export function surface(G: Grid) {
  if (!canvas || canvas.width !== G.w || canvas.height !== G.h) {
    canvas = new OffscreenCanvas(G.w, G.h)
    ctx = canvas.getContext('2d', { willReadFrequently: true })!
  }
  const c = ctx!
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, G.w, G.h)
  c.setTransform(1 / G.res, 0, 0, -1 / G.res, -G.x0 / G.res, G.ytop / G.res)
  c.fillStyle = '#000'
  return c
}

export function pathPoly(c: OffscreenCanvasRenderingContext2D, p: Poly) {
  for (const r of p) {
    if (r.length < 3) continue
    c.moveTo(r[0][0], r[0][1])
    for (let i = 1; i < r.length; i++) c.lineTo(r[i][0], r[i][1])
    c.closePath()
  }
}

/** Union of polygons: each polygon is filled on its own (holes via even-odd inside it), so overlaps add up. */
export function fillPolys(c: OffscreenCanvasRenderingContext2D, ps: Poly[]) {
  for (const p of ps) {
    c.beginPath()
    pathPoly(c, p)
    c.fill('evenodd')
  }
}

export function fillRing(c: OffscreenCanvasRenderingContext2D, r: XY[]) {
  if (r.length < 3) return
  c.beginPath()
  c.moveTo(r[0][0], r[0][1])
  for (let i = 1; i < r.length; i++) c.lineTo(r[i][0], r[i][1])
  c.closePath()
  c.fill()
}

/** Read the alpha channel of a window as a 0/1 mask. */
export function read(c: OffscreenCanvasRenderingContext2D, win: Window): Uint8Array {
  const d = c.getImageData(win.x, win.y, win.w, win.h).data
  const m = new Uint8Array(win.w * win.h)
  for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j] > 127 ? 1 : 0
  return m
}

export function windowOf(G: Grid, b: [number, number, number, number], pad = 0): Window {
  const x = Math.max(0, Math.floor((b[0] - pad - G.x0) / G.res))
  const y = Math.max(0, Math.floor((G.ytop - (b[3] + pad)) / G.res))
  const x1 = Math.min(G.w, Math.ceil((b[2] + pad - G.x0) / G.res))
  const y1 = Math.min(G.h, Math.ceil((G.ytop - (b[1] - pad)) / G.res))
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) }
}

export const fullWindow = (G: Grid): Window => ({ x: 0, y: 0, w: G.w, h: G.h })

/** Mask of polygons on a window. */
export function polyMask(G: Grid, ps: Poly[], win: Window) {
  const c = surface(G)
  fillPolys(c, ps)
  return read(c, win)
}

/** Grid cell index of a TM30 point, or -1 outside. */
export function cellOf(G: Grid, [x, y]: XY) {
  const col = Math.floor((x - G.x0) / G.res), row = Math.floor((G.ytop - y) / G.res)
  return col < 0 || row < 0 || col >= G.w || row >= G.h ? -1 : row * G.w + col
}

/** RGBA overlay image of a window mask (for display as a MapLibre image source). */
export function maskImage(G: Grid, mask: Uint8Array, win: Window, rgba: [number, number, number, number], scale = 0.5) {
  const W = Math.max(1, Math.round(win.w * scale)), H = Math.max(1, Math.round(win.h * scale))
  const img = new ImageData(W, H)
  for (let r = 0; r < H; r++) {
    const sr = Math.min(win.h - 1, Math.floor(r / scale))
    for (let col = 0; col < W; col++) {
      const sc = Math.min(win.w - 1, Math.floor(col / scale))
      if (mask[sr * win.w + sc]) {
        const k = (r * W + col) * 4
        img.data[k] = rgba[0]; img.data[k + 1] = rgba[1]; img.data[k + 2] = rgba[2]; img.data[k + 3] = rgba[3]
      }
    }
  }
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  cv.getContext('2d')!.putImageData(img, 0, 0)
  const x0 = G.x0 + win.x * G.res, x1 = G.x0 + (win.x + win.w) * G.res
  const y0 = G.ytop - win.y * G.res, y1 = G.ytop - (win.y + win.h) * G.res
  // canvas for the map (no fetch needed, works under a strict CSP); data URL lazily for <img> in reports
  return { canvas: cv, get url() { return cv.toDataURL('image/png') }, tm: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as XY[] }
}
