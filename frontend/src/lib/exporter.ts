// High-resolution figure export. The map is re-rendered at the target resolution (MapLibre pixel ratio + container size),
// not upscaled: the WebGL drawing buffer is copied inside a 'render' callback (no preserveDrawingBuffer needed), then the
// figure is composed on a 2D canvas with title, legend, scale bar, north arrow, sources/methods and a description.
// Everything the map draws is same-origin (local ortho/rasters, canvas sources, GeoJSON), so the canvases are never tainted.
import type { Map as MLMap } from 'maplibre-gl'

export type Layout = 'landscape' | 'portrait'
export type Res = '2k' | '4k' | 'max'
export interface LegendItem { color: string; label: string; kind?: 'fill' | 'line' | 'dot' | 'dash' }
export interface LegendGroup { title: string; items?: LegendItem[]; ramp?: { colors: string[]; ticks: string[] } }
export interface Panel { map: MLMap; label: string }
export interface FigureSpec {
  layout: Layout; res: Res; format: 'png' | 'jpeg'
  title: string | null; subtitle: string | null
  legend: LegendGroup[] | null; meta: string[] | null; desc: string[] | null
  scaleNorth: boolean
  footer: string
  side?: boolean   // reserve the info column/block even if a part turns out empty, so map sizes stay as captured
  legendPos?: 'overlay' | 'bottom' | 'side'   // overlay = a box on the map itself; bottom = a band right under the map(s)
}

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'
const C = { bg: '#ffffff', ink: '#14212b', ink2: '#3d4d57', muted: '#66757e', line: '#d5dde1', accent: '#0b6470' }

/** Largest edge the GPU can render into (WebGL MAX_RENDERBUFFER_SIZE / MAX_TEXTURE_SIZE), capped for memory. */
export function maxEdge() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')
    if (!gl) return 4096
    const v = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0])
    ;(gl.getExtension('WEBGL_lose_context') as any)?.loseContext()
    return Math.min(v, 8192)
  } catch { return 4096 }
}

export function outputSize(res: Res, layout: Layout): [number, number] {
  const long = res === '2k' ? 2560 : res === '4k' ? 3840 : Math.max(3840, Math.floor(maxEdge() / 16) * 16)
  const short = Math.round((long * 9) / 16)
  return layout === 'landscape' ? [long, short] : [short, long]
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function idle(m: MLMap, timeout = 20000) {
  return new Promise<void>(resolve => {
    let done = false
    const fin = () => { if (!done) { done = true; resolve() } }
    m.once('idle', fin)
    setTimeout(fin, timeout)
    m.triggerRepaint()
  })
}

/** Metres per CSS pixel at the map centre (horizontal), or null when the view is tilted (no true scale). */
function metresPerCssPx(m: MLMap) {
  if (m.getPitch() > 1) return null
  const c = m.getContainer().getBoundingClientRect()
  const y = c.height / 2, x0 = c.width / 2 - 50, x1 = c.width / 2 + 50
  const a = m.unproject([x0, y]), b = m.unproject([x1, y])
  const R = 6371008.8, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return (2 * R * Math.asin(Math.sqrt(h))) / 100
}

export interface Capture { canvas: HTMLCanvasElement; mPerPx: number | null; bearing: number; pitch: number }

/** Render `m` into a `w`×`h` bitmap at true resolution, keeping its centre, zoom, bearing and pitch. */
export async function captureMap(m: MLMap, w: number, h: number): Promise<Capture> {
  const el = m.getContainer() as HTMLElement
  const rect = el.getBoundingClientRect()
  const cssW = Math.max(200, Math.round(rect.width))
  const ratio = w / cssW
  const cssH = Math.max(150, Math.round(h / ratio))
  const saved = { width: el.style.width, height: el.style.height, flex: el.style.flex, pr: m.getPixelRatio() }
  try {
    el.style.width = `${cssW}px`; el.style.height = `${cssH}px`; el.style.flex = 'none'
    m.resize()
    m.setPixelRatio(ratio)
    await idle(m)
    await sleep(150)
    const mPerCss = metresPerCssPx(m)
    const out = document.createElement('canvas')
    out.width = w; out.height = h
    const ctx = out.getContext('2d')!
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('harita çizimi zaman aşımına uğradı')), 20000)
      m.once('render', () => {
        try { ctx.drawImage(m.getCanvas(), 0, 0, w, h); clearTimeout(t); resolve() } catch (e) { clearTimeout(t); reject(e) }
      })
      m.triggerRepaint()
    })
    return { canvas: out, mPerPx: mPerCss != null ? mPerCss / ratio : null, bearing: m.getBearing(), pitch: m.getPitch() }
  } finally {
    el.style.width = saved.width; el.style.height = saved.height; el.style.flex = saved.flex
    m.setPixelRatio(saved.pr)
    m.resize()
  }
}

