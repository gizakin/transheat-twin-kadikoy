import { useEffect, useRef, useState } from 'react'
import { AttributionControl, Map as MLMap, NavigationControl, Popup, ScaleControl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { DATA_URL, loadData, polysToGeom, toLL, type XY } from '../engine/data'
import type { LayerMeta, LLImg, OverlayImg, ScenarioResult } from '../types'
import { INFRA_COLORS, SURFACE_COLORS, SURFACE_LABELS, TRANSFER_COLORS } from './layers'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const CENTER: [number, number] = [29.0215, 40.9915]
type Corners = [[number, number], [number, number], [number, number], [number, number]]
const NOWHERE: Corners = [[29.0, 41.0], [29.0001, 41.0], [29.0001, 40.9999], [29.0, 40.9999]]

export type DrawMode = 'polygon' | 'linestring' | 'point' | null

export interface MapViewProps {
  stateKey: 'mevcut' | 'proje'
  label: string
  visible: Record<string, boolean>
  shadow: OverlayImg | null
  transferPaths: GeoJSON.FeatureCollection | null
  scenario: ScenarioResult | null
  heatImage: LLImg | null
  uploads: LayerMeta[]
  threeD: boolean
  drawMode?: DrawMode
  onDrawn?: (g: GeoJSON.Geometry) => void
  onIntervene?: (type: string, geometry: GeoJSON.Geometry, label: string) => void
  onReady?: (m: MLMap) => void
  focus?: GeoJSON.Geometry | null
  interactive?: boolean
  busLine?: string | null
  accessImage?: LLImg | null
  traffic?: GeoJSON.FeatureCollection | null
  walk?: boolean
  comfort?: GeoJSON.FeatureCollection | null
}

const ACTIONS: Record<string, [string, string][]> = {
  sert: [['tree_planting', 'Ağaç ekle'], ['green_conversion', 'Yeşil alana dönüştür'], ['shade_structure', 'Gölgeleme elemanı ekle'],
    ['pv_shading', 'Fotovoltaik gölgeleme ekle'], ['surface_change', 'Zemin malzemesini değiştir'], ['permeable_surface', 'Geçirgen yüzey yap'],
    ['cool_pavement', 'Açık renk / cool pavement uygula'], ['hard_reduction', 'Sert zemini azalt']],
  asfalt: [['tree_planting', 'Ağaç ekle'], ['green_conversion', 'Yeşil alana dönüştür'], ['surface_change', 'Zemin malzemesini değiştir'],
    ['cool_pavement', 'Açık renk / cool pavement uygula'], ['permeable_surface', 'Geçirgen yüzey yap']],
  yesil: [['tree_planting', 'Ağaç ekle'], ['shade_structure', 'Gölgeleme elemanı ekle']],
  gecirgen: [['tree_planting', 'Ağaç ekle'], ['green_conversion', 'Yeşil alana dönüştür'], ['shade_structure', 'Gölgeleme elemanı ekle']],
}

function bbox(g: GeoJSON.Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90]
  const walk = (c: any) => {
    if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]) }
    else c.forEach(walk)
  }
  if (g.type === 'GeometryCollection') g.geometries.forEach(x => walk((x as any).coordinates))
  else walk((g as any).coordinates)
  return b
}

async function fetchJSON(url: string) { const r = await fetch(url); return r.ok ? r.json() : EMPTY }

function asFC(x: GeoJSON.FeatureCollection | GeoJSON.Feature | null | undefined): GeoJSON.FeatureCollection {
  if (!x) return EMPTY
  if (x.type === 'FeatureCollection') return x
  return x.geometry ? { type: 'FeatureCollection', features: [x] } : EMPTY
}

