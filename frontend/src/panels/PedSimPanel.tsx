import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import { api } from '../api'
import Chart from '../components/Chart'
import { Acc } from '../components/Acc'
import { DEFAULT_PARAMS, ZONES, endTime, ferryArrivals, hourlyDemand, hourlyStats, metrics, positions, schedule, scheduleDynamic,
  type Agent, type Demand, type DynamicPlan, type HourStats, type PedMetrics, type PedNet, type PedParams, type Ridership } from '../engine/pedsim'
import { FLOWS, flowDemand, type FerryData } from '../engine/demand'
import type { ScenarioDef } from '../types'
import type { Weather } from '../engine/weather'
import { ped, simClock as clock, useCfg, usePed } from '../engine/pedctl'
import { loadRidership, rainHours } from './DemandPanel'

type Key = 'mevcut' | 'proje'
type Target = Key | ScenarioDef
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const n0 = (x: number) => Math.round(x).toLocaleString('tr-TR')
const n1 = (x: number) => x.toLocaleString('tr-TR', { maximumFractionDigits: 1 })
const n2 = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const HH = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
let ferryP: Promise<FerryData | null> | null = null
const loadFerry = () => (ferryP ??= fetch('data/ferry_kadikoy.json').then(r => r.json()).catch(() => null))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function Num({ label, value, set, min, max, step = 1, unit }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; unit: string }) {
  return <label className="ped-num">{label}<span><input type="number" value={value} min={min} max={max} step={step}
    onChange={e => { const v = Number(e.target.value); if (isFinite(v)) set(Math.max(min, Math.min(max, v))) }} /> {unit}</span></label>
}