// ------------------------------------------------------------------ composition
interface Box { x: number; y: number; w: number; h: number }

const groupHeight = (g: LegendGroup, u: number) => 22 * u + (g.ramp ? 36 * u : 0) + Math.ceil((g.items?.length ?? 0) / 2) * 21 * u + 12 * u

/** Legend groups arranged in columns across `width` (masonry: each group goes to the shortest column). */
function legendBand(groups: LegendGroup[], width: number, u: number) {
  const gap = 28 * u
  const cols = Math.max(1, Math.min(groups.length, Math.floor((width + gap) / (330 * u + gap))))
  const colW = (width - (cols - 1) * gap) / cols
  const hs = new Array(cols).fill(0)
  const pos = groups.map(g => {
    const c = hs.indexOf(Math.min(...hs))
    const p = { g, x: c * (colW + gap), y: hs[c] }
    hs[c] += groupHeight(g, u)
    return p
  })
  return { colW, pos, height: Math.max(0, ...hs) }
}

/** Map area(s) for a figure, so the maps can be rendered at exactly the pixel size they will occupy. */
export function figureLayout(spec: FigureSpec, nPanels: number) {
  const [W, H] = outputSize(spec.res, spec.layout)
  const u = Math.min(W, H) / 1080
  const pad = Math.round(40 * u)
  const head = spec.title || spec.subtitle ? Math.round((spec.subtitle ? 118 : 82) * u) : 0
  const foot = Math.round(34 * u)
  const bottom = spec.legendPos === 'bottom' && !!spec.legend?.length
  const overlay = spec.legendPos === 'overlay' && !!spec.legend?.length
  const hasSide = spec.side ?? !!((!bottom && !overlay && spec.legend?.length) || spec.meta?.length || spec.desc?.length)
  let mapBox: Box, side: Box | null = null
  if (spec.layout === 'landscape') {
    const sideW = hasSide ? Math.round(W * 0.24) : 0
    mapBox = { x: pad, y: pad + head, w: W - 2 * pad - (hasSide ? sideW + pad : 0), h: H - 2 * pad - head - foot }
    if (hasSide) side = { x: W - pad - sideW, y: pad + head, w: sideW, h: mapBox.h }
  } else {
    const sideH = hasSide ? Math.round(H * 0.3) : 0
    mapBox = { x: pad, y: pad + head, w: W - 2 * pad, h: H - 2 * pad - head - foot - (hasSide ? sideH + pad : 0) }
    if (hasSide) side = { x: pad, y: mapBox.y + mapBox.h + pad, w: W - 2 * pad, h: sideH }
  }
  const gap = Math.round(16 * u)
  let legendBox: Box | null = null
  if (bottom) {   // legend band inside the figure, under the map(s), as wide as the map area
    const band = legendBand(spec.legend!, mapBox.w - 2 * gap, u)
    const bh = Math.min(Math.round(band.height + 2 * gap), Math.round(mapBox.h * 0.42))
    mapBox = { ...mapBox, h: mapBox.h - bh - gap }
    legendBox = { x: mapBox.x, y: mapBox.y + mapBox.h + gap, w: mapBox.w, h: bh }
  }
  const panels: Box[] = []
  if (nPanels === 1) panels.push(mapBox)
  else if (spec.layout === 'landscape' || mapBox.w >= mapBox.h) {
    const pw = Math.floor((mapBox.w - gap) / 2)
    panels.push({ ...mapBox, w: pw }, { ...mapBox, x: mapBox.x + pw + gap, w: pw })
  } else {
    const ph = Math.floor((mapBox.h - gap) / 2)
    panels.push({ ...mapBox, h: ph }, { ...mapBox, y: mapBox.y + ph + gap, h: ph })
  }
  if (overlay) {   // a box on one map panel (left one side by side, lower one when stacked), bottom-left, sized to its content
    const t = panels.length > 1 && panels[1].y > panels[0].y ? panels[1] : panels[0]
    const m = Math.round(18 * u), g = Math.round(16 * u), n = spec.legend!.length
    const w = Math.min(t.w - 2 * m, n * 330 * u + (n - 1) * 28 * u + 2 * g)
    const band = legendBand(spec.legend!, w - 2 * g, u)
    const h = Math.min(Math.round(band.height + 2 * g), Math.round(t.h * 0.55))
    legendBox = { x: t.x + m, y: t.y + t.h - m - h, w: Math.round(w), h }
  }
  return { W, H, u, pad, head, foot, mapBox, side, panels, legendBox, legendOverlay: overlay }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/), lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}