function setVis(m: MLMap, ids: string[], on: boolean) {
  ids.forEach(id => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'))
}

const llCorners = (img: OverlayImg): Corners => img.tm.map(([x, y]) => toLL(x, y)) as Corners

const blankCanvas = () => { const c = document.createElement('canvas'); c.width = 1; c.height = 1; return c }

/** Raster overlays use canvas sources: no fetch of data:/blob: URLs, so they also work under a strict page CSP.
 *  A canvas source is replaced (not updated) because MapLibre reads a non-animated canvas only once. */
function setCanvas(m: MLMap, srcId: string, layerId: string, canvas: HTMLCanvasElement | null, corners: Corners | null,
  paint: Record<string, unknown>, visible: boolean) {
  const before = (() => { const ls = m.getStyle().layers; const i = ls.findIndex(l => l.id === layerId); return i >= 0 && i + 1 < ls.length ? ls[i + 1].id : undefined })()
  if (m.getLayer(layerId)) m.removeLayer(layerId)
  if (m.getSource(srcId)) m.removeSource(srcId)
  m.addSource(srcId, { type: 'canvas', canvas: canvas ?? blankCanvas(), coordinates: corners ?? NOWHERE, animate: false } as any)
  m.addLayer({ id: layerId, type: 'raster', source: srcId, paint: paint as any, layout: { visibility: visible && canvas ? 'visible' : 'none' } }, before)
}

const GROUPS: Record<string, string[]> = {
  boundary: ['boundary-line'], surfaces: ['surfaces-fill', 'surfaces-line'], buildings: ['buildings-fill', 'buildings-3d'],
  trees: ['trees-fill', 'trees-3d', 'trunks-3d'], project_extent: ['extent-line'], shadow: ['shadow-img'], heat: ['heat-img'],
  transfer_points: ['transfer-circle'], transfer_paths: ['tpaths-line'], minibus_lines: ['minibus-line'], ferry_lines: ['ferry-line'],
  iett_stops: ['iettstop-circle'], traffic: ['traffic-line'], comfort: ['comfort-line', 'comfort-sun'], peds: ['peds-circle'], bus_corridors: ['corridor-line'], stop_access: ['access-img'], heritage: ['heritage-fill', 'heritage-line'], sit: ['sit-line'], ownership: ['ownership-line'],
  infrastructure: ['infra-line'], insitu: ['insitu-img'],
  scenario: ['sc-area-fill', 'sc-area-line', 'sc-newshade', 'sc-crowns', 'sc-crowns-3d', 'sc-trunks-3d', 'sc-struct', 'sc-struct-3d', 'sc-paths', 'sc-routes', 'sc-changed'],
}

// ------------------------------------------------------------------ pedestrian (eye-level) view helpers
const EYE_M = 1.7      // eye height above ground
const LOOK_M = 18      // the camera looks at the ground this far ahead (pitch ≈ 84.6°)
const STEP_M = 2
const MAX_HOP_M = 120  // a click further away than this moves only this far towards it
const WALK_START: { ll: [number, number]; bearing: number } = { ll: [29.02172, 40.98994], bearing: -10 }  // meydan, near the M4 entrances, facing the piers
let lastEye: { ll: [number, number]; bearing: number } | null = null

function offsetLL([lng, lat]: [number, number], dist: number, bearingDeg: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180
  return [lng + (dist * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (dist * Math.cos(b)) / 110540]
}

function distBearing(a: [number, number], b: [number, number]) {
  const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), dy = (b[1] - a[1]) * 110540
  return { d: Math.hypot(dx, dy), bearing: (Math.atan2(dx, dy) * 180) / Math.PI }
}

/** Trunks for crown polygons (lon/lat): a thin cylinder from the ground to the crown base, radius scaled to the crown. */
function trunkFC(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: fc.features.flatMap(f => {
    const ring = (f.geometry as GeoJSON.Polygon)?.coordinates?.[0]
    if (!ring?.length) return []
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length, cy = ring.reduce((s, c) => s + c[1], 0) / ring.length
    const pr = f.properties ?? {}
    const r = Math.max(0.12, Math.min(0.4, Number(pr.tac_cap_m) * 0.05))
    const ky = 110540, kx = 111320 * Math.cos((cy * Math.PI) / 180)
    const pts = Array.from({ length: 9 }, (_, k) => [cx + (r * Math.cos((k / 8) * 2 * Math.PI)) / kx, cy + (r * Math.sin((k / 8) * 2 * Math.PI)) / ky])
    return [{ type: 'Feature' as const, properties: { h: Math.max(0.6, Number(pr.boy_m) - Number(pr.tac_cap_m)) }, geometry: { type: 'Polygon' as const, coordinates: [pts] } }]
  }) }
}

function circle(x: number, y: number, r: number): XY[] {
  return Array.from({ length: 21 }, (_, k) => [x + r * Math.cos((k / 20) * 2 * Math.PI), y + r * Math.sin((k / 20) * 2 * Math.PI)] as XY)
}

