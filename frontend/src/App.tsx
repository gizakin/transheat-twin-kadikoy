import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MLMap } from 'maplibre-gl'
import { api } from './api'
import { ExplainModal, useExplain } from './components/ui'
import MapView, { type DrawMode } from './map/MapView'
import { DEFAULT_VISIBLE } from './map/layers'
import Landing, { type Module } from './pages/Landing'
import TrafficInfo, { ScenarioTraffic } from './panels/TrafficInfo'
import { areaTraffic, lineLiveTime, pathExposure, prepSegs } from './engine/trafficLink'
import { geomToPolys } from './engine/data'
import ComfortPanel from './panels/ComfortPanel'
import PedSimPanel from './panels/PedSimPanel'
import { comfortFC, stretchPolygon, type ComfortProfile, type Stretch } from './engine/comfort'
import { toLL } from './engine/data'
import { sunPosition } from './engine/sun'
import { loadAir, loadWeather, weatherAt, type Air, type Weather } from './engine/weather'
import WeatherInfo, { AirQualityInfo } from './panels/WeatherInfo'
import ExportDialog, { type ExportOpts } from './panels/ExportDialog'
import { captureMap, composeFigure, download, fileName, figureLayout, type FigureSpec } from './lib/exporter'
import { buildDesc, buildLegend, buildMeta, heatLegend, type HeatLegend } from './lib/figureContent'
import { loadTraffic, trafficFeatures, trafficSegments, type TrafficState } from './engine/traffic'
import CatalogPage from './pages/CatalogPage'
import ComparePage from './pages/ComparePage'
import HelpPage from './pages/HelpPage'
import LiteraturePage from './pages/LiteraturePage'
import ReportPage from './pages/ReportPage'
import LayerPanel from './panels/LayerPanel'
import { HeatSimPanel, ScenarioResultPanel } from './panels/ResultPanel'
import ScenarioPanel, { defaults, RunBar } from './panels/ScenarioPanel'
import AnalysisPanel from './panels/AnalysisPanel'
import DemandPanel from './panels/DemandPanel'
import MapLegend from './panels/MapLegend'
import SimTimeline from './panels/SimTimeline'
import { Acc, openAcc } from './components/Acc'
import { useTheme } from './lib/theme'
import type { LayerMeta, ScenarioDef, ScenarioResult, Selection, StateKpis } from './types'

type Tab = 'map' | 'compare' | 'lit' | 'catalog' | 'report' | 'help'
type View = 'mevcut' | 'proje' | 'split'
type Key = 'mevcut' | 'proje'

/** Current wall-clock time in Istanbul (the sun model works in Europe/Istanbul local time, whatever the viewer's zone). */
function istanbulNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}

const nowHM = () => { const n = istanbulNow(); return `${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}` }
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** Side panels: open/closed and width per viewer (map-first: closing a panel gives the map the space). */
type PanelSt = { left: boolean; right: boolean; lw: number; rw: number }
function usePanels() {
  const narrow = window.innerWidth < 900
  const [p, setP] = useState<PanelSt>(() => {
    const d = { left: !narrow, right: !narrow, lw: 310, rw: 370 }
    try { return { ...d, ...JSON.parse(localStorage.getItem('transheat.panels') || '{}'), ...(narrow ? { left: false, right: false } : {}) } } catch { return d }
  })
  useEffect(() => { try { localStorage.setItem('transheat.panels', JSON.stringify(p)) } catch { /* storage unavailable */ } }, [p])
  return [p, (o: Partial<PanelSt>) => setP(x => ({ ...x, ...o }))] as const
}

/** Drag handle between a side panel and the map. */
function Resizer({ side, width, set }: { side: 'left' | 'right'; width: number; set: (w: number) => void }) {
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget, x0 = e.clientX, w0 = width, dir = side === 'left' ? 1 : -1
    el.setPointerCapture(e.pointerId); el.classList.add('drag')
    const mv = (ev: PointerEvent) => set(Math.max(260, Math.min(560, w0 + dir * (ev.clientX - x0))))
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
  }
  return <div className={`resizer ${side}`} onPointerDown={down} role="separator" aria-orientation="vertical" aria-label="Panel genişliği: sürükleyin veya ok tuşlarını kullanın" tabIndex={0}
    onKeyDown={e => { if (e.key === 'ArrowLeft') set(Math.max(260, Math.min(560, width - 20 * (side === 'left' ? 1 : -1)))); if (e.key === 'ArrowRight') set(Math.max(260, Math.min(560, width + 20 * (side === 'left' ? 1 : -1)))) }} />
}

const PRESETS: [string, string][] = [['2026-03-21', '21 Mart'], ['2026-06-21', '21 Haziran'], ['2026-07-15', '15 Temmuz'], ['2026-09-23', '23 Eylül'], ['2025-12-21', '21 Aralık (2025)']]