function niceScale(mPerPx: number, maxPx: number) {
  const maxM = mPerPx * maxPx
  const steps = [1, 2, 5]
  let best = 1
  for (let e = 0; e < 7; e++) for (const s of steps) { const v = s * 10 ** e; if (v <= maxM) best = v }
  return { m: best, px: best / mPerPx }
}

function drawScaleNorth(ctx: CanvasRenderingContext2D, b: Box, cap: Capture, u: number, lift = 0) {
  const pad = 18 * u
  // north arrow (top-right), rotated by the map bearing
  const cx = b.x + b.w - pad - 22 * u, cy = b.y + pad + 30 * u
  ctx.save()
  ctx.translate(cx, cy); ctx.rotate((-cap.bearing * Math.PI) / 180)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.beginPath(); ctx.arc(0, 0, 26 * u, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(0, -20 * u); ctx.lineTo(9 * u, 10 * u); ctx.lineTo(0, 4 * u); ctx.lineTo(-9 * u, 10 * u); ctx.closePath(); ctx.fill()
  ctx.font = `700 ${13 * u}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('K', 0, 18 * u)
  ctx.restore()
  // scale bar (bottom-left) — only for a vertical (untilted) view
  if (cap.mPerPx == null) return
  const s = niceScale(cap.mPerPx, b.w * 0.22)
  const x = b.x + pad, y = b.y + b.h - pad - 10 * u - lift
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.fillRect(x - 10 * u, y - 30 * u, s.px + 20 * u + 70 * u, 46 * u)
  ctx.fillStyle = C.ink
  const segs = 4
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : C.ink
    ctx.fillRect(x + (s.px / segs) * i, y - 6 * u, s.px / segs, 8 * u)
  }
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5 * u; ctx.strokeRect(x, y - 6 * u, s.px, 8 * u)
  ctx.fillStyle = C.ink; ctx.font = `600 ${14 * u}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('0', x - 3 * u, y - 12 * u)
  ctx.fillText(s.m >= 1000 ? `${s.m / 1000} km` : `${s.m} m`, x + s.px + 8 * u, y + 2 * u)
}

function drawLegendGroup(ctx: CanvasRenderingContext2D, g: LegendGroup, x: number, y: number, w: number, u: number) {
  ctx.fillStyle = C.ink; ctx.font = `700 ${15 * u}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(g.title, x, y); y += 22 * u
  if (g.ramp) {
    const grd = ctx.createLinearGradient(x, 0, x + w, 0)
    g.ramp.colors.forEach((c, i) => grd.addColorStop(i / (g.ramp!.colors.length - 1), c))
    ctx.fillStyle = grd; ctx.fillRect(x, y, w, 12 * u); ctx.strokeStyle = C.line; ctx.lineWidth = u; ctx.strokeRect(x, y, w, 12 * u)
    y += 16 * u
    ctx.fillStyle = C.ink2; ctx.font = `${12.5 * u}px ${FONT}`
    g.ramp.ticks.forEach((t, i) => {
      ctx.textAlign = i === 0 ? 'left' : i === g.ramp!.ticks.length - 1 ? 'right' : 'center'
      ctx.fillText(t, x + (w * i) / Math.max(1, g.ramp!.ticks.length - 1), y)
    })
    ctx.textAlign = 'left'
    y += 20 * u
  }
  const colW = w / 2
  ;(g.items ?? []).forEach((it, i) => {
    const cx = x + (i % 2) * colW, cy = y + Math.floor(i / 2) * 21 * u
    ctx.fillStyle = it.color; ctx.strokeStyle = it.color
    if (it.kind === 'line' || it.kind === 'dash') {
      ctx.lineWidth = 4 * u; ctx.setLineDash(it.kind === 'dash' ? [6 * u, 4 * u] : [])
      ctx.beginPath(); ctx.moveTo(cx, cy + 8 * u); ctx.lineTo(cx + 20 * u, cy + 8 * u); ctx.stroke(); ctx.setLineDash([])
    } else if (it.kind === 'dot') { ctx.beginPath(); ctx.arc(cx + 8 * u, cy + 8 * u, 6 * u, 0, Math.PI * 2); ctx.fill() }
    else { ctx.fillRect(cx, cy + 1 * u, 18 * u, 14 * u); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = u; ctx.strokeRect(cx, cy + 1 * u, 18 * u, 14 * u) }
    ctx.fillStyle = C.ink2; ctx.font = `${12.5 * u}px ${FONT}`
    const lbl = wrap(ctx, it.label, colW - 30 * u)[0] ?? ''
    ctx.fillText(lbl, cx + 26 * u, cy + 1 * u)
  })
  y += Math.ceil((g.items?.length ?? 0) / 2) * 21 * u
  return y + 12 * u
}

/** Compose the figure and return it as a Blob. */
export async function composeFigure(spec: FigureSpec, caps: { cap: Capture; label: string }[], layout?: ReturnType<typeof figureLayout>): Promise<{ blob: Blob; W: number; H: number }> {
  const L = layout ?? figureLayout(spec, caps.length)   // pass the layout the maps were captured with, so nothing is rescaled
  const { W, H, u, pad } = L
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)
  // header
  let titleBottom = pad
  if (spec.title) {   // shrink to fit the width (down to 70 %), then wrap onto a second line
    ctx.fillStyle = C.ink; ctx.textBaseline = 'top'
    let fs = 40 * u
    ctx.font = `700 ${fs}px ${FONT}`
    while (ctx.measureText(spec.title).width > W - 2 * pad && fs > 28 * u) { fs -= u; ctx.font = `700 ${fs}px ${FONT}` }
    const lines = wrap(ctx, spec.title, W - 2 * pad).slice(0, 2)
    if (lines.length > 1) { fs = Math.min(fs, 26 * u); ctx.font = `700 ${fs}px ${FONT}` }
    const tl = wrap(ctx, spec.title, W - 2 * pad).slice(0, 2)
    tl.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * fs * 1.12))
    titleBottom = pad + tl.length * fs * 1.12 + 6 * u
  }
  if (spec.subtitle) { ctx.fillStyle = C.ink2; ctx.font = `${22 * u}px ${FONT}`; ctx.textBaseline = 'top'; ctx.fillText(spec.subtitle, pad, titleBottom) }
  if (spec.title || spec.subtitle) { ctx.fillStyle = C.accent; ctx.fillRect(pad, pad + L.head - 14 * u, 90 * u, 5 * u) }
  // maps
  caps.forEach(({ cap, label }, i) => {
    const b = L.panels[i]
    ctx.drawImage(cap.canvas, b.x, b.y, b.w, b.h)
    ctx.strokeStyle = C.line; ctx.lineWidth = 2 * u; ctx.strokeRect(b.x, b.y, b.w, b.h)
    if (label) {
      ctx.font = `700 ${18 * u}px ${FONT}`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(b.x + 14 * u, b.y + 14 * u, tw + 24 * u, 34 * u)
      ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(label, b.x + 26 * u, b.y + 31 * u)
    }
    // an on-map legend covers the bottom-left corner: lift the scale bar above it where they overlap
    const lb = L.legendOverlay ? L.legendBox : null
    const lift = lb && lb.y < b.y + b.h && lb.y + lb.h > b.y && lb.x < b.x + b.w * 0.4 && lb.x + lb.w > b.x ? b.y + b.h - lb.y + 4 * u : 0
    if (spec.scaleNorth) drawScaleNorth(ctx, b, cap, u, lift)
  })
  // legend band under the map(s)
  if (L.legendBox && spec.legend?.length) {
    const b = L.legendBox, g = Math.round(16 * u)
    if (L.legendOverlay) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 3 * u
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.restore()
    } else { ctx.fillStyle = '#f7f9f9'; ctx.fillRect(b.x, b.y, b.w, b.h) }
    ctx.strokeStyle = C.line; ctx.lineWidth = 2 * u; ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip()
    const band = legendBand(spec.legend, b.w - 2 * g, u)
    for (const p of band.pos) drawLegendGroup(ctx, p.g, b.x + g + p.x, b.y + g + p.y, band.colW, u)
    ctx.restore()
  }
  // side / bottom block: legend (when not in the band), sources & method, description
  if (L.side) {
    const s = L.side
    ctx.save(); ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip()
    const cols = spec.layout === 'portrait' ? 2 : 1
    const colW = (s.w - (cols - 1) * pad) / cols
    let col = 0, y = s.y
    const nextCol = () => { if (col < cols - 1) { col++; y = s.y } }
    const x = () => s.x + col * (colW + pad)
    for (const g of L.legendBox ? [] : spec.legend ?? []) {
      const need = 22 * u + (g.ramp ? 36 * u : 0) + Math.ceil((g.items?.length ?? 0) / 2) * 21 * u + 12 * u
      if (y + need > s.y + s.h) nextCol()
      y = drawLegendGroup(ctx, g, x(), y, colW, u)
    }
    const para = (title: string, lines: string[]) => {
      ctx.fillStyle = C.ink; ctx.font = `700 ${15 * u}px ${FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left'
      if (y + 40 * u > s.y + s.h) nextCol()
      ctx.fillText(title, x(), y); y += 22 * u
      ctx.font = `${12.5 * u}px ${FONT}`; ctx.fillStyle = C.ink2
      for (const ln of lines) for (const wl of wrap(ctx, ln, colW)) {
        if (y + 18 * u > s.y + s.h) { nextCol(); if (y + 18 * u > s.y + s.h) break }
        ctx.fillText(wl, x(), y); y += 17.5 * u
      }
      y += 10 * u
    }
    if (spec.desc?.length) para('Açıklama', spec.desc)
    if (spec.meta?.length) para('Kaynak, yöntem ve çıktı bilgisi', spec.meta)
    ctx.restore()
  }
  // footer
  ctx.fillStyle = C.muted; ctx.font = `${13 * u}px ${FONT}`; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'
  ctx.fillText(spec.footer, pad, H - pad / 2)
  ctx.textAlign = 'right'; ctx.fillText(`${W}×${H} px`, W - pad, H - pad / 2)
  const blob = await new Promise<Blob | null>(r => cv.toBlob(r, spec.format === 'png' ? 'image/png' : 'image/jpeg', 0.93))
  cv.width = cv.height = 0
  if (!blob) throw new Error('görsel dosyası oluşturulamadı (tarayıcı bellek sınırı olabilir; daha düşük çözünürlük deneyin)')
  return { blob, W, H }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

const slug = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
export function fileName(kind: string, state: string, time: string, W: number, H: number, fmt: 'png' | 'jpeg') {
  const t = time.replace(/[-:]/g, '').replace('T', '-')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)
  return `transheat-kadikoy_${slug(kind)}_${slug(state)}_${t}_${W}x${H}_${stamp}.${fmt === 'png' ? 'png' : 'jpg'}`
}