export default function PedSimPanel({ getMaps, targetFor, time, scenario, baseLabel, viewKey, weather }: {
  getMaps: () => MLMap[]; targetFor: (k: Key) => Target; time: string; scenario: ScenarioDef | null; baseLabel: (k: Key) => string; viewKey: string; weather: Weather | null
}) {
  // parameters persist per viewer (browser storage); missing keys fall back to the defaults
  const [P, setP] = useState<PedParams>(() => { try { return { ...DEFAULT_PARAMS, ...JSON.parse(localStorage.getItem('transheat.pedsim') || '{}') } } catch { return DEFAULT_PARAMS } })
  useEffect(() => { try { localStorage.setItem('transheat.pedsim', JSON.stringify(P)) } catch { /* storage unavailable */ } }, [P])
  const cfg = useCfg()
  const [rid, setRid] = useState<Ridership | null>(null)
  const [ferry, setFerry] = useState<FerryData | null>(null)
  useEffect(() => { loadRidership().then(setRid); loadFerry().then(setFerry) }, [])
  const date = time.slice(0, 10), hour = Number(time.slice(11, 13)), month = Number(time.slice(5, 7))
  const dyn = cfg.model === 'dynamic' && !!rid
  const [startH, endH] = dyn ? (cfg.window === 'range' ? [cfg.startHour, cfg.endHour] : [hour, hour + 1]) : [hour, hour + 1]
  const rain = rainHours(weather, date)
  const rainKey = rain.join()
  const D: Demand | null = useMemo(() => (rid ? { ...hourlyDemand(rid, month), startHour: Number(time.slice(11, 13)) + Number(time.slice(14, 16)) / 60, month, transfer: rid.transfer ?? null } : null), [rid, month, time])
  const ibb = P.demand === 'ibb' && !!D
  const startLabel = dyn ? `${date}T${HH(startH)}` : time
  const hourTime = (h: number) => (dyn ? `${date}T${HH(h)}` : time)

  // shade networks per map state and hour (dynamic: one per simulated hour, loaded progressively; simple: the selected time)
  const netsRef = useRef<Partial<Record<Key, Record<number, PedNet>>>>({})
  const [geo, setGeo] = useState<{ k: Key; net: PedNet } | null>(null)
  const [loaded, setLoaded] = useState('')
  const { running } = usePed()
  const [stat, setStat] = useState({ t: 0, walking: 0, inSun: 0, nearPier: 0, nearMetro: 0, waitPier: 0, waitStop: 0, zone: [0, 0, 0, 0, 0, 0] })
  const [cmp, setCmp] = useState<{ label: string; m: PedMetrics }[] | null>(null)
  const [cmpBusy, setCmpBusy] = useState('')
  const [cmpWanted, setCmpWanted] = useState(false)
  const [busy, setBusy] = useState('Ağ hazırlanıyor…')
  const [area, setArea] = useState<number[] | null>(null)
  useEffect(() => { api.pedZones().then(setArea).catch(() => setArea(null)) }, [])

  const mapKeys = () => getMaps().map(m => (m.getContainer() as HTMLElement).dataset.state as Key).filter(Boolean)
  const tKey = (k: Key) => JSON.stringify(targetFor(k))
  const targetsKey = (['mevcut', 'proje'] as Key[]).map(tKey).join('|')
  const hoursKey = dyn ? `${date}|${startH}|${endH}` : time

  useEffect(() => {
    let stop = false
    setBusy('Yürüme ağı ve gölge hazırlanıyor…'); setGeo(null); netsRef.current = {}
    const want = viewKey === 'split' ? 2 : 1
    const ready = async () => {
      for (let i = 0; i < 100 && !stop; i++) {
        const ms = getMaps()
        if (ms.length >= want && ms.every(m => m.loaded() && !!m.getSource('peds'))) return [...new Set(mapKeys())]
        await sleep(200)
      }
      return [...new Set(mapKeys())]
    }
    ;(async () => {
      const keys = await ready()
      const first = await Promise.all(keys.map(k => api.pedNet(targetFor(k), hourTime(startH)).then(n => [k, n] as const)))
      if (stop) return
      netsRef.current = Object.fromEntries(first.map(([k, n]) => [k, { [startH]: n }]))
      setGeo({ k: first[0][0], net: first[0][1] }); setBusy(''); ped.t = 0
      if (!dyn || endH - startH <= 1) { setLoaded(''); return }
      // remaining hours one by one (the shadow of each hour); the simulation runs meanwhile with the nearest loaded hour
      for (let h = startH + 1; h < endH && !stop; h++) {
        setLoaded(`gölge ${HH(h)} hazırlanıyor (${h - startH + 1}/${endH - startH})`)
        await sleep(30)
        for (const k of keys) { const n = await api.pedNet(targetFor(k), hourTime(h)); if (stop) return; netsRef.current[k]![h] = n }
      }
      if (!stop) setLoaded('')
    })().catch(e => setBusy(`Hata: ${e?.message ?? e}`))
    return () => { stop = true }
  }, [hoursKey, targetsKey, viewKey, dyn])

  const netAt = (k: Key, t: number) => {
    const m = netsRef.current[k]; if (!m) return null
    const h = Math.min(endH - 1, startH + Math.floor(t / 3600))
    if (m[h]) return m[h]
    for (let d = 1; d < 24; d++) { if (m[h - d]) return m[h - d]; if (m[h + d]) return m[h + d] }
    return null
  }

  const plan: DynamicPlan | null = useMemo(() => (geo && dyn ? scheduleDynamic(geo.net, P, cfg, rid, ferry, date, rain, startH, endH) : null),
    [geo, dyn, P, cfg, rid, ferry, date, rainKey, startH, endH])
  const agents: Agent[] = useMemo(() => (plan ? plan.agents : geo ? schedule(geo.net, P, D) : []), [plan, geo, P, D])
  const tEnd = useMemo(() => (plan ? (endH - startH) * 3600 : geo ? endTime(geo.net, agents) : 0), [plan, geo, agents, startH, endH])
  const ferries = useMemo(() => (plan ? plan.sailings.filter(s => s.kind === 'arr').map(s => s.t) : ferryArrivals(agents)), [plan, agents])
  const deps = useMemo(() => (plan ? plan.sailings.filter(s => s.kind === 'dep').map(s => s.t) : []), [plan])
  const label = dyn ? 'dinamik model (İBB + Şehir Hatları tarifesi)' : ibb ? 'İBB yolcu verisi' : 'varsayım talep'
  const infoRef = useRef({ ibb: ibb || dyn, windowMin: dyn ? (endH - startH) * 60 : P.windowMin, time: startLabel, busy, label })
  infoRef.current = { ibb: ibb || dyn, windowMin: dyn ? (endH - startH) * 60 : P.windowMin, time: startLabel, busy: busy || '', label }
  useEffect(() => () => ped.set({ info: null }), [])
  useEffect(() => { if (busy) ped.set({ info: { tEnd: 0, n: 0, walking: 0, inSun: 0, nearPier: 0, nearMetro: 0, ferries: [], start: startLabel, ibb: ibb || dyn, night: false, windowMin: infoRef.current.windowMin, busy, label } }) }, [busy])

  // animation: advance simulated time, draw agents on every map with that map's own sun/shade for the simulated hour
  useEffect(() => {
    if (!geo) return
    let raf = 0, last = performance.now(), lastDraw = 0, lastStat = 0
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now
      const ps = ped.get()
      if (ps.running) { ped.t += dt * ps.speed; if (ped.t > tEnd) ped.t = 0 }
      if (now - lastDraw > 100) {
        lastDraw = now
        let s = { walking: 0, inSun: 0, nearPier: 0, nearMetro: 0, waitPier: 0, waitStop: 0, zone: [0, 0, 0, 0, 0, 0] }, night = false
        for (const m of getMaps()) {
          const k = (m.getContainer() as HTMLElement).dataset.state as Key
          const net = netAt(k, ped.t); if (!net) continue
          const r = positions(net, agents, ped.t)
          ;(m.getSource('peds') as GeoJSONSource | undefined)?.setData(r.fc)
          if (k === geo.k) { s = r; night = net.night }
        }
        if (now - lastStat > 400) {
          lastStat = now; setStat({ t: ped.t, ...s })
          const I = infoRef.current
          ped.set({ info: { tEnd, n: agents.length, walking: s.walking, inSun: s.inSun, nearPier: s.nearPier, nearMetro: s.nearMetro, waitPier: s.waitPier, waitStop: s.waitStop,
            ferries, deps, start: I.time, ibb: I.ibb, night, windowMin: I.windowMin, busy: I.busy, label: I.label } })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); for (const m of getMaps()) (m.getSource('peds') as GeoJSONSource | undefined)?.setData(EMPTY) }
  }, [geo, agents, tEnd, ferries, deps])

  // hour-by-hour statistics of the window (minute sampling)
  const [hs, setHs] = useState<HourStats[] | null>(null)
  useEffect(() => {
    setHs(null)
    if (!plan || !geo || !area) return
    const id = window.setTimeout(() => setHs(hourlyStats(geo.net, plan.agents, startH, endH, area)), 80)
    return () => window.clearTimeout(id)
  }, [plan, geo, area])

  // like-for-like comparison: the same agents walking in each state (dynamic: every hour with its own shade)
  const winH = endH - startH
  const cmpAuto = !dyn || winH <= 2
  useEffect(() => { setCmpWanted(false) }, [hoursKey])
  // long windows: start at a speed that shows the day in minutes
  useEffect(() => { const sp = ped.get().speed; if (winH > 2 && sp < 60) ped.set({ speed: 300 }); if (winH <= 2 && sp > 60) ped.set({ speed: 30 }) }, [winH])
  useEffect(() => {
    let stop = false
    setCmp(null)
    if (!rid && dyn) return
    if (!cmpAuto && !cmpWanted) return
    const base = (scenario?.base ?? 'mevcut') as Key
    const jobs: [string, Target][] = [[baseLabel('mevcut'), 'mevcut'], [baseLabel('proje'), 'proje']]
    if (scenario) jobs.push([`Senaryo “${scenario.scenario_name}” (taban: ${baseLabel(base)})`, scenario])
    ;(async () => {
      const out: { label: string; m: PedMetrics }[] = []
      for (const [j, [l, t]] of jobs.entries()) {
        if (!dyn) { const net = await api.pedNet(t, time); out.push({ label: l, m: metrics(net, schedule(net, P, D)) }); continue }
        const byH: Record<number, PedNet> = {}
        for (let h = startH; h < endH && !stop; h++) {
          if (winH > 2) setCmpBusy(`${l}: ${HH(h)} (${j + 1}/${jobs.length})`)
          byH[h] = await api.pedNet(t, hourTime(h)); await sleep(10)
        }
        if (stop) return
        const pl = scheduleDynamic(byH[startH], P, cfg, rid, ferry, date, rain, startH, endH)
        out.push({ label: l, m: metrics(tt => byH[Math.min(endH - 1, startH + Math.floor(Math.max(0, tt) / 3600))] ?? null, pl.agents) })
      }
      if (!stop) { setCmp(out); setCmpBusy('') }
    })().catch(() => setCmpBusy(''))
    return () => { stop = true }
  }, [dyn ? hoursKey : time, P, D, cfg, ferry, rainKey, scenario ? JSON.stringify(scenario) : '', cmpWanted, cmpAuto])

  const sh = (o: Partial<PedParams>) => setP(p => ({ ...p, ...o }))
  const night = geo ? (netAt(geo.k, stat.t)?.night ?? false) : false
  const wd = useMemo(() => (rid ? flowDemand({ ...cfg, dayMode: 'wd' }, rid, date, rain) : null), [cfg, rid, date, rainKey])
  const we = useMemo(() => (rid ? flowDemand({ ...cfg, dayMode: 'we' }, rid, date, rain) : null), [cfg, rid, date, rainKey])
  const curZone = stat.zone

  return <div className="section pedsim">
    <h3>Yaya akışı · ajan simülasyonu</h3>
    <div className="badges"><span className="badge model">Model tabanlı sonuç</span>
      {dyn ? <><span className="badge data">İBB yolcu verisi</span><span className="badge data">Şehir Hatları tarifesi</span><span className="badge assumption">saatlik iniş, yaya hacimleri: varsayım</span></>
        : ibb ? <span className="badge data">Talep: İBB açık veri</span> : <span className="badge assumption">Talep: varsayım</span>}</div>
    {!dyn && <div className="seg ped-demand">
      <button className={!ibb ? 'on' : ''} onClick={() => sh({ demand: 'assumed' })}>Varsayım</button>
      <button className={ibb ? 'on' : ''} disabled={!D} onClick={() => sh({ demand: 'ibb' })} title={D ? '' : 'İBB verisi yüklenemedi'}>İBB yolcu verisi</button>
    </div>}
    {dyn && plan && <div className="small">{HH(startH)}–{endH === 24 ? '24:00' : HH(endH)} · {plan.kind === 'wd' ? 'hafta içi' : 'hafta sonu'} profili · pencerede <b>{n0(agents.length)}</b> yürüyüş ·
      {' '}Şehir Hatları {n0(plan.sailings.filter(s => s.op === 'sh' && s.kind === 'dep').length)} kalkış, {n0(plan.sailings.filter(s => s.op === 'sh' && s.kind === 'arr').length)} varış
      <span className="muted"> (zamansal talep ayarları sol panelde)</span></div>}
    {!dyn && ibb && D && <div className="small" style={{ margin: '4px 0' }}>
      {clock(time, 0).slice(0, 2)}:00–{String((Number(time.slice(11, 13)) + 1) % 24).padStart(2, '0')}:00 arası Kadıköy'de binen: iskeleler <b>{n0(D.iskele[Number(time.slice(11, 13))])}</b>, M4 <b>{n0(D.metro[Number(time.slice(11, 13))])}</b> kişi/sa
      <span className="muted"> ({rid!.year} {month}. ay günlük ortalaması × Eylül 2024 saatlik dağılımı)</span>. {P.transferFromData && D.transfer
        ? <>Aktarmaya yürüyen pay İBB verisinden: iskele <b>%{n1(D.transfer.iskele)}</b>, M4 <b>%{n1(D.transfer.metro)}</b> (İstanbulkart aktarmalı biniş, Eylül 2024)</>
        : <>Aktarmaya yürüyen pay: <b>%{P.transferShare}</b> (elle girilen varsayım)</>}; aynı saatte aynı sayıda yolcunun indiği varsayılır.</div>}
    {busy ? <div className="small muted">{busy}</div> : <>
      <div className="kpis">
        <div className="kpi"><div className="lbl">Hareket hâlinde</div><div className="val">{n0(stat.walking)}<small>kişi</small></div><div className="foot muted small">simülasyon saati {clock(startLabel, stat.t)}{running ? '' : ' (duraklatıldı)'}</div></div>
        <div className="kpi"><div className="lbl">Güneşte yürüyen</div><div className="val" style={{ color: night ? undefined : 'var(--sun)' }}>{night ? '—' : <>{n0(stat.inSun)}<small>kişi</small></>}</div>
          <div className="foot muted small">{night ? 'gece' : stat.walking ? `%${n0((100 * stat.inSun) / stat.walking)}` : '—'}</div></div>
        {dyn && <div className="kpi"><div className="lbl">İskelede bekleyen</div><div className="val">{n0(stat.waitPier)}<small>kişi</small></div><div className="foot muted small">kalkışı bekleyen</div></div>}
        {dyn && <div className="kpi"><div className="lbl">Durakta bekleyen</div><div className="val">{n0(stat.waitStop)}<small>kişi</small></div><div className="foot muted small">otobüs ve dolmuş durakları</div></div>}
        <div className="kpi"><div className="lbl">İskele çevresinde</div><div className="val">{n0(stat.nearPier)}<small>kişi</small></div><div className="foot muted small">{dyn ? 'A bölgesi (≤ 35 m)' : 'iskeleye ≤ 50 m yürüyen'}</div></div>
        <div className="kpi"><div className="lbl">M4 çevresinde</div><div className="val">{n0(stat.nearMetro)}<small>kişi</small></div><div className="foot muted small">{dyn ? 'C bölgesi (≤ 25 m)' : 'M4 yapısına ≤ 50 m yürüyen'}</div></div>
      </div>
      {loaded && <div className="small muted">{loaded}</div>}
      <div className="small muted">Oynat, duraklat, hız ve zaman: haritanın altındaki zaman çizelgesi.</div>
      <div className="small ped-legend"><i style={{ background: '#f2a33a' }} />güneşte <i style={{ background: '#0b5f66' }} />gölgede <i style={{ background: '#8a96a0' }} />gece{dyn && <> <i style={{ background: '#3b6fb6' }} />bekleyen</>} · {n0(agents.length)} yürüyüş</div>
    </>}

    {dyn && area && <Acc sub id="right.peds.zones" title="Bölgesel yoğunluk (şu an)">
      <table className="t air-t"><thead><tr><th>Bölge</th><th className="num">Kişi</th><th className="num">Yürünebilir alan</th><th className="num">kişi/100 m²</th></tr></thead>
        <tbody>{ZONES.map(z => <tr key={z.id}><td>{z.label}</td><td className="num">{n0(curZone[z.id])}</td><td className="num">{n0(area[z.id])} m²</td>
          <td className="num">{area[z.id] ? n2((100 * curZone[z.id]) / area[z.id]) : '—'}</td></tr>)}</tbody></table>
      <div className="small muted">Her yaya bulunduğu konuma göre tek bir bölgede sayılır (öncelik A › C › D › E › B). Alan: bölgedeki yürünebilir zemin (2 m ızgara, bina hariç). Marmaray çalışma alanında durmaz.</div>
    </Acc>}

    {dyn && plan && <Acc sub id="right.peds.hourly" title="Saatlik sonuçlar">
      {!hs ? <div className="small muted">Hesaplanıyor…</div> : <div className="tablewrap"><table className="t air-t hourly-t"><thead><tr>
        <th>Saat</th><th className="num" title="Saat içinde başlayan yürüyüşler">Üretilen</th><th className="num">İskeleden çıkan</th><th className="num">İskeleye gelen</th>
        <th className="num">Otobüs/dolmuş aktarma</th><th className="num">M4 aktarma</th><th className="num" title="ortalama / en yüksek">Durakta bekleyen</th>
        <th className="num" title="en yüksek">İskelede bekleyen</th><th className="num" title="ortalama / en yüksek">Hareket hâlinde</th><th>En yoğun bölge (kişi/100 m²)</th></tr></thead>
        <tbody>{hs.map(x => { const H = plan.hours[x.h % 24]
          return <tr key={x.h}><td>{HH(x.h)}</td><td className="num">{n0(H.generated)}</td><td className="num">{n0(H.pierOut)}</td><td className="num">{n0(H.pierIn)}</td>
            <td className="num">{n0(H.busTransfer)}</td><td className="num">{n0(H.metroTransfer)}</td><td className="num">{n0(x.waitStopAvg)} / {n0(x.waitStopMax)}</td>
            <td className="num">{n0(x.waitPierMax)}</td><td className="num">{n0(x.walkAvg)} / {n0(x.walkMax)}</td>
            <td>{ZONES.find(z => z.id === x.densZone)!.key} · {n2(100 * x.densMax[x.densZone])}</td></tr> })}</tbody></table></div>}
      <div className="small muted">“Üretilen” bir yolculuktur (her yolcu bir kez); “hareket hâlinde” aynı anda yürüyen kişi sayısıdır. Bekleyenler ve bölge yoğunluğu dakikalık örneklemeyle bulunur. M4’e inen yolcuların peronda beklemesi yer altında olduğu için sayılmaz.</div>
    </Acc>}

    {dyn && plan && wd && we && <Acc sub id="right.peds.charts" title="Günlük ve hafta içi / hafta sonu grafikleri">
      <div className="small"><b>Gün boyu üretilen yolculuk</b> ({plan.kind === 'wd' ? 'hafta içi' : 'hafta sonu'}, saat başına)</div>
      <Chart height={180} option={t => ({
        grid: { left: 40, right: 8, top: 26, bottom: 22 }, legend: { top: 0, textStyle: { color: t.ink2, fontSize: 10 }, itemWidth: 10, itemHeight: 8, type: 'scroll' },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: plan.hours.map(h => String(h.h).padStart(2, '0')), axisLabel: { color: t.ink2, fontSize: 10, interval: 2 } },
        yAxis: { type: 'value', axisLabel: { color: t.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: t.grid } } },
        series: FLOWS.map((f, i) => ({ name: f.label, type: 'bar' as const, stack: 'g', itemStyle: { color: t.series[i % t.series.length] }, data: plan.hours.map(h => h.byFlow[f.id]) })),
      })} />
      <div className="small"><b>Hafta içi ve hafta sonu talebi</b> (tüm akışlar, kişi/sa)</div>
      <Chart height={160} option={t => ({
        grid: { left: 40, right: 8, top: 22, bottom: 22 }, legend: { top: 0, textStyle: { color: t.ink2, fontSize: 10 }, itemWidth: 12 },
        tooltip: { trigger: 'axis', valueFormatter: (v: any) => n0(Number(v)) },
        xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), axisLabel: { color: t.ink2, fontSize: 10, interval: 2 } },
        yAxis: { type: 'value', axisLabel: { color: t.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: t.grid } } },
        series: [['Hafta içi', wd], ['Hafta sonu', we]].map(([n, d]: any, i) => ({ name: n, type: 'line' as const, smooth: true, symbolSize: 4, itemStyle: { color: t.series[i] },
          data: Array.from({ length: 24 }, (_, h) => Math.round(d.rows.filter((r: any) => r.h === h).reduce((s: number, r: any) => s + r.n, 0))) })),
      })} />
      <table className="t air-t"><thead><tr><th>Günlük toplam</th><th className="num">Hafta içi</th><th className="num">Hafta sonu</th></tr></thead>
        <tbody>{FLOWS.map(f => <tr key={f.id}><td>{f.label}</td>{[wd, we].map((d, i) => <td key={i} className="num">{n0(d.rows.filter(r => r.flow === f.id).reduce((s, r) => s + r.n, 0))}</td>)}</tr>)}
          <tr><td><b>Toplam</b></td>{[wd, we].map((d, i) => <td key={i} className="num"><b>{n0(d.rows.reduce((s, r) => s + r.n, 0))}</b></td>)}</tr></tbody></table>
      <div className="small muted">Simülasyonda üretilen günlük toplam (bu gün): {n0(Object.values(plan.dayTotal).reduce((s, x) => s + x, 0))} yolculuk; talep tablosuyla farkı tam sayıya yuvarlamadan gelir.</div>
    </Acc>}

    {!cmp && !cmpAuto && !cmpWanted && <div className="small" style={{ marginTop: 6 }}>Aynı yolcuların mevcut, proje ve senaryoda güneş maruziyeti: {winH} saatlik pencere için her saatin gölgesi hesaplanır.
      {' '}<button className="btn small" onClick={() => setCmpWanted(true)}>Karşılaştırmayı hesapla</button></div>}
    {cmpBusy && <div className="small muted">Karşılaştırma: {cmpBusy}</div>}
    {cmp && <div style={{ marginTop: 8 }}>
      <div className="grp">Aynı yolcular, farklı durumlar ({dyn ? `${HH(startH)}–${endH === 24 ? '24:00' : HH(endH)}` : `${time.slice(11, 16)} başlangıç, ${P.windowMin} dk`})</div>
      <table className="t air-t"><thead><tr><th>Durum</th><th>Güneşte kişi-dk</th><th>Kişi başı</th><th>Güneşte pay</th></tr></thead>
        <tbody>{cmp.map(c => <tr key={c.label}><td>{c.label}</td><td>{c.m.night ? '—' : n0(c.m.sunMin)}</td><td>{c.m.night ? '—' : `${n1(c.m.meanSunMin)} dk`}</td><td>{c.m.night ? '—' : `%${n0(100 * c.m.sunShare)}`}</td></tr>)}</tbody></table>
      <div className="small muted" style={{ marginTop: 4 }}>Talep hacmindeki belirsizlik kişi-dakika değerlerini orantılı olarak etkiler; durumlar arasındaki yüzde değişim bundan çok daha az etkilenir ve karşılaştırma için daha güvenilir göstergedir.</div>
      {cmp.length > 1 && !cmp[0].m.night && <div className="small" style={{ marginTop: 4 }}>{cmp.slice(1).map(c => {
        const d = c.m.sunMin - cmp[0].m.sunMin
        if (Math.abs(d) < 1) return <div key={c.label}>{c.label}: mevcutla fark yok (bu yürüme yollarında gölge değişmiyor).</div>
        return <div key={c.label}>{c.label}: mevcuda göre güneşte yürüme <b>{d < 0 ? '−' : '+'}{n0(Math.abs(d))} kişi-dk</b> ({d < 0 ? '−' : '+'}%{n1(Math.abs(100 * d / Math.max(1, cmp[0].m.sunMin)))})</div>
      })}</div>}
    </div>}

    <details className="small" style={{ marginTop: 8 }}><summary>Yürüyüş varsayımları (değiştirilebilir)</summary>
      <div className="ped-params">
        {!dyn && <Num label="Vapur varış aralığı (her iskele)" value={P.ferryHeadway} set={v => sh({ ferryHeadway: v })} min={3} max={60} unit="dk" />}
        {(ibb || dyn) && <label className="ped-num">Aktarma payını İBB verisinden al<span><input type="checkbox" checked={P.transferFromData} onChange={e => sh({ transferFromData: e.target.checked })} /></span></label>}
        {(ibb || dyn) && !P.transferFromData && <Num label="Aktarmaya yürüyen pay (elle)" value={P.transferShare} set={v => sh({ transferShare: v })} min={0} max={100} unit="%" />}
        {!dyn && <Num label="Vapur başına inen yolcu (Varsayım modu)" value={P.ferryPax} set={v => sh({ ferryPax: v })} min={0} max={1500} step={10} unit="kişi" />}
        <Num label="Metro sefer aralığı" value={P.metroHeadway} set={v => sh({ metroHeadway: v })} min={2} max={30} unit="dk" />
        {!dyn && <Num label="Tren başına aktarmaya yürüyen (Varsayım modu)" value={P.metroPax} set={v => sh({ metroPax: v })} min={0} max={1500} step={10} unit="kişi" />}
        <Num label="İskeleden metroya" value={P.shIskele.metro} set={v => sh({ shIskele: { ...P.shIskele, metro: v } })} min={0} max={100} unit="%" />
        <Num label="İskeleden otobüse" value={P.shIskele.otobus} set={v => sh({ shIskele: { ...P.shIskele, otobus: v } })} min={0} max={100} unit="%" />
        <Num label="İskeleden dolmuşa" value={P.shIskele.minibus} set={v => sh({ shIskele: { ...P.shIskele, minibus: v } })} min={0} max={100} unit="%" />
        <Num label="Metrodan otobüse" value={P.shMetro.otobus} set={v => sh({ shMetro: { ...P.shMetro, otobus: v } })} min={0} max={100} unit="%" />
        <Num label="Metrodan dolmuşa" value={P.shMetro.minibus} set={v => sh({ shMetro: { ...P.shMetro, minibus: v } })} min={0} max={100} unit="%" />
        <Num label="Ortalama yürüme hızı" value={P.speedMean} set={v => sh({ speedMean: v })} min={0.6} max={2} step={0.05} unit="m/s" />
        {!dyn && <Num label="Simülasyon süresi" value={P.windowMin} set={v => sh({ windowMin: v })} min={10} max={180} step={10} unit="dk" />}
        <button className="btn small" onClick={() => setP(DEFAULT_PARAMS)}>Varsayılanlara dön</button>
      </div>
      {dyn ? <p><b>Dinamik model:</b> vapur kalkış ve varışları Şehir Hatları resmî tarifesinden ({ferry?.fetched ?? '—'}), iskele yolcusunun İBB payı bu seferlere, kalanı Turyol için sefer aralığı varsayımına dağıtılır. Binen yolcu kalkıştan önce iskeleye gelir ve bekler; inen yolcunun bir kısmı (İstanbulkart aktarma payı) otobüs, dolmuş veya metroya, kalanı kent bağlantılarına (çarşı, Moda, Rıhtım, sahil) yürür. Durakta bekleme sefer aralığının içinde eşit dağılımlıdır. Her saatin yürüyüşü o saatin gölgesiyle hesaplanır (bulutsuz gökyüzü). Saatlik katsayılar, hacimler ve çarpanlar sol paneldeki “Zamansal yolcu yoğunluğu” bölümünde düzenlenir.</p>
        : <>{rid && <p><b>İBB yolcu verisi modu:</b> {rid.sources.join(' · ')}. {rid.notes} Sefer aralıkları, yön payları ve iskeleler arası eşit dağılım varsayımdır.</p>}
          <p>Yolcu sayıları, sefer aralıkları ve yön payları ölçüm değil, ayarlanabilir varsayımlardır. Güneş/gölge simülasyon başlangıç saatindeki geometrik gölgeden alınır (bulutsuz gökyüzü). Karşılaştırmada her durumda aynı yolcular (aynı rastgele tohum) yürür; fark yalnızca gölgeden gelir.</p></>}
    </details>
  </div>
}