/** Draggable divider of the split view: left = MEVCUT, right = PROJE (keyboard: ←/→). */
function SwipeBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const drag = (e: React.PointerEvent) => {
    const host = (e.currentTarget as HTMLElement).closest('.mapwrap') as HTMLElement
    const r = host.getBoundingClientRect()
    const move = (ev: PointerEvent) => onChange(Math.max(2, Math.min(98, ((ev.clientX - r.left) / r.width) * 100)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    e.preventDefault()
  }
  return <div className="swipe-bar" style={{ left: `${value}%` }}>
    <button className="swipe-knob" onPointerDown={drag} aria-label="Karşılaştırma çubuğu: sola/sağa kaydırın"
      onKeyDown={e => { if (e.key === 'ArrowLeft') onChange(Math.max(2, value - 5)); if (e.key === 'ArrowRight') onChange(Math.min(98, value + 5)) }}>⇔</button>
  </div>
}

const newDef = (base: Key, time: string): ScenarioDef => ({
  scenario_name: 'Senaryo', area: 'Kadikoy_Meydan', base, time, interventions: [], source: 'user_defined',
})

export default function App() {
  const { theme, set: setTheme } = useTheme()
  const [panels, setPanels] = usePanels()
  const [tab, setTab] = useState<Tab>(() => (window.location.hash === '#yardim' ? 'help' : 'map'))
  const [view, setView] = useState<View>('mevcut')
  const [threeD, setThreeD] = useState(false)
  const [walk, setWalk] = useState(false)
  // shadows follow the real clock on first open ("canlı"); any manual change of date or hour stops following until “Şimdi”
  const [live, setLive] = useState(true)
  const exportingRef = useRef(false)
  const [date, setDateRaw] = useState(() => istanbulNow().date)
  const [hour, setHourRaw] = useState(() => istanbulNow().hour)
  const [minute, setMinute] = useState(() => istanbulNow().minute)
  const setDate = (d: string) => { setLive(false); setMinute(0); setDateRaw(d) }
  const setHour = (h: number) => { setLive(false); setMinute(0); setHourRaw(h) }
  const goLive = () => { const n = istanbulNow(); setDateRaw(n.date); setHourRaw(n.hour); setMinute(n.minute); setLive(true) }
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => {
      if (exportingRef.current) return
      const n = istanbulNow()
      setDateRaw(d => (d === n.date ? d : n.date)); setHourRaw(h => (h === n.hour ? h : n.hour)); setMinute(m => (m === n.minute ? m : n.minute))
    }, 60000)
    return () => window.clearInterval(id)
  }, [live])
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const time = `${date}T${hhmm}`
  const sunUp = useMemo(() => sunPosition(time).elevation > 0, [time])

  // Open-Meteo weather for the selected date; today's 15-min value is refreshed every 15 min while following the clock
  const [weather, setWeather] = useState<Weather | null>(null)
  const [weatherErr, setWeatherErr] = useState('')
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [weatherOk, setWeatherOk] = useState('')
  const [wxTick, setWxTick] = useState(0)
  const isToday = date === istanbulNow().date
  useEffect(() => {
    let stop = false
    const get = (refresh: boolean) => {
      setWeatherBusy(true)
      loadWeather(date, istanbulNow().date, refresh).then(w => { if (!stop) { setWeather(w); setWeatherErr(''); setWeatherOk(nowHM()) } })
        .catch(e => { if (!stop) { setWeather(o => (o && o.date === date ? o : null)); setWeatherErr(e?.name === 'AbortError' ? 'zaman aşımı' : String(e?.message ?? e)) } })
        .finally(() => { if (!stop) setWeatherBusy(false) })
    }
    get(wxTick > 0)
    const id = live && isToday ? window.setInterval(() => get(true), 15 * 60000) : 0
    return () => { stop = true; if (id) window.clearInterval(id) }
  }, [date, live, isToday, wxTick])
  // Open-Meteo air quality (CAMS), refreshed hourly while following today's clock
  const [air, setAir] = useState<Air | null>(null)
  const [airErr, setAirErr] = useState('')
  const [airBusy, setAirBusy] = useState(false)
  const [airOk, setAirOk] = useState('')
  const [airTick, setAirTick] = useState(0)
  useEffect(() => {
    let stop = false
    const get = (refresh: boolean) => {
      setAirBusy(true)
      loadAir(date, istanbulNow().date, refresh).then(a => { if (!stop) { setAir(a); setAirErr(''); setAirOk(nowHM()) } })
        .catch(e => { if (!stop) { setAir(o => (o && o.hours[0]?.time.slice(0, 10) === date ? o : null)); setAirErr(e?.name === 'AbortError' ? 'zaman aşımı' : String(e?.message ?? e)) } })
        .finally(() => { if (!stop) setAirBusy(false) })
    }
    get(airTick > 0)
    const id = live && isToday ? window.setInterval(() => get(true), 60 * 60000) : 0
    return () => { stop = true; if (id) window.clearInterval(id) }
  }, [date, live, isToday, airTick])
  const wAt = useMemo(() => (weather ? weatherAt(weather, time, live && isToday) : null), [weather, time, live, isToday])
  const [visible, setVisible] = useState<Record<string, boolean>>(DEFAULT_VISIBLE)
  const [layers, setLayers] = useState<LayerMeta[]>([])
  const [stateK, setStateK] = useState<Partial<Record<Key, StateKpis | null>>>({})
  const [stateAt, setStateAt] = useState<Partial<Record<Key, string>>>({})
  const [profile, setProfile] = useState<{ mevcut?: any[]; proje?: any[] }>({})
  const [heat, setHeat] = useState<any>(null)
  const [def, setDef] = useState<ScenarioDef>(newDef('mevcut', time))
  const [selection, setSelection] = useState<Selection | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>(null)
  const [drawingFor, setDrawingFor] = useState<number | null>(null)
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [focus, setFocus] = useState<GeoJSON.Geometry | null>(null)
  const [lit, setLit] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [booting, setBooting] = useState('Veri yükleniyor…')
  const [swipe, setSwipe] = useState(50)
  const [busLine, setBusLine] = useState<string | null>(null)
  const [busLines, setBusLines] = useState<{ kod: string; ad: string }[]>([])
  const [accessImg, setAccessImg] = useState<any>(null)
  const [traffic, setTraffic] = useState<TrafficState | null>(null)
  const [trafficSegs, setTrafficSegs] = useState<GeoJSON.FeatureCollection | null>(null)
  const [trafficTick, setTrafficTick] = useState(0)
  const [trafficOk, setTrafficOk] = useState('')
  const [comfort, setComfort] = useState<ComfortProfile | null>(null)
  const [comfortOther, setComfortOther] = useState<ComfortProfile | null>(null)
  const [comfortBusy, setComfortBusy] = useState(false)
  const [comfortSel, setComfortSel] = useState<number | null>(null)
  const [comfortFocus, setComfortFocus] = useState<Stretch | null>(null)
  const [simMode, setSimMode] = useState<'local' | 'literature'>('local')
  const [simView, setSimView] = useState<'lst' | 'delta'>('lst')
  const [projeSim, setProjeSim] = useState<any>(null)
  const [scenarioSim, setScenarioSim] = useState<any>(null)
  const [hintClosed, setHintClosed] = useState(() => { try { return localStorage.getItem('transheat.hint') === '1' } catch { return false } })
  const [landing, setLanding] = useState(() => {
    if (window.location.hash === '#yardim') return false
    try { return localStorage.getItem('transheat.landing') !== '1' } catch { return true }
  })
  const openModule = (m: Module | null) => {
    setLanding(false)
    try { localStorage.setItem('transheat.landing', '1') } catch { /* storage unavailable */ }
    setTab('map')
    if (m === 'heat') { setVisible(v => ({ ...v, heat: true, shadow: false, surfaces: false })); setView('split') }
    if (m === 'transport') { setVisible(v => ({ ...v, iett_stops: true, bus_corridors: false, traffic: true, transfer_points: true, heat: false, shadow: false })); setView('mevcut') }
    if (m === 'green') { setVisible(v => ({ ...v, trees: true, shadow: true, surfaces: true, heat: false })); setView('mevcut') }
    if (m === 'scenario') { setHintClosed(false); setView('mevcut') }
  }
  useEffect(() => { if (hintClosed) try { localStorage.setItem('transheat.hint', '1') } catch { /* storage unavailable */ } }, [hintClosed])
  const ex = useExplain()
  const maps = useRef<MLMap[]>([])
  // panels open, close and resize: give the maps their new size (also during a drag)
  const wrapRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if (!exportingRef.current) maps.current.forEach(m => { if ((m.getContainer() as HTMLElement).isConnected) m.resize() }) })
    })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [tab, booting])

  const reloadLayers = useCallback(() => {
    api.layers().then(setLayers)
    api.heat().then(setHeat)
  }, [])
  useEffect(() => {
    api.ready(setBooting).then(() => { setBooting(''); reloadLayers(); api.literature().then(setLit) }).catch(e => setBooting('Veri yüklenemedi: ' + e.message))
  }, [reloadLayers])
  useEffect(() => { setDef(d => ({ ...d, time })) }, [time])

  const keys: Key[] = view === 'split' ? ['mevcut', 'proje'] : [view]
  const keyStr = keys.join(',')
  // state KPIs + shadow for the selected time (debounced while the slider moves)
  useEffect(() => {
    if (booting) return
    const t = setTimeout(() => keys.forEach(k => {
      api.stateKpis(k, time).then(r => { setStateK(s => ({ ...s, [k]: r })); setStateAt(s => ({ ...s, [k]: time })) }).catch(e => setErr(e.message))
    }), 350)
    return () => clearTimeout(t)
  }, [keyStr, time, booting, heat?.id])
  useEffect(() => {
    if (booting) return
    setProfile({})
    const t = setTimeout(() => keys.forEach(k => api.shadeProfile(k, date).then(r => setProfile(p => ({ ...p, [k]: r }))).catch(() => { })), 1500)
    return () => clearTimeout(t)
  }, [keyStr, date, booting])

  // simulated heat maps (project state when it is on screen; the current scenario result)
  useEffect(() => {
    if (booting || !heat?.available || view === 'mevcut') return
    api.heatSim('proje', simMode, simView).then(setProjeSim).catch(() => setProjeSim(null))
  }, [booting, heat?.id, view, simMode, simView])
  useEffect(() => {
    if (booting || !heat?.available || !result) { setScenarioSim(null); return }
    api.heatSim(result.scenario, simMode, simView).then(setScenarioSim).catch(() => setScenarioSim(null))
  }, [booting, heat?.id, result, simMode, simView])

  useEffect(() => { if (!booting) api.iettLines().then(setBusLines) }, [booting])
  useEffect(() => {
    if (booting || !visible.stop_access) return
    api.accessImage(result ? result.scenario : null).then(setAccessImg).catch(() => setAccessImg(null))
  }, [booting, visible.stop_access, result])

  // İBB live traffic: fetched while the layer, the comfort module, a scenario result or a selected bus line needs it; refreshed every minute
  const trafficNeeded = !!visible.traffic || !!visible.comfort || !!result || !!busLine
  useEffect(() => {
    if (booting || !trafficNeeded) return
    let stop = false
    const run = () => loadTraffic().then(t => { if (!stop) { setTraffic(t); if (t.live) setTrafficOk(nowHM()) } }).catch(() => {})
    trafficSegments().then(s => { if (!stop) setTrafficSegs(s) })
    run()
    const id = window.setInterval(run, 60000)
    return () => { stop = true; window.clearInterval(id) }
  }, [booting, trafficNeeded, trafficTick])
  // live traffic linked to the other analyses (observation only)
  const segsTM = useMemo(() => (trafficSegs && traffic ? prepSegs(trafficSegs, traffic) : null), [trafficSegs, traffic])
  const [corridorsFC, setCorridorsFC] = useState<GeoJSON.FeatureCollection | null>(null)
  const [routesFC, setRoutesFC] = useState<GeoJSON.FeatureCollection | null>(null)
  useEffect(() => { if (result && !corridorsFC) fetch('data/bus_corridors.geojson').then(r => r.json()).then(setCorridorsFC).catch(() => {}) }, [result, corridorsFC])
  useEffect(() => { if (busLine && !routesFC) fetch('data/iett_routes.geojson').then(r => r.json()).then(setRoutesFC).catch(() => {}) }, [busLine, routesFC])
  const trafficTime = traffic ? (Object.values(traffic.recs).find(r => r.D)?.D ?? traffic.date.slice(11, 16)) : ''
  const areaInfo = useMemo(() => {
    if (!result || !segsTM) return null
    const fc = result.geoms.intervention_areas as GeoJSON.FeatureCollection | undefined
    const polys = (fc?.features ?? []).flatMap(f => geomToPolys(f.geometry))
    return polys.length ? areaTraffic(polys, segsTM, corridorsFC) : null
  }, [result, segsTM, corridorsFC])
  const busLineLive = useMemo(() => {
    if (!busLine || !routesFC || !segsTM || !traffic) return null
    const fs = routesFC.features.filter(f => f.properties!.HAT_KODU === busLine)
    return fs.length ? { dirs: lineLiveTime(fs, segsTM), time: trafficTime, live: traffic.live } : null
  }, [busLine, routesFC, segsTM, traffic, trafficTime])
  // pedestrian comfort: hour-by-hour shade along transfer paths for the state on screen (scenario if one was run) + the other base state
  const comfortTarget: 'mevcut' | 'proje' | ScenarioDef = result ? result.scenario : view === 'proje' ? 'proje' : 'mevcut'
  const comfortKey = typeof comfortTarget === 'string' ? comfortTarget : JSON.stringify(comfortTarget)
  useEffect(() => {
    if (booting || !visible.comfort) return
    let stop = false
    setComfortBusy(true)
    const otherKey = (typeof comfortTarget === 'string' ? comfortTarget : comfortTarget.base) === 'proje' ? 'mevcut' : 'proje'
    api.comfort(comfortTarget, date).then(p => { if (!stop) setComfort(p) })
      .then(() => api.comfort(otherKey, date)).then(p => { if (!stop) setComfortOther(p) })
      .catch(e => setErr(String(e?.message ?? e))).finally(() => { if (!stop) setComfortBusy(false) })
    return () => { stop = true }
  }, [booting, visible.comfort, date, comfortKey])
  const exposure = useMemo(() => {
    if (!comfort || !segsTM || !traffic) return null
    const byId: Record<number, ReturnType<typeof pathExposure>> = {}
    comfort.paths.forEach(p => { byId[p.id] = pathExposure(p.c, segsTM) })
    const n = istanbulNow()
    return { byId, time: trafficTime, live: traffic.live, isNow: live || (date === n.date && hour === n.hour) }
  }, [comfort, segsTM, traffic, trafficTime, live, date, hour])
  const comfortMap = useMemo(() => (comfort ? comfortFC(comfort, comfort.hours.indexOf(hour), comfortSel, comfortFocus,
    comfortSel != null && exposure ? exposure.byId[comfortSel]?.stretches ?? [] : []) : null), [comfort, hour, comfortSel, comfortFocus, exposure])
  const tryShade = (s: Stretch, label: string) => {
    onIntervene('tree_planting', stretchPolygon(s), `Gölge önerisi: ${label}`, { tree_count: Math.max(2, Math.round(s.len / 8)), canopy_diameter: 6 })
    setVisible(v => ({ ...v, scenario: true }))
  }

  const trafficFC = useMemo(() => (trafficSegs ? trafficFeatures(trafficSegs, traffic) : null), [trafficSegs, traffic])

  const uploads = useMemo(() => layers.filter(l => l.id.startsWith('upload_')), [layers])
  const meta = useMemo(() => Object.fromEntries(layers.map(l => [l.id, l])), [layers])

  // keep split-screen maps in sync
  const syncLock = useRef(false)
  const onReady = useCallback((m: MLMap) => {
    maps.current = [...maps.current.filter(o => o.getContainer().isConnected), m]
    const other = maps.current.find(o => o !== m)
    if (other) m.jumpTo({ center: other.getCenter(), zoom: other.getZoom(), bearing: other.getBearing(), pitch: other.getPitch() })
    // one lock shared by all maps: a partner's echo must not jump the leading map back (that would cut its animations)
    m.on('move', () => {
      if (syncLock.current) return
      syncLock.current = true
      maps.current.filter(o => o !== m && o.getContainer().isConnected)
        .forEach(o => o.jumpTo({ center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }))
      syncLock.current = false
    })
  }, [])

  const describe = (g: GeoJSON.Geometry, label: string) => {
    const sel: Selection = { geometry: g, label }
    setSelection(sel)
    openAcc('left.area')
    if (g.type.includes('Polygon')) api.select(g, def.base, time).then(info => setSelection({ ...sel, info })).catch(() => { })
  }

  const onDrawn = (g: GeoJSON.Geometry) => {
    setDrawMode(null)
    if (drawingFor !== null) {
      const i = drawingFor
      setDef(d => ({ ...d, interventions: d.interventions.map((iv, j) => j === i ? { ...iv, geometry: g } : iv) }))
      setDrawingFor(null)
    }
    describe(g, g.type === 'LineString' ? 'Çizilen güzergâh' : g.type === 'Point' ? 'Seçilen nokta' : 'Çizilen alan')
  }

  const onIntervene = (type: string, geometry: GeoJSON.Geometry, label: string, params: Record<string, unknown> = {}) => {
    describe(geometry, label)
    setDef(d => ({ ...d, interventions: [...d.interventions, { ...defaults(type), ...params, geometry }] }))
    setMsg('Müdahale eklendi: parametreleri sol panelde düzenleyip “Senaryoyu Çalıştır”a basın.')
    setPanels({ left: true }); openAcc('left.iv')
  }
  // automation hook for the presentation/E2E scripts (only with ?e2e in the address)
  if (new URLSearchParams(window.location.search).has('e2e'))
    (window as any).__tt = { onIntervene, get: () => ({ stateK, stateAt, result, time }) }

  const run = () => {
    setRunning(true); setErr('')
    api.run(def).then(r => { setResult(r); setFocus((r.geoms.analysis_area as GeoJSON.Feature).geometry); setVisible(v => ({ ...v, scenario: true })); setPanels({ right: true }); openAcc('right.perf') })
      .catch(e => setErr(e.message)).finally(() => setRunning(false))
  }
  const save = () => {
    setRunning(true); setErr('')
    api.save(def).then(r => {
      setResult(r.results)
      setMsg(`“${r.definition.scenario_name}” kaydedildi. Karşılaştırma ve Rapor sekmelerinde kullanılabilir.`)
      setDef(newDef(def.base, time))
    }).catch(e => setErr(e.message)).finally(() => setRunning(false))
  }

  const mapFor = (k: Key, primary: boolean) => {
    const showScenario = !!result && result.scenario.base === k && !!visible.scenario
    return <MapView key={k + (primary ? '-p' : '-s')} stateKey={k}
      label={(k === 'mevcut' ? 'MEVCUT' : 'PROJE') + (showScenario ? ' + SENARYO' : '')}
      visible={visible} shadow={stateK[k]?.shadow ?? null} transferPaths={stateK[k]?.transfer_paths ?? null}
      scenario={showScenario ? result : null} heatImage={!heat?.available ? null : showScenario && scenarioSim?.available ? scenarioSim.image
        : k === 'proje' && projeSim?.available ? projeSim.image : heat.image} uploads={uploads}
      threeD={threeD || walk} walk={walk} drawMode={primary ? drawMode : null} onDrawn={onDrawn} onIntervene={onIntervene} onReady={onReady}
      focus={focus} interactive={primary} busLine={busLine} accessImage={accessImg} traffic={trafficFC} comfort={visible.comfort ? comfortMap : null} />
  }

  // ------------------------------------------------------------------ figure export
  const [exportOpen, setExportOpen] = useState(false)
  const [expBusy, setExpBusy] = useState('')
  const [expErr, setExpErr] = useState('')
  const [expDone, setExpDone] = useState('')
  const R = useRef<any>({})
  R.current = { stateK, heat, projeSim, scenarioSim, traffic, wAt, layers, visible, view, result, simMode, simView, time }
  const findMap = (k: Key) => maps.current.find(m => { const el = m.getContainer() as HTMLElement; return el.isConnected && el.dataset.state === k })
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const PRESET_LAYERS: Record<string, Record<string, boolean>> = {
    heat: { heat: true, buildings: true, surfaces: false, shadow: false, trees: false, traffic: false, comfort: false, stop_access: false, bus_corridors: false, transfer_paths: false },
    green: { surfaces: true, trees: true, shadow: true, buildings: true, scenario: true, heat: false, traffic: false, comfort: false, stop_access: false, bus_corridors: false },
    transport: { transfer_points: true, iett_stops: true, transfer_paths: true, stop_access: true, buildings: true, heat: false, surfaces: false, shadow: false, traffic: false, comfort: false, bus_corridors: false },
  }
  const settle = async (keys: Key[], vis: Record<string, boolean>, scenario: boolean) => {
    const t0 = Date.now()
    const ready = () => keys.every(k => {
      const m = findMap(k)
      if (!m || !m.loaded()) return false
      if ((m.getContainer() as HTMLElement).querySelector('.busy')) return false
      if (vis.shadow && !R.current.stateK[k]?.shadow) return false
      return true
    })
    while (!ready()) { if (Date.now() - t0 > 60000) throw new Error('harita hazırlanamadı (zaman aşımı)'); await sleep(250) }
    if (vis.heat) {   // heat rasters are computed asynchronously; wait for the ones these panels show (max 20 s)
      const t1 = Date.now()
      const heatReady = () => !!R.current.heat?.available && keys.every(k => (scenario ? !!R.current.scenarioSim : k !== 'proje' || !!R.current.projeSim))
      while (!heatReady() && Date.now() - t1 < 20000) await sleep(250)
    }
    await sleep(900)
  }
  const runExport = async (o: ExportOpts) => {
    const S0 = { view, visible }
    const res: ScenarioResult | null = R.current.result
    setExpErr(''); setExpDone(''); exportingRef.current = true
    try {
      setExpBusy('Hazırlanıyor…')
      let vis: Record<string, boolean> = { ...visible, ...(o.preset === 'asis' ? {} : PRESET_LAYERS[o.preset]) }
      const nm = (k: Key) => (k === 'mevcut' ? 'MEVCUT' : 'PROJE')
      type P = { k: Key; scenario: boolean; label: string }
      type Step = { view: View; vis: Record<string, boolean>; panels: P[] }
      const scOn = (k: Key, v: Record<string, boolean>) => !!res && res.scenario.base === k && !!v.scenario
      let steps: Step[]
      const base = (res?.scenario.base ?? 'mevcut') as Key
      const scName = res?.scenario.scenario_name ?? ''
      switch (o.kind) {
        case 'mevcut': vis = { ...vis, scenario: false }; steps = [{ view: 'mevcut', vis, panels: [{ k: 'mevcut', scenario: false, label: 'MEVCUT DURUM' }] }]; break
        case 'proje': vis = { ...vis, scenario: false }; steps = [{ view: 'proje', vis, panels: [{ k: 'proje', scenario: false, label: 'PROJE DURUMU' }] }]; break
        case 'senaryo': vis = { ...vis, scenario: true }; steps = [{ view: base, vis, panels: [{ k: base, scenario: true, label: `${nm(base)} + SENARYO: ${scName}` }] }]; break
        case 'cmp_mp': steps = [{ view: 'split', vis, panels: (['mevcut', 'proje'] as Key[]).map(k => ({ k, scenario: scOn(k, vis), label: nm(k) + (scOn(k, vis) ? ' + SENARYO' : '') })) }]; break
        case 'cmp_sc': steps = [{ view: base, vis: { ...vis, scenario: false }, panels: [{ k: base, scenario: false, label: `ÖNCESİ: ${nm(base)}` }] },
          { view: base, vis: { ...vis, scenario: true }, panels: [{ k: base, scenario: true, label: `SONRASI: senaryo “${scName}”` }] }]; break
        default:
          steps = view === 'split'
            ? [{ view: 'split', vis, panels: (['mevcut', 'proje'] as Key[]).map(k => ({ k, scenario: scOn(k, vis), label: nm(k) + (scOn(k, vis) ? ' + SENARYO' : '') })) }]
            : [{ view, vis, panels: [{ k: view as Key, scenario: scOn(view as Key, vis), label: nm(view as Key) + (scOn(view as Key, vis) ? ` + SENARYO: ${scName}` : '') }] }]
      }
      const panels = steps.flatMap(s => s.panels)
      const labels = panels.map(p => p.label)
      const stateLabelsNow = () => panels.map(p => (p.scenario && res ? `Senaryo “${scName}” (taban: ${res.base_label})` : R.current.stateK[p.k]?.label ?? nm(p.k)))
      const autoTitle = { view: 'Kadıköy Meydanı dijital ikiz görünümü', mevcut: 'Kadıköy Meydanı – mevcut durum', proje: 'Kadıköy Meydanı – proje durumu',
        senaryo: `Kadıköy Meydanı – müdahale senaryosu: ${scName}`, cmp_mp: 'Kadıköy Meydanı – mevcut durum ve proje karşılaştırması',
        cmp_sc: `Kadıköy Meydanı – müdahale öncesi ve sonrası: ${scName}` }[o.kind]
      const presetName = { asis: '', heat: ' · kentsel ısı ve yüzey sıcaklığı', green: ' · yeşil alan, ağaç ve gölge', transport: ' · ulaşım ve aktarma' }[o.preset]
      const spec: FigureSpec = {
        layout: o.layout, res: o.res, format: o.format,
        title: o.showTitle ? (o.title.trim() || autoTitle + presetName) : null,
        subtitle: o.showTitle ? `Dijital İkiz ve Kentsel Analiz Platformu · ${time.replace('T', ' ')} (İstanbul)` : null,
        legend: null, meta: null, desc: null, scaleNorth: o.showScale, legendPos: o.legendPos,
        side: (o.legendPos === 'side' && o.showLegend) || o.showMeta || o.showDesc,
        footer: `Dijital İkiz ve Kentsel Analiz Platformu – Kadıköy Meydanı Ulaşım ve Kentsel Isı Dijital İkizi · Geliştirici: Transheat Twin · üretim ${new Date().toLocaleString('tr-TR')}`,
      }
      // the legend/meta need the panel states first; lay out with placeholders of the right kind so map sizes are final.
      // A provisional legend (same groups, placeholder ticks) sizes the in-figure legend band before the maps are captured.
      const provHeats: HeatLegend[] = [...new Set(panels.map(p => (p.scenario ? 'sc' : p.k === 'proje' ? 'pr' : 'ob')))].map(t => ({ title: t, ticks: ['', '', ''], method: '' }))
      const visLast = steps[steps.length - 1].vis
      spec.legend = o.showLegend ? (o.legendPos !== 'side' ? buildLegend(visLast, provHeats, panels.some(p => p.scenario)) : [{ title: '' }]) : null
      if (spec.legend && !spec.legend.length) spec.legend = o.legendPos !== 'side' ? null : spec.legend
      spec.meta = o.showMeta ? [''] : null
      spec.desc = o.showDesc ? [''] : null
      const L = figureLayout(spec, panels.length)
      const caps: { cap: Awaited<ReturnType<typeof captureMap>>; label: string }[] = []
      const heats: HeatLegend[] = []
      let pi = 0
      for (const [si, st] of steps.entries()) {
        setExpBusy(`${si + 1}/${steps.length}: görünüm hazırlanıyor (${st.panels.map(p => p.label).join(', ')})…`)
        setView(st.view); setVisible(st.vis)
        await sleep(80)
        await settle(st.panels.map(p => p.k), st.vis, st.panels.some(p => p.scenario))
        for (const p of st.panels) {
          const m = findMap(p.k)
          if (!m) throw new Error(`${p.label} haritası bulunamadı`)
          const b = L.panels[pi++]
          setExpBusy(`${p.label}: ${b.w}×${b.h} px çiziliyor…`)
          caps.push({ cap: await captureMap(m, b.w, b.h), label: p.label })
          const C = R.current
          if (st.vis.heat && C.heat?.available) {
            const h = p.scenario && C.scenarioSim?.available ? heatLegend('sim', null, C.scenarioSim, C.simView, C.simMode, 'senaryo')
              : p.k === 'proje' && C.projeSim?.available ? heatLegend('sim', null, C.projeSim, C.simView, C.simMode, 'proje') : heatLegend('obs', C.heat, null, C.simView, C.simMode, '')
            if (h) heats.push(h)
          }
        }
      }
      const C = R.current
      const stateLabels = stateLabelsNow()   // read after the views were prepared, when every panel's state is computed
      const visF = steps[steps.length - 1].vis
      spec.legend = o.showLegend ? buildLegend(visF, heats, panels.some(p => p.scenario)) : null
      if (spec.legend && !spec.legend.length) spec.legend = null
      const mpp = caps[0].cap.mPerPx
      spec.meta = o.showMeta ? [...buildMeta({ visible: visF, layers: C.layers, time, sun: C.stateK[panels[0].k]?.sun ?? null, stateLabels, heats,
        traffic: C.traffic ? { live: C.traffic.live, date: C.traffic.date } : null, weather: C.wAt, pitch: caps[0].cap.pitch }),
        `Çıktı: ${L.W}×${L.H} px, ${o.format.toUpperCase()}; harita panel(ler)i ${L.panels[0].w}×${L.panels[0].h} px${mpp ? `, merkezde ≈${mpp.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} m/piksel` : ''}.`] : null
      spec.desc = o.showDesc ? buildDesc(o.kind, panels.some(p => p.scenario) ? res : null, stateLabels) : null
      setExpBusy('Görsel birleştiriliyor ve kodlanıyor…')
      const { blob, W, H } = await composeFigure(spec, caps, L)
      const name = fileName(o.kind + (o.preset !== 'asis' ? `-${o.preset}` : ''), panels.map(p => (p.scenario ? `senaryo-${scName}` : p.k)).join('-vs-'), time, W, H, o.format)
      download(blob, name)
      setExpDone(`İndirildi: ${name} (${(blob.size / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB)`)
    } catch (e: any) {
      setExpErr(`Dışa aktarma başarısız: ${e?.message ?? e}. Daha düşük çözünürlük veya JPEG deneyin.`)
    } finally {
      setView(S0.view); setVisible(S0.visible)
      exportingRef.current = false
      setExpBusy('')
    }
  }

  const scenarioMatches = !!result && result.scenario.scenario_name === def.scenario_name && result.scenario.interventions.length === def.interventions.length

  if (booting) return landing ? <Landing onOpen={openModule} ready={false} />
    : <div className="boot"><img src="brand/mark.png" alt="" width="56" height="56" /><b>Dijital İkiz ve Kentsel Analiz Platformu</b>
      <span>{booting}</span><div className="boot-bar"><i /></div><small>Geliştirici: Transheat Twin</small></div>

  const toggleLayer = (id: string, on?: boolean) => setVisible(v => ({ ...v, [id]: on ?? !v[id] }))
  const legendHeats = (!visible.heat || !heat?.available ? [] : keys.map(k => {
    const sc = !!result && result.scenario.base === k && !!visible.scenario
    return sc && scenarioSim?.available ? heatLegend('sim', null, scenarioSim, simView, simMode, 'senaryo')
      : k === 'proje' && projeSim?.available ? heatLegend('sim', null, projeSim, simView, simMode, 'proje') : heatLegend('obs', heat, null, simView, simMode, '')
  })).filter((h): h is HeatLegend => !!h)
  const dateLabel = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
  const ICON = {
    split: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg>,
    walk: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="13" cy="4" r="2" /><path d="M9 21l2-6 3 3v3M7 12l3-4 4 2 2 4" /></svg>,
    dl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
    clock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
    sun: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
    moon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  }
  const openExport = () => { setExpErr(''); setExpDone(''); setExportOpen(true) }
  const toggle3D = () => { setWalk(false); setThreeD(walk ? true : !threeD) }
  const toggleWalk = () => { setWalk(!walk); if (!walk) setThreeD(true) }
  const startDraw = () => { setDrawingFor(null); setDrawMode('polygon') }

  return <div className="app">
    {landing && <Landing onOpen={openModule} ready />}
    <header className="topbar">
      <button className="brand-mark" onClick={() => setLanding(true)} title="Tanıtım ekranı"><img src="brand/mark.png" alt="Transheat Twin" width="32" height="32" /></button>
      <div className="brand"><b>Dijital İkiz ve Kentsel Analiz Platformu</b><span>Kadıköy Meydanı Ulaşım ve Kentsel Isı Dijital İkizi</span>
        <span className="dev">Geliştirici: Transheat Twin</span></div>
      <nav className="tabs" aria-label="Sayfalar">
        {([['map', 'Harita ve senaryo'], ['compare', 'Karşılaştırma'], ['lit', 'Literatür ve varsayımlar'], ['catalog', 'Veri kataloğu'], ['report', 'Rapor'], ['help', 'Yardım']] as [Tab, string][])
          .map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <div className="spacer" />
      {tab === 'map' && <div className="tools">
        <div className="seg">
          <button className={view === 'mevcut' ? 'on' : ''} onClick={() => setView('mevcut')}>Mevcut</button>
          <button className={view === 'proje' ? 'on' : ''} onClick={() => setView('proje')}>Proje</button>
          <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')} title="Bölünmüş ekran: solda mevcut, sağda proje">{ICON.split}<span>Split Screen</span></button>
        </div>
        <button className={`btn ibtn ${threeD && !walk ? 'on' : ''}`} onClick={toggle3D} aria-pressed={threeD && !walk}>3B</button>
        <button className={`btn ibtn ${walk ? 'on' : ''}`} onClick={toggleWalk} aria-pressed={walk}
          title="Göz hizasından (1,7 m) sokak görünümü; Split Screen'de iki durum aynı noktadan görünür">{ICON.walk}Yaya gözü</button>
        <button className="btn ibtn icon-btn" onClick={openExport} title="Görseli dışa aktar (yüksek çözünürlüklü PNG/JPEG)" aria-label="Görseli dışa aktar">{ICON.dl}</button>
      </div>}
      <div className="timebar clock" title="Gölge ve güneş bu tarih ve saate göre hesaplanır (İstanbul saati)">
        <span className="clock-ic">{ICON.clock}</span>
        <label className="clock-date"><span className="clock-d" aria-hidden="true">{dateLabel}</span>
          <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Tarih" /></label>
        <input type="range" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} aria-label="Saat" />
        <span className="t">{hhmm}</span>
        {live ? <span className="live-pill" title="Gölge İstanbul saatine göre her dakika güncellenir. Tarih veya saati değiştirince durur.">canlı</span>
          : <button className="btn small" onClick={goLive} title="Gerçek tarih ve saate dön, canlı takip et">Şimdi</button>}
        {!sunUp && <span className="small muted" title="Güneş ufkun altında; gölge göstergeleri anlamlı değildir">gece</span>}
        <select value={PRESETS.find(p => p[0] === date) ? date : ''} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Hazır tarih">
          <option value="">Mevsim…</option>{PRESETS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
      </div>
      <div className="theme" role="group" aria-label="Tema">
        <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')} aria-label="Aydınlık mod" aria-pressed={theme === 'light'} title="Aydınlık mod">{ICON.sun}</button>
        <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')} aria-label="Karanlık mod" aria-pressed={theme === 'dark'} title="Karanlık mod">{ICON.moon}</button>
      </div>
    </header>

    {tab === 'map' && <div className="workspace">
      <aside className={`side left ${panels.left ? '' : 'closed'}`} style={{ width: panels.left ? panels.lw : 0 }} inert={!panels.left}>
        <div className="phead"><span>Senaryo ve katmanlar</span>
          <button className="btn small icon-btn" onClick={() => setPanels({ left: false })} aria-label="Sol paneli kapat" title="Paneli kapat">‹</button></div>
        <div className="scroll">
          <ScenarioPanel def={def} setDef={setDef} selection={selection} drawingFor={drawingFor}
            onDraw={(m, i) => { setDrawMode(m); setDrawingFor(i) }} onSelectDraw={startDraw} onClearSelection={() => setSelection(null)} />
          <LayerPanel visible={visible} setVisible={setVisible} uploads={uploads} meta={meta} />
          <DemandPanel date={date} setDate={setDate} hour={hour} weather={weather} />
          <Acc id="left.tools" title="Analiz araçları" icon="tools">
            <div className="btns">
              <button className="btn small" onClick={startDraw}>Alan çiz ve incele</button>
              <button className={`btn small ${threeD && !walk ? 'primary' : ''}`} onClick={toggle3D}>3B görünüm</button>
              <button className={`btn small ${walk ? 'primary' : ''}`} onClick={toggleWalk}>Yaya gözü</button>
              <button className="btn small" onClick={openExport}>Görsel dışa aktar</button>
            </div>
            {busLines.length > 0 && <div className="field">
              <label htmlFor="bus-line">İETT hattını göster ({busLines.length} hat)</label>
              <select id="bus-line" value={busLine ?? ''} onChange={e => { const l = e.target.value || null; setBusLine(l); if (l) setVisible(v => ({ ...v, iett_stops: true })) }}>
                <option value="">Hat seçin…</option>
                {busLines.map(l => <option key={l.kod} value={l.kod}>{l.kod} · {l.ad}</option>)}
              </select>
              {busLine && <div className="small"><span className="swatch" style={{ background: '#2a78d6', display: 'inline-block' }} /> gidiş{' '}
                <span className="swatch" style={{ background: '#d55181', display: 'inline-block', marginLeft: 8 }} /> dönüş · uğramayan duraklar soluk
                {' '}<button className="how" onClick={() => setBusLine(null)}>temizle</button></div>}
              {busLine && busLineLive && <div className="small" style={{ marginTop: 4 }}>
                <b>Canlı geçiş süresi</b> <span className="muted">(İBB {busLineLive.time}{busLineLive.live ? '' : ', anlık görüntü'}; çalışma alanının 1,5 km çevresi)</span>
                {busLineLive.dirs.map((d, i) => <div key={i}>{d.dir || 'Yön'}: {d.minutes != null ? <><b>{d.minutes.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} dk</b> · {(d.covered / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km{d.meanSpeed != null ? `, ort. ${Math.round(d.meanSpeed)} km/sa` : ''}{d.covered < d.total * 0.9 ? ` (güzergâhın %${Math.round((100 * d.covered) / d.total)}'inde hız verisi var)` : ''}</> : 'bu kesimde canlı hız verisi yok'}</div>)}
                <div className="muted">Yol parçası hızlarından hesaplanır; durakta bekleme dahil değildir.</div>
              </div>}
            </div>}
          </Acc>
        </div>
        <RunBar def={def} onRun={run} onSave={save} running={running} hasResult={scenarioMatches} />
      </aside>
      {panels.left && <Resizer side="left" width={panels.lw} set={w => setPanels({ lw: w })} />}
      <main className={`mapwrap ${view === 'split' ? 'swipe' : ''} ${visible.peds ? 'has-tl' : ''}`} id="mapwrap" ref={wrapRef}>
        {view === 'split' ? <>
          {mapFor('mevcut', true)}
          <div className="map-layer top" style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${swipe}%)` }}>{mapFor('proje', false)}</div>
          <SwipeBar value={swipe} onChange={setSwipe} />
        </> : mapFor(view, true)}
        <button className="edge l" onClick={() => setPanels({ left: !panels.left })} aria-label={panels.left ? 'Sol paneli kapat' : 'Sol paneli aç'} title={panels.left ? 'Sol paneli kapat' : 'Senaryo ve katmanlar'}>{panels.left ? '‹' : '›'}</button>
        <button className="edge r" onClick={() => setPanels({ right: !panels.right })} aria-label={panels.right ? 'Sağ paneli kapat' : 'Sağ paneli aç'} title={panels.right ? 'Sağ paneli kapat' : 'Analiz'}>{panels.right ? '›' : '‹'}</button>
        {drawMode ? <div className="drawbar"><span className="small">{drawMode === 'polygon' ? 'Alanı çizin: köşe eklemek için tıklayın, ilk noktaya tıklayarak kapatın.' : drawMode === 'linestring' ? 'Güzergâhı çizin; son noktaya tekrar tıklayarak bitirin.' : 'Noktayı yerleştirin.'}</span>
          <button className="btn small" onClick={() => { setDrawMode(null); setDrawingFor(null) }}>İptal</button></div>
          : <div className="drawbar">
            <button className="btn small" onClick={startDraw}>Alan seç (çiz)</button>
            {result && <button className="btn small" onClick={() => { setVisible(v => ({ ...v, scenario: true })); setFocus({ ...(result.geoms.analysis_area as GeoJSON.Feature).geometry }) }}>Etkilenen alanları göster</button>}
          </div>}
        <MapLegend visible={visible} heats={legendHeats} scenarioOn={!!result} busLine={busLine} raised={!!visible.peds} />
        {visible.peds && <SimTimeline onClose={() => toggleLayer('peds', false)} />}
      </main>
      {panels.right && <Resizer side="right" width={panels.rw} set={w => setPanels({ rw: w })} />}
      <aside className={`side right ${panels.right ? '' : 'closed'}`} style={{ width: panels.right ? panels.rw : 0 }} inert={!panels.right}>
        <div className="phead"><span>Analiz</span>
          <button className="btn small icon-btn" onClick={() => setPanels({ right: false })} aria-label="Sağ paneli kapat" title="Paneli kapat">›</button></div>
        <div className="scroll">
          {!result && !hintClosed && <div className="hint info small">İlk kez mi kullanıyorsunuz? Haritada gri bir alana tıklayıp <b>Ağaç ekle</b>'yi seçin, sonra <b>Senaryoyu Çalıştır</b>.
            Ayrıntılar için <button className="how" onClick={() => setTab('help')}>Yardım</button>. <button className="how" onClick={() => setHintClosed(true)}>kapat</button></div>}
          {err && <div className="note hint">{err} <button className="how" onClick={() => setErr('')}>kapat</button></div>}
          {msg && <div className="info hint">{msg} <button className="how" onClick={() => setMsg('')}>kapat</button></div>}
          <AnalysisPanel keys={keys} stateK={stateK} stateAt={stateAt} time={time} profile={profile} heat={heat} onExplain={ex.open}
            weather={weather} wAt={wAt} weatherErr={weatherErr} weatherBusy={weatherBusy} weatherOk={weatherOk} retryWeather={() => setWxTick(t => t + 1)}
            air={air} airErr={airErr} airBusy={airBusy} airOk={airOk} retryAir={() => setAirTick(t => t + 1)} airCurrent={live && isToday}
            traffic={traffic} trafficSegs={trafficSegs} trafficOk={trafficOk} retryTraffic={() => setTrafficTick(t => t + 1)}
            visible={visible} toggle={toggleLayer} hasResult={!!result} resultName={result?.scenario.scenario_name ?? null}
            goSplit={() => setView('split')} goCompare={() => setTab('compare')}
            weatherNode={<WeatherInfo w={weather} at={wAt} time={time} err={weatherErr} loading={weatherBusy} />}
            airNode={<AirQualityInfo a={air} time={time} useCurrent={live && isToday} err={airErr} loading={airBusy} />}
            heatSimNode={result && scenarioSim?.available ? <HeatSimPanel sim={scenarioSim} mode={simMode} view={simView} setMode={setSimMode} setView={setSimView}
              title={`Senaryo: ${result.scenario.scenario_name}`} layerOn={!!visible.heat} onShowLayer={() => toggleLayer('heat', true)} />
              : !result && view !== 'mevcut' && projeSim?.available ? <HeatSimPanel sim={projeSim} mode={simMode} view={simView} setMode={setSimMode} setView={setSimView}
                title="Proje durumu" layerOn={!!visible.heat} onShowLayer={() => toggleLayer('heat', true)} /> : null}
            trafficNode={traffic && trafficSegs ? <TrafficInfo st={traffic} segs={trafficSegs} onRefresh={() => setTrafficTick(t => t + 1)} /> : null}
            scenarioTrafficNode={result ? <ScenarioTraffic a={areaInfo} live={!!traffic?.live} /> : null}
            comfortNode={visible.comfort ? <ComfortPanel prof={comfort} other={comfortOther} loading={comfortBusy} hour={hour} setHour={setHour} weather={weather}
              sel={comfortSel} setSel={i => { setComfortSel(i); setComfortFocus(null) }}
              onShow={s => { setComfortFocus(s); setFocus({ type: 'LineString', coordinates: s.c.map(([x, y]) => toLL(x, y)) }) }}
              onTry={(s, q) => tryShade(s, `${q.from} → ${q.to}`)} exposure={exposure} /> : null}
            pedNode={visible.peds ? <PedSimPanel time={time} viewKey={view} weather={weather}
              getMaps={() => maps.current.filter(m => (m.getContainer() as HTMLElement).isConnected)}
              targetFor={k => (result && result.scenario.base === k && visible.scenario ? result.scenario : k)}
              scenario={result ? result.scenario : null} baseLabel={k => (k === 'mevcut' ? 'Mevcut durum' : 'Proje durumu')} /> : null}
            scenarioNode={result ? <ScenarioResultPanel r={result} onExplain={ex.open}
              onShow={() => { setVisible(v => ({ ...v, scenario: true })); setFocus({ ...(result.geoms.analysis_area as GeoJSON.Feature).geometry }) }} onClose={() => setResult(null)} /> : null} />
        </div>
      </aside>
    </div>}
    {tab === 'compare' && <ComparePage time={time} />}
    {tab === 'lit' && <LiteraturePage />}
    {tab === 'catalog' && <CatalogPage layers={layers} reload={reloadLayers} />}
    {tab === 'report' && <ReportPage />}
    {tab === 'help' && <HelpPage goMap={() => setTab('map')} />}
    <ExplainModal k={ex.k} onClose={ex.close} sources={lit?.sources} />
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} onExport={runExport} busy={expBusy} error={expErr} done={expDone}
      hasResult={!!result} scenarioName={result?.scenario.scenario_name ?? null} />}
  </div>
}