export default function MapView(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const surfRef = useRef<GeoJSON.FeatureCollection>(EMPTY)
  const lastDrawEnd = useRef(0)
  const cb = useRef(p)
  cb.current = p
  const [ready, setReady] = useState(false)
  const eye = useRef<{ ll: [number, number]; bearing: number } | null>(null)
  const walkDragged = useRef(false)
  const applyEye = () => {
    const m = mapRef.current, e = eye.current
    if (!m || !e) return
    m.jumpTo(m.calculateCameraOptionsFromTo(e.ll, EYE_M, offsetLL(e.ll, LOOK_M, e.bearing), 0))
  }
  const walkStep = (d: number) => { if (eye.current) { eye.current.ll = offsetLL(eye.current.ll, d, eye.current.bearing); applyEye() } }
  const walkTurn = (deg: number) => { if (eye.current) { eye.current.bearing = (eye.current.bearing + deg + 360) % 360; applyEye() } }
  const walkTo = (ll: [number, number]) => {
    if (!eye.current) return
    const { d, bearing } = distBearing(eye.current.ll, ll)
    eye.current.ll = d > MAX_HOP_M ? offsetLL(eye.current.ll, MAX_HOP_M, bearing) : ll
    applyEye()
  }
  const [busy, setBusy] = useState('')

  // ------------------------------------------------------------------ create map once
  useEffect(() => {
    let disposed = false
    const m = new MLMap({
      container: el.current!, center: CENTER, zoom: 16.2, maxZoom: 20.5, minZoom: 13.5, attributionControl: false,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#c9d3d8' } }] },
    })
    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.addControl(new AttributionControl({ compact: true, customAttribution: 'Ortofoto ve altlıklar: yarışma veri seti (İBB)' }), 'bottom-right')
    mapRef.current = m
    // automation hook for the film/E2E scripts (only with ?e2e in the address)
    if (new URLSearchParams(window.location.search).has('e2e')) ((window as any).__maps ??= []).push(m)
    m.on('load', async () => {
      setBusy('Katmanlar yükleniyor…')
      const D = await loadData()
      if (disposed) return
      const o = D.meta.ortho, ins = D.meta.insitu
      m.addSource('ortho', { type: 'image', url: DATA_URL + o.file, coordinates: o.corners as Corners })
      m.addLayer({ id: 'ortho', type: 'raster', source: 'ortho', paint: { 'raster-fade-duration': 0 } })
      m.addSource('insitu', { type: 'image', url: DATA_URL + ins.file, coordinates: ins.corners as Corners })
      m.addLayer({ id: 'insitu-img', type: 'raster', source: 'insitu', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.92 } })
      for (const id of ['heat', 'shadow', 'sc-newshade-src', 'access']) m.addSource(id, { type: 'canvas', canvas: blankCanvas(), coordinates: NOWHERE, animate: false } as any)

      const src = (id: string, data: any = EMPTY) => m.addSource(id, { type: 'geojson', data })
      ;['surfaces', 'buildings', 'trees', 'boundary', 'extent', 'transfer', 'tpaths', 'minibus', 'ferry', 'heritage', 'sit',
        'ownership', 'infra', 'traffic', 'corridors', 'iettroutes', 'iettstops', 'sc-area', 'sc-crowns', 'sc-struct', 'sc-paths', 'sc-routes', 'sc-changed', 'trunks', 'sc-trunks', 'comfort', 'peds'].forEach(id => src(id))
      m.setSky({ 'sky-color': '#9fc8e8', 'horizon-color': '#e4ecf1', 'fog-color': '#e4ecf1', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.95 } as any)
      const colorBy = (prop: string, map: Record<string, string>, fallback: string) => ['match', ['get', prop], ...Object.entries(map).flat(), fallback] as any

      m.addLayer({ id: 'surfaces-fill', type: 'fill', source: 'surfaces', paint: { 'fill-color': colorBy('sinif', SURFACE_COLORS, '#ccc'),
        'fill-opacity': ['match', ['get', 'sinif'], 'yesil', 0.5, 'gecirgen', 0.55, 'asfalt', 0.45, 'su', 0.35, 'bina', 0, 0.22] } })
      m.addLayer({ id: 'surfaces-line', type: 'line', source: 'surfaces', paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': 0.5 } })
      m.addLayer({ id: 'access-img', type: 'raster', source: 'access', layout: { visibility: 'none' }, paint: { 'raster-resampling': 'nearest' } })
      m.addLayer({ id: 'heat-img', type: 'raster', source: 'heat', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75, 'raster-resampling': 'nearest' } })
      m.addLayer({ id: 'shadow-img', type: 'raster', source: 'shadow', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } })
      m.addLayer({ id: 'buildings-fill', type: 'fill', source: 'buildings', paint: { 'fill-color': '#e2d9c8', 'fill-opacity': 0.75, 'fill-outline-color': '#8a7f6a' } })
      m.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#e6dfd0', 'fill-extrusion-height': ['get', 'yukseklik_m'], 'fill-extrusion-opacity': 0.92 } })
      m.addLayer({ id: 'trees-fill', type: 'fill', source: 'trees', paint: { 'fill-color': '#2e8b57', 'fill-opacity': 0.55, 'fill-outline-color': '#1d5c39' } })
      m.addLayer({ id: 'trees-3d', type: 'fill-extrusion', source: 'trees', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#2e8b57', 'fill-extrusion-base': ['max', 0, ['-', ['get', 'boy_m'], ['get', 'tac_cap_m']]],
          'fill-extrusion-height': ['get', 'boy_m'], 'fill-extrusion-opacity': 0.85 } })
      m.addLayer({ id: 'trunks-3d', type: 'fill-extrusion', source: 'trunks', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#6b4f3a', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } })
      m.addLayer({ id: 'extent-line', type: 'line', source: 'extent', paint: { 'line-color': '#e8a33d', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      m.addLayer({ id: 'ownership-line', type: 'line', source: 'ownership', paint: { 'line-color': '#9aa5b1', 'line-width': 0.8 } })
      m.addLayer({ id: 'sit-line', type: 'line', source: 'sit', paint: { 'line-color': '#b42318', 'line-width': 1.5, 'line-dasharray': [4, 2] } })
      m.addLayer({ id: 'heritage-fill', type: 'fill', source: 'heritage', paint: { 'fill-color': '#b42318', 'fill-opacity': 0.25 } })
      m.addLayer({ id: 'heritage-line', type: 'line', source: 'heritage', paint: { 'line-color': '#b42318', 'line-width': 1.2 } })
      m.addLayer({ id: 'infra-line', type: 'line', source: 'infra', paint: { 'line-color': colorBy('kurum', INFRA_COLORS, '#999'), 'line-width': 1.2 } })
      // İBB live traffic: class colours as on the İBB map; offset keeps the two directions of a road apart
      m.addLayer({ id: 'traffic-line', type: 'line', source: 'traffic', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['match', ['get', 'C'], 1, '#77b791', 2, '#4d8463', 3, '#f9a346', 4, '#d85050', 5, '#842320', '#a8a8a8'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 16, 4.5, 18, 7], 'line-offset': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 2.5, 18, 4] } })
      // bus corridors: width and a single-hue ramp both encode the number of lines on the street
      m.addLayer({ id: 'corridor-line', type: 'line', source: 'corridors', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': ['interpolate', ['linear'], ['get', 'hat_sayisi'], 1, 1.5, 10, 4, 25, 7, 41, 10],
          'line-color': ['interpolate', ['linear'], ['get', 'hat_sayisi'], 1, '#f6c48a', 10, '#eb8a2f', 25, '#c2560f', 41, '#7a2e05'], 'line-opacity': 0.9 } })
      m.addLayer({ id: 'iettroute-line', type: 'line', source: 'iettroutes', filter: ['==', ['get', 'HAT_KODU'], '__none__'],
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': 4, 'line-color': ['match', ['get', 'YON'], 'GİDİŞ', '#2a78d6', '#d55181'], 'line-offset': ['match', ['get', 'YON'], 'GİDİŞ', 3, -3] } })
      m.addLayer({ id: 'minibus-line', type: 'line', source: 'minibus', paint: { 'line-color': '#7b3fb6', 'line-width': 1.5, 'line-opacity': 0.7 } })
      m.addLayer({ id: 'ferry-line', type: 'line', source: 'ferry', paint: { 'line-color': '#1f5fa8', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'tpaths-line', type: 'line', source: 'tpaths', paint: { 'line-color': '#7b3fb6', 'line-width': 2, 'line-opacity': 0.8 } })
      m.addLayer({ id: 'sc-changed', type: 'fill', source: 'sc-changed', paint: { 'fill-color': colorBy('sinif', SURFACE_COLORS, '#ccc'), 'fill-opacity': 0.85 } })
      m.addLayer({ id: 'sc-newshade', type: 'raster', source: 'sc-newshade-src', paint: { 'raster-fade-duration': 0 } })
      m.addLayer({ id: 'sc-area-fill', type: 'fill', source: 'sc-area', paint: { 'fill-color': '#e8a33d', 'fill-opacity': 0.08 } })
      m.addLayer({ id: 'sc-area-line', type: 'line', source: 'sc-area', paint: { 'line-color': '#e8a33d', 'line-width': 2.5 } })
      m.addLayer({ id: 'sc-crowns', type: 'fill', source: 'sc-crowns', paint: { 'fill-color': '#15a34a', 'fill-opacity': 0.8, 'fill-outline-color': '#0b5d2a' } })
      m.addLayer({ id: 'sc-crowns-3d', type: 'fill-extrusion', source: 'sc-crowns', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#15a34a', 'fill-extrusion-base': ['max', 0, ['-', ['get', 'boy_m'], ['get', 'tac_cap_m']]], 'fill-extrusion-height': ['get', 'boy_m'] } })
      m.addLayer({ id: 'sc-trunks-3d', type: 'fill-extrusion', source: 'sc-trunks', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#6b4f3a', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } })
      m.addLayer({ id: 'sc-struct', type: 'fill', source: 'sc-struct', paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6, 'fill-outline-color': '#374151' } })
      m.addLayer({ id: 'sc-struct-3d', type: 'fill-extrusion', source: 'sc-struct', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#9ca3af', 'fill-extrusion-base': ['-', ['get', 'height'], 0.3], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.8 } })
      m.addLayer({ id: 'sc-paths', type: 'line', source: 'sc-paths', paint: { 'line-color': '#d64545', 'line-width': 3 } })
      m.addLayer({ id: 'sc-routes', type: 'line', source: 'sc-routes', paint: { 'line-color': '#7b3fb6', 'line-width': 3.5 } })
      // pedestrian comfort: transfer paths coloured by shaded share at the selected hour (light = sun, dark = shade)
      m.addLayer({ id: 'comfort-line', type: 'line', source: 'comfort', filter: ['==', ['get', 'kind'], 'path'], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['case', ['<', ['get', 'shade'], 0], '#a8a8a8', ['interpolate', ['linear'], ['get', 'shade'], 0, '#e9c46a', 0.25, '#cfe3dc', 0.5, '#8cc2b7', 0.75, '#3f948a', 1, '#0b5f66']],
          'line-width': ['case', ['get', 'sel'], 7, 4], 'line-opacity': 0.95 } })
      m.addLayer({ id: 'comfort-sun', type: 'line', source: 'comfort', filter: ['in', ['get', 'kind'], ['literal', ['sun', 'focus', 'traffic']]], layout: { 'line-cap': 'round', visibility: 'none' },
        paint: { 'line-color': ['match', ['get', 'kind'], 'focus', '#b42318', 'traffic', '#842320', '#e76f1f'], 'line-width': ['match', ['get', 'kind'], 'focus', 9, 'traffic', 4, 6],
          'line-offset': ['match', ['get', 'kind'], 'traffic', 5, 0], 'line-dasharray': [1.2, 0.8] } })
      m.addLayer({ id: 'iettstop-circle', type: 'circle', source: 'iettstops',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'hat_sayisi'], 1, 5, 20, 8, 40, 12],
          'circle-color': ['match', ['get', 'peron'], 'Evet', '#7a2e05', '#c2560f'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
      // pedestrian agents (drawn by the simulation panel straight into this source)
      m.addLayer({ id: 'peds-circle', type: 'circle', source: 'peds', layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 16, 2.8, 18, 5],
          'circle-color': ['match', ['get', 's'], 1, '#0b5f66', 2, '#8a96a0', 3, '#3b6fb6', '#f2a33a'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.6 } })
      m.addLayer({ id: 'transfer-circle', type: 'circle', source: 'transfer', filter: ['!=', ['get', 'tur'], 'otobus'],
        paint: { 'circle-radius': 6, 'circle-color': colorBy('tur', TRANSFER_COLORS, '#555'), 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })

      const set = (id: string, data: any) => (m.getSource(id) as GeoJSONSource).setData(data)
      // buildings and tree crowns are built from the engine's TM30 data so the map and the analysis share one geometry
      set('buildings', { type: 'FeatureCollection', features: D.buildings.map(b => ({ type: 'Feature',
        properties: { tur: b.t, kat_adedi: b.k, yukseklik_m: b.h, yukseklik_kaynak: b.s }, geometry: polysToGeom(b.p) })) })
      const treeFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: D.trees.map(t => ({ type: 'Feature',
        properties: { turkce: t.tr, latin: t.la, boy_m: t.h, tac_cap_m: t.d, saglik: t.sa, no: t.no, eslesme: t.es, boy_kaynak: t.bk },
        geometry: polysToGeom([[circle(t.x, t.y, Math.max(t.d, 0.5) / 2)]]) })) }
      set('trees', treeFC)
      set('trunks', trunkFC(treeFC))
      const load = async (s: string, f: string) => set(s, await fetchJSON(DATA_URL + f))
      await Promise.all([
        load('boundary', 'boundary.geojson'), load('extent', 'project_extent.geojson'), load('transfer', 'transfer_points.geojson'),
        load('minibus', 'minibus_lines.geojson'), load('ferry', 'ferry_lines.geojson'), load('corridors', 'bus_corridors.geojson'),
        load('iettroutes', 'iett_routes.geojson'), load('iettstops', 'iett_stops.geojson'),
        load('heritage', 'heritage.geojson'), load('sit', 'sit.geojson'), load('ownership', 'ownership.geojson'), load('infra', 'infrastructure.geojson'),
      ])
      if (disposed) return
      setBusy('')

      const popup = new Popup({ closeButton: true, maxWidth: '300px' })
      m.on('click', (e: MapMouseEvent) => {
        // ignore the click that closes a drawing (and any click while drawing)
        if ((drawRef.current && cb.current.drawMode) || Date.now() - lastDrawEnd.current < 600) return
        // eye-level view: a click walks there (a drag only looks around)
        if (cb.current.walk) { if (!walkDragged.current) walkTo([e.lngLat.lng, e.lngLat.lat]); return }
        const fs = m.queryRenderedFeatures(e.point, { layers: ['comfort-line', 'iettstop-circle', 'iettroute-line', 'corridor-line', 'traffic-line', 'transfer-circle', 'heritage-fill', 'buildings-fill', 'sc-crowns', 'trees-fill', 'surfaces-fill'].filter(l => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none') })
        if (!fs.length) return
        const f = fs[0]
        const pr = f.properties as Record<string, any>
        let html = ''
        if (f.layer.id === 'iettstop-circle') {
          const start = pr.baslayan_hatlar && pr.baslayan_hatlar !== 'None' ? pr.baslayan_hatlar : ''
          html = `<b>${pr.ad}</b> <span class="small muted">(${pr.kod})</span><div class="small">Yön: ${pr.yon} · ${pr.tip}${pr.peron === 'Evet' ? ' · peron durağı' : ''}</div>` +
            (start ? `<div class="small" style="margin-top:4px"><b>Bu duraktan başlayan:</b> ${start}</div>` : '') +
            `<div class="small" style="margin-top:4px"><b>Yakından geçen ${pr.hat_sayisi} hat</b> <span class="muted">(türetilmiş, ≤12 m)</span>: ${pr.hatlar}</div>`
        } else if (f.layer.id === 'iettroute-line') html = `<b>${pr.HAT_KODU}</b> ${pr.HAT_ADI}<div class="small">${pr.YON}: ${pr.GUZERGAH_A}</div><div class="small muted">${pr.GARAJ_ADI} · ${pr.ISLETME_AL}${pr.YOLCU_ACIK && pr.YOLCU_ACIK !== 'None' ? ' · ' + pr.YOLCU_ACIK : ''}</div>`
        else if (f.layer.id === 'comfort-line') html = `<b>${pr.from} → ${pr.to}</b><div class="small">${pr.shade < 0 ? 'güneş yok / saat dışı' : `%${Math.round(pr.shade * 100)} gölgede`} · ${pr.dist_m} m</div><div class="small muted">Yaya konforu: seçili saatte gölgeli pay (geometrik)</div>`
        else if (f.layer.id === 'traffic-line') {
          const lbl = ({ 1: 'Serbest', 2: 'Açık', 3: 'Akıcı', 4: 'Yoğun', 5: 'Çok yoğun' } as Record<number, string>)[pr.C] ?? 'Veri yok'
          html = `<b>${lbl}</b>${pr.V != null && pr.C ? ` · ${pr.V} km/sa` : ''}<div class="small">Veri saati: ${pr.D || '—'} · ${pr.live ? 'canlı' : 'anlık görüntü'}</div>` +
            `<div class="small muted">İBB UYM yol parçası ${pr.S} · ${pr.ilce || '—'} · ${Math.round(pr.uzunluk_m)} m</div>`
        }
        else if (f.layer.id === 'corridor-line') html = `<b>${pr.hat_sayisi} otobüs hattı</b> bu yol parçasından geçiyor<div class="small" style="margin-top:4px">${pr.hatlar}</div><div class="small muted">İETT güzergâhları, 07.10.2026 · gidiş/dönüş tek hat sayılır</div>`
        else if (f.layer.id === 'transfer-circle') html = `<b>${pr.ad}</b><div class="small muted">${pr.tur} · ${pr.hat}</div><div class="small">Yöntem: ${pr.yontem} (±${pr.konum_belirsizligi_m} m)</div>`
        else if (f.layer.id === 'heritage-fill') html = `<b>${pr.eser_adi ?? 'Tescilli yapı'}</b><div class="small muted">${pr.islev ?? ''}</div>`
        else if (f.layer.id === 'buildings-fill') html = `<b>${pr.tur}</b><div class="small">Kat: ${pr.kat_adedi ?? '—'} · Yükseklik: ${pr.yukseklik_m} m</div><div class="small muted">Yükseklik kaynağı: ${pr.yukseklik_kaynak}</div>`
        else if (f.layer.id === 'trees-fill' || f.layer.id === 'sc-crowns') html = `<b>${pr.turkce || 'Ağaç'}</b> <i class="small">${pr.latin ?? ''}</i><div class="small">Boy: ${pr.boy_m} m · Taç: ${pr.tac_cap_m} m · ${pr.saglik ?? ''}</div><div class="small muted">No: ${pr.no ?? '—'} · ${pr.eslesme ?? ''} · boy: ${pr.boy_kaynak ?? ''}</div>`
        else if (f.layer.id === 'surfaces-fill') {
          const orig = surfRef.current.features[Number(pr._i)]
          const acts = ACTIONS[pr.sinif] ?? []
          html = `<b>${SURFACE_LABELS[pr.sinif] ?? pr.sinif}</b><div class="small muted">${pr.ad} · ${pr.malzeme ?? ''} · ${Math.round(pr.alan_m2).toLocaleString('tr-TR')} m²</div>` +
            (acts.length ? `<div class="small" style="margin-top:6px"><b>Bu alanı nasıl değiştirmek istiyorsunuz?</b></div><div class="popup-actions">${acts.map(([k, l]) => `<button class="btn small" data-act="${k}">${l}</button>`).join('')}</div>` : '')
          popup.setLngLat(e.lngLat).setHTML(html).addTo(m)
          popup.getElement()?.querySelectorAll<HTMLElement>('button[data-act]').forEach((b: HTMLElement) => b.addEventListener('click', () => {
            cb.current.onIntervene?.(b.dataset.act!, orig.geometry, `${SURFACE_LABELS[pr.sinif]} (${Math.round(pr.alan_m2).toLocaleString('tr-TR')} m²)`)
            popup.remove()
          }))
          return
        }
        popup.setLngLat(e.lngLat).setHTML(html).addTo(m)
      })
      ;['surfaces-fill', 'transfer-circle', 'buildings-fill', 'trees-fill', 'iettstop-circle', 'corridor-line', 'iettroute-line', 'traffic-line', 'comfort-line'].forEach(l => {
        m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', l, () => { m.getCanvas().style.cursor = '' })
      })

      if (cb.current.interactive !== false) {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
          modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode(), new TerraDrawPointMode()],
        })
        draw.start()
        draw.on('finish', (id) => {
          lastDrawEnd.current = Date.now()
          const f = draw.getSnapshotFeature(id)
          if (f) cb.current.onDrawn?.(f.geometry as GeoJSON.Geometry)
          setTimeout(() => draw.clear(), 50)
        })
        drawRef.current = draw
      }
      setReady(true)
      cb.current.onReady?.(m)
    })
    return () => { disposed = true; try { drawRef.current?.stop() } catch { /* map already removed */ } m.remove() }
  }, [])

  // ------------------------------------------------------------------ state surfaces
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    fetchJSON(DATA_URL + (p.stateKey === 'mevcut' ? 'surfaces_existing.geojson' : 'surfaces_project.geojson')).then((fc: GeoJSON.FeatureCollection) => {
      fc.features.forEach((f, i) => { (f.properties as any)._i = i })
      surfRef.current = fc
      ;(m.getSource('surfaces') as GeoJSONSource).setData(fc)
    })
  }, [ready, p.stateKey])

  useEffect(() => {
    if (!ready) return
    setCanvas(mapRef.current!, 'shadow', 'shadow-img', p.shadow?.canvas ?? null, p.shadow ? llCorners(p.shadow) : null,
      { 'raster-opacity': 1, 'raster-fade-duration': 0 }, !!cb.current.visible.shadow)
  }, [ready, p.shadow])

  useEffect(() => {
    if (!ready) return
    ;(mapRef.current!.getSource('tpaths') as GeoJSONSource).setData(p.transferPaths ?? EMPTY)
  }, [ready, p.transferPaths])

  // ------------------------------------------------------------------ scenario overlays
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    const g = p.scenario?.geoms ?? {}
    const set = (id: string, x: any) => (m.getSource(id) as GeoJSONSource).setData(asFC(x))
    set('sc-area', g.intervention_areas); set('sc-struct', g.structures)
    set('sc-paths', g.affected_paths); set('sc-routes', g.routes); set('sc-changed', g.changed_surfaces)
    const crowns = asFC(g.new_tree_crowns as any)
    crowns.features.forEach(f => { f.properties = { ...(f.properties ?? {}), eslesme: 'senaryo' } })
    set('sc-crowns', crowns)
    set('sc-trunks', trunkFC(crowns))
    const ns = p.scenario?.images?.new_shade
    setCanvas(m, 'sc-newshade-src', 'sc-newshade', ns?.canvas ?? null, ns ? llCorners(ns) : null, { 'raster-fade-duration': 0 }, !!cb.current.visible.scenario)
  }, [ready, p.scenario])

  useEffect(() => {
    if (!ready || !p.focus) return
    const b = bbox(p.focus)
    mapRef.current!.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 18.5, duration: 600 })
  }, [ready, p.focus])

  // ------------------------------------------------------------------ pedestrian comfort
  useEffect(() => {
    if (!ready || !p.comfort) return
    ;(mapRef.current!.getSource('comfort') as GeoJSONSource | undefined)?.setData(p.comfort)
  }, [ready, p.comfort])

  // ------------------------------------------------------------------ live traffic
  useEffect(() => {
    if (!ready || !p.traffic) return
    ;(mapRef.current!.getSource('traffic') as GeoJSONSource | undefined)?.setData(p.traffic)
  }, [ready, p.traffic])

  // ------------------------------------------------------------------ İETT line filter + stop access
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    const code = p.busLine ?? '__none__'
    const hit: any = ['case', ['in', code, ['get', 'hat_list']], 1, 0.2]
    m.setFilter('iettroute-line', ['==', ['get', 'HAT_KODU'], code])
    m.setLayoutProperty('iettroute-line', 'visibility', p.busLine ? 'visible' : 'none')
    m.setPaintProperty('iettstop-circle', 'circle-opacity', p.busLine ? hit : 1)
    m.setPaintProperty('iettstop-circle', 'circle-stroke-opacity', p.busLine ? hit : 1)
    m.setPaintProperty('corridor-line', 'line-opacity', p.busLine ? 0.25 : 0.9)
  }, [ready, p.busLine])

  useEffect(() => {
    if (!ready) return
    setCanvas(mapRef.current!, 'access', 'access-img', p.accessImage?.canvas ?? null, (p.accessImage?.corners as Corners) ?? null,
      { 'raster-resampling': 'nearest' }, !!cb.current.visible.stop_access)
  }, [ready, p.accessImage])

  // ------------------------------------------------------------------ heat raster
  useEffect(() => {
    if (!ready) return
    setCanvas(mapRef.current!, 'heat', 'heat-img', p.heatImage?.canvas ?? null, (p.heatImage?.corners as Corners) ?? null,
      { 'raster-opacity': 0.75, 'raster-resampling': 'nearest' }, !!cb.current.visible.heat)
  }, [ready, p.heatImage])

  // ------------------------------------------------------------------ uploaded layers
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    p.uploads.forEach(u => {
      const sid = `up-${u.id}`
      if (!m.getSource(sid)) {
        if (u.geojson) {
          m.addSource(sid, { type: 'geojson', data: u.geojson })
          m.addLayer({ id: `${sid}-f`, type: 'fill', source: sid, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.3 } })
          m.addLayer({ id: `${sid}-l`, type: 'line', source: sid, paint: { 'line-color': '#0369a1', 'line-width': 1.5 } })
          m.addLayer({ id: `${sid}-c`, type: 'circle', source: sid, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#0369a1' } })
        } else if (u.image) {
          m.addSource(sid, { type: 'canvas', canvas: u.image.canvas, coordinates: u.image.corners as Corners, animate: false } as any)
          m.addLayer({ id: `${sid}-r`, type: 'raster', source: sid, paint: { 'raster-opacity': 0.75, 'raster-resampling': 'nearest' } }, 'shadow-img')
        } else return
      }
      setVis(m, [`${sid}-f`, `${sid}-l`, `${sid}-c`, `${sid}-r`], !!p.visible[u.id])
    })
  }, [ready, p.uploads, p.visible])

  // ------------------------------------------------------------------ visibility + 3D
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    for (const [k, ids] of Object.entries(GROUPS)) {
      if (k === 'heat') { setVis(m, ids, !!p.visible.heat && !!p.heatImage); continue }
      const on = !!p.visible[k]
      ids.forEach(id => {
        const is3d = id.endsWith('-3d')
        setVis(m, [id], on && (is3d ? p.threeD : !(p.threeD && (id === 'buildings-fill' || id === 'trees-fill' || id === 'sc-struct'))))
      })
    }
  }, [ready, p.visible, p.threeD, p.heatImage])

  // ------------------------------------------------------------------ eye-level walk mode
  useEffect(() => {
    if (!ready) return
    const m = mapRef.current!
    m.setMaxPitch(p.walk ? 85 : 60)
    m.setMaxZoom(p.walk ? 24 : 20.5)
    if (p.interactive === false) return
    const hs = [m.dragPan, m.scrollZoom, m.doubleClickZoom, m.keyboard, m.dragRotate, m.touchZoomRotate]
    if (!p.walk) {
      hs.forEach(h => h.enable())
      // wait one tick: split partners clamp their zoom first and their sync would cut this animation short
      if (eye.current) { lastEye = { ...eye.current }; eye.current = null; setTimeout(() => m.easeTo({ pitch: cb.current.threeD ? 58 : 0, zoom: 17.3, duration: 800 }), 80) }
      return
    }
    eye.current = lastEye ? { ...lastEye } : { ...WALK_START, ll: [...WALK_START.ll] as [number, number] }
    hs.forEach(h => h.disable())
    requestAnimationFrame(applyEye)  // after split partners have raised their pitch/zoom limits
    const box = m.getCanvasContainer()
    let down: { x: number; b: number } | null = null
    const pd = (e: PointerEvent) => { down = { x: e.clientX, b: eye.current?.bearing ?? 0 }; walkDragged.current = false }
    const pm = (e: PointerEvent) => {
      if (!down || !eye.current) return
      const dx = e.clientX - down.x
      if (Math.abs(dx) > 4) walkDragged.current = true
      if (walkDragged.current) { eye.current.bearing = down.b - dx * 0.25; applyEye() }
    }
    const pu = () => { down = null }
    const wh = (e: WheelEvent) => { e.preventDefault(); walkStep(e.deltaY < 0 ? STEP_M : -STEP_M) }
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const s = e.shiftKey ? 4 : 1
      const k = e.key.toLowerCase()
      if (k === 'arrowup' || k === 'w') walkStep(STEP_M * s)
      else if (k === 'arrowdown' || k === 's') walkStep(-STEP_M * s)
      else if (k === 'arrowleft' || k === 'a') walkTurn(-10 * s)
      else if (k === 'arrowright' || k === 'd') walkTurn(10 * s)
      else return
      e.preventDefault()
    }
    box.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu)
    box.addEventListener('wheel', wh, { passive: false }); window.addEventListener('keydown', kd)
    return () => {
      box.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu)
      box.removeEventListener('wheel', wh); window.removeEventListener('keydown', kd)
    }
  }, [ready, p.walk])

  // only the primary map animates the camera; a split-screen partner follows through the sync handler
  useEffect(() => {
    if (!ready || p.interactive === false || p.walk) return
    mapRef.current!.easeTo({ pitch: p.threeD ? 58 : 0, bearing: p.threeD ? -20 : 0, duration: 700 })
  }, [ready, p.threeD])

  useEffect(() => {
    const d = drawRef.current
    if (!ready || !d) return
    d.setMode(p.drawMode ?? 'static')
  }, [ready, p.drawMode])

  return (
    <div className="map" ref={el} data-state={p.stateKey} data-primary={p.interactive !== false ? '1' : '0'}>
      <div className="tag-state">{p.label}</div>
      {busy && <div className="busy">{busy}</div>}
      {p.walk && p.interactive !== false && <div className="walkpad" onPointerDown={e => e.stopPropagation()}>
        <div className="walkpad-keys">
          <button onClick={() => walkTurn(-20)} title="Sola dön (←)" aria-label="Sola dön">⟲</button>
          <button onClick={() => walkStep(STEP_M * 3)} title="İleri yürü (↑)" aria-label="İleri">↑</button>
          <button onClick={() => walkTurn(20)} title="Sağa dön (→)" aria-label="Sağa dön">⟳</button>
          <button onClick={() => walkTurn(180)} title="Arkana dön" aria-label="Arkana dön">↶</button>
          <button onClick={() => walkStep(-STEP_M * 3)} title="Geri (↓)" aria-label="Geri">↓</button>
        </div>
        <div className="walkpad-hint">Tıkla: oraya git · sürükle: etrafa bak · ok tuşları / W A S D: yürü · tekerlek: ileri-geri</div>
      </div>}
    </div>
  )
}
