import { useEffect, useMemo, useState } from 'react'
import Chart from '../components/Chart'
import { Acc } from '../components/Acc'
import { DEFAULT_CFG, FLOWS, GATES, SEASON_TR, coefFor, dayInfo, defaultCoef, flowDemand, type DayKind, type DemandCfg, type FlowId, type GateId, type Season } from '../engine/demand'
import { ped, useCfg } from '../engine/pedctl'
import type { Ridership } from '../engine/pedsim'
import type { Weather } from '../engine/weather'

const n0 = (x: number) => Math.round(x).toLocaleString('tr-TR')
const n2 = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const HH = (h: number) => `${String(h).padStart(2, '0')}:00`
const KIND_TR: Record<DayKind, string> = { wd: 'Hafta içi', we: 'Hafta sonu' }

let ridP: Promise<Ridership | null> | null = null
export const loadRidership = () => (ridP ??= fetch('data/ridership_kadikoy.json').then(r => r.json()).catch(() => null))

/** Rain flag per hour from the Open-Meteo hours of the selected date (null when unknown). */
export const rainHours = (w: Weather | null, date: string) => Array.from({ length: 24 }, (_, h) => {
  const x = w && w.date === date ? w.hours[h] : null
  return x ? (x.precip ?? 0) >= 0.1 : null
})

function Num({ label, value, set, min = 0, max = 1e6, step = 1, unit = '', title }: { label: string; value: number; set: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; title?: string }) {
  return <label className="ped-num" title={title}>{label}<span><input type="number" value={value} min={min} max={max} step={step}
    onChange={e => { const v = Number(e.target.value); if (isFinite(v)) set(Math.max(min, Math.min(max, v))) }} /> {unit}</span></label>
}

/** “Zamansal yolcu yoğunluğu”: date and day type, simulation window, 24 h profiles, editable coefficients and multipliers. */
export default function DemandPanel({ date, setDate, hour, weather }: { date: string; setDate: (d: string) => void; hour: number; weather: Weather | null }) {
  const cfg = useCfg()
  const set = (p: Partial<DemandCfg>) => ped.setCfg(p)
  const [rid, setRid] = useState<Ridership | null>(null)
  useEffect(() => { loadRidership().then(setRid) }, [])
  const day = dayInfo(date)
  const kind: DayKind = cfg.dayMode === 'auto' ? day.kind : cfg.dayMode
  const defs = useMemo(() => defaultCoef(rid), [rid])
  const rain = rainHours(weather, date)
  const dem = useMemo(() => flowDemand(cfg, rid, date, rain), [cfg, rid, date, rain.join()])
  const [flow, setFlow] = useState<FlowId>('iskele_inen')
  const [ek, setEk] = useState<DayKind>(kind)
  useEffect(() => setEk(kind), [kind])
  const F = FLOWS.find(f => f.id === flow)!
  const coef = coefFor(cfg, defs, flow, ek)
  const edited = !!cfg.coef[flow]?.[ek]
  const setCoef = (h: number, v: number) => {
    const next = coef.slice(); next[h] = v
    set({ coef: { ...cfg.coef, [flow]: { ...(cfg.coef[flow] ?? {}), [ek]: next } } })
  }
  const resetFlow = () => { const c = { ...cfg.coef }; if (c[flow]) { const o = { ...c[flow] }; delete o[ek]; c[flow] = o } set({ coef: c }) }
  const total = Array.from({ length: 24 }, (_, h) => dem.rows.filter(r => r.h === h).reduce((s, r) => s + r.n, 0))
  const daySum = total.reduce((s, x) => s + x, 0)
  const win = cfg.window === 'range' ? [cfg.startHour, cfg.endHour] : [hour, hour + 1]
  const csv = () => {
    const rows = [['saat', 'gun_turu', 'bolge', 'ulasim_turu', 'akis', 'katsayi', 'carpan', 'tahmini_yolcu', 'veri_kaynagi', 'varsayim_durumu']]
    for (const r of dem.rows) {
      const f = FLOWS.find(x => x.id === r.flow)!
      rows.push([HH(r.h), KIND_TR[dem.kind], f.zone, f.mode, f.label, r.coef.toFixed(3), r.mult.toFixed(3), r.n.toFixed(1),
        `hacim: ${f.volume === 'veri' ? 'İBB açık veri' : 'varsayım'}; saatlik dağılım: ${cfg.coef[r.flow]?.[dem.kind] ? 'kullanıcı' : f.profile === 'veri' ? 'İBB açık veri' : 'varsayım'}`,
        f.profile === 'veri' && f.volume === 'veri' && !cfg.coef[r.flow]?.[dem.kind] ? 'veri' : 'varsayım içerir'])
    }
    const blob = new Blob(['﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kadikoy_saatlik_talep_${date}_${dem.kind}.csv`; a.click()
  }
  return <Acc id="left.demand" title="Zamansal yolcu yoğunluğu" icon="walk" count={cfg.model === 'dynamic' ? `${KIND_TR[kind]} · ${HH(win[0]).slice(0, 2)}–${HH(win[1] % 24 === 0 && win[1] ? 24 : win[1]).slice(0, 2)}` : 'basit model'}>
    <div className="seg">
      <button className={cfg.model === 'dynamic' ? 'on' : ''} onClick={() => set({ model: 'dynamic' })}>Dinamik (24 saat)</button>
      <button className={cfg.model === 'simple' ? 'on' : ''} onClick={() => set({ model: 'simple' })}>Basit (tek pencere)</button>
    </div>
    {cfg.model === 'simple' ? <div className="small muted">Basit model: seçili saatten başlayan tek pencere, vapur başına sabit yolcu veya İBB saatlik hacmi (Yaya simülasyonu bölümündeki ayarlar).</div> : <>
      <div className="field"><label>Simülasyon tarihi</label><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></div>
      <div className="small"><b>{day.dayName}</b>{day.holiday ? <> · resmî tatil: <b>{day.holiday}</b></> : ''} · {SEASON_TR[day.season]} · okul {day.school == null ? 'takvimi bilinmiyor' : day.school ? 'dönemi' : 'tatili'}
        {' '}· tarifede <b>{day.service === 'wd' ? 'hafta içi' : day.service === 'sat' ? 'cumartesi' : 'pazar/tatil'}</b> seferleri</div>
      <div className="field"><label>Gün profili</label>
        <div className="seg">{(['auto', 'wd', 'we'] as const).map(k => <button key={k} className={cfg.dayMode === k ? 'on' : ''} onClick={() => set({ dayMode: k })}>
          {k === 'auto' ? `Otomatik (${KIND_TR[day.kind].toLowerCase()})` : KIND_TR[k]}</button>)}</div></div>
      <div className="field"><label>Simülasyon zamanı</label>
        <div className="seg">
          <button className={cfg.window === 'selected' ? 'on' : ''} onClick={() => set({ window: 'selected' })}>Seçili saat ({HH(hour)})</button>
          <button className={cfg.window === 'range' ? 'on' : ''} onClick={() => set({ window: 'range' })}>Saat aralığı</button>
        </div></div>
      {cfg.window === 'range' && <div className="row">
        <div className="field"><label>Başlangıç</label><select value={cfg.startHour} onChange={e => { const s = Number(e.target.value); set({ startHour: s, endHour: Math.max(s + 1, cfg.endHour) }) }}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{HH(h)}</option>)}</select></div>
        <div className="field"><label>Bitiş</label><select value={cfg.endHour} onChange={e => set({ endHour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => h + 1).filter(h => h > cfg.startHour).map(h => <option key={h} value={h}>{h === 24 ? '24:00' : HH(h)}</option>)}</select></div>
        <button className="btn small" style={{ flex: 'none', alignSelf: 'end', marginBottom: 2 }} onClick={() => set({ startHour: 0, endHour: 24 })}>24 saat</button>
      </div>}

      <div className="small"><b>Saatlik yolcu ve yaya talebi</b> · {KIND_TR[dem.kind].toLowerCase()} · günlük toplam <b>{n0(daySum)}</b> yolculuk</div>
      <Chart height={190} option={t => ({
        grid: { left: 44, right: 8, top: 26, bottom: 24 },
        legend: { top: 0, textStyle: { color: t.ink2, fontSize: 10 }, itemWidth: 10, itemHeight: 8, type: 'scroll' },
        tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${n0(v)} kişi/sa` },
        xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), axisLabel: { color: t.ink2, fontSize: 10, interval: 2 }, axisLine: { lineStyle: { color: t.grid } } },
        yAxis: { type: 'value', axisLabel: { color: t.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: t.grid } } },
        series: FLOWS.map((f, i) => ({ name: f.label, type: 'bar' as const, stack: 'n', barWidth: '70%', itemStyle: { color: t.series[i % t.series.length] },
          data: Array.from({ length: 24 }, (_, h) => Math.round(dem.rows.find(r => r.flow === f.id && r.h === h)!.n)),
          ...(i === 0 ? { markArea: { silent: true, itemStyle: { color: 'rgba(120,120,120,.10)' }, data: dem.kind === 'wd' ? [[{ xAxis: '07' }, { xAxis: '08' }], [{ xAxis: '17' }, { xAxis: '18' }]] : [[{ xAxis: '13' }, { xAxis: '17' }]] } } : {}) })),
      })} />
      <div className="small muted">Gri bant: {dem.kind === 'wd' ? 'sabah ve akşam pik saatleri' : 'hafta sonu öğleden sonra yoğunluğu'}. Haritadaki yaya sayısı seçilen saate göre bu talepten üretilir.</div>

      <Acc sub id="left.demand.coef" title="Saatlik katsayılar (1,00 = günlük ortalama)">
        <div className="row">
          <div className="field"><label>Akış</label><select value={flow} onChange={e => setFlow(e.target.value as FlowId)}>{FLOWS.map(f => <option key={f.id} value={f.id}>{f.zone.split('·')[0]}· {f.label}</option>)}</select></div>
          <div className="field" style={{ flex: 'none' }}><label>Gün</label><div className="seg">{(['wd', 'we'] as const).map(k => <button key={k} className={ek === k ? 'on' : ''} onClick={() => setEk(k)}>{k === 'wd' ? 'H.içi' : 'H.sonu'}</button>)}</div></div>
        </div>
        <div className="badges">{edited ? <span className="badge assumption">kullanıcı tarafından düzenlendi</span>
          : F.profile === 'veri' && rid?.profileByDay ? <span className="badge data">İBB verisi (Eylül 2024 saatlik dağılımı)</span> : <span className="badge assumption">Varsayım (başlangıç tablosu)</span>}</div>
        <Chart height={140} option={t => ({
          grid: { left: 34, right: 8, top: 20, bottom: 22 }, legend: { top: 0, textStyle: { color: t.ink2, fontSize: 10 }, itemWidth: 12 },
          tooltip: { trigger: 'axis', valueFormatter: (v: any) => n2(Number(v)) },
          xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), axisLabel: { color: t.ink2, fontSize: 10, interval: 2 } },
          yAxis: { type: 'value', axisLabel: { color: t.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: t.grid } } },
          series: (['wd', 'we'] as const).map((k, i) => ({ name: KIND_TR[k], type: 'line' as const, smooth: true, symbolSize: 4, lineStyle: { width: k === ek ? 2.5 : 1.5 }, itemStyle: { color: t.series[i] },
            data: coefFor(cfg, defs, flow, k) })),
        })} />
        <div className="coef-grid">{coef.map((c, h) => <label key={h}><span>{String(h).padStart(2, '0')}</span>
          <input type="number" step={0.05} min={0} value={c} onChange={e => { const v = Number(e.target.value); if (isFinite(v) && v >= 0) setCoef(h, v) }} /></label>)}</div>
        <div className="small muted">Ortalama {n2(coef.reduce((s, x) => s + x, 0) / 24)} · {F.note}</div>
        <div className="btns"><button className="btn small" onClick={resetFlow} disabled={!edited}>Bu profili varsayılana döndür</button>
          <button className="btn small" onClick={() => set({ coef: {} })}>Tüm katsayıları sıfırla</button></div>
      </Acc>

      <Acc sub id="left.demand.mult" title="Mevsim, tatil, hava ve etkinlik çarpanları">
        <div className="small muted">Çarpanlar her akış ve saat için bir kez uygulanır. İBB verisinden gelen hacimlere mevsim ve okul çarpanı uygulanmaz: aylık veri bu etkiyi zaten içerir.</div>
        <label className="ped-num">Mevsim çarpanlarını uygula<span><input type="checkbox" checked={cfg.seasonOn} onChange={e => set({ seasonOn: e.target.checked })} /></span></label>
        {cfg.seasonOn && <table className="t air-t"><thead><tr><th>Mevsim</th><th>Çarşı</th><th>Meydan/sahil</th></tr></thead>
          <tbody>{(Object.keys(SEASON_TR) as Season[]).map(s => <tr key={s} className={s === day.season ? 'on-row' : ''}><td>{SEASON_TR[s]}{s === day.season ? ' ●' : ''}</td>
            {(['carsi', 'sosyal'] as const).map(f => <td key={f}><input className="mini" type="number" step={0.05} min={0} value={cfg.seasonF[s][f]}
              onChange={e => set({ seasonF: { ...cfg.seasonF, [s]: { ...cfg.seasonF[s], [f]: Number(e.target.value) } } })} /></td>)}</tr>)}</tbody></table>}
        <Num label="Resmî tatil (tüm akışlar, hafta sonu profiline ek)" value={cfg.holidayF} set={v => set({ holidayF: v })} max={3} step={0.05} unit="×" />
        <Num label="Okul tatili (yalnızca varsayım akışları)" value={cfg.schoolOffF} set={v => set({ schoolOffF: v })} max={3} step={0.05} unit="×" />
        <div className="field"><label>Hava</label><div className="seg">{(['auto', 'dry', 'rain'] as const).map(k => <button key={k} className={cfg.weather === k ? 'on' : ''} onClick={() => set({ weather: k })}>
          {k === 'auto' ? 'Otomatik (Open-Meteo)' : k === 'dry' ? 'Yağışsız' : 'Yağışlı'}</button>)}</div></div>
        {cfg.weather === 'auto' && <div className="small muted">{rain.every(r => r == null) ? 'Bu tarih için saatlik yağış verisi yok: yağışsız kabul edilir.' : `Yağışlı saatler: ${rain.map((r, h) => (r ? String(h).padStart(2, '0') : null)).filter(Boolean).join(', ') || 'yok'}`}</div>}
        <Num label="Yağışta çarşı yayası" value={cfg.rainF.carsi} set={v => set({ rainF: { ...cfg.rainF, carsi: v } })} max={2} step={0.05} unit="×" />
        <Num label="Yağışta meydan/sahil yayası" value={cfg.rainF.sosyal} set={v => set({ rainF: { ...cfg.rainF, sosyal: v } })} max={2} step={0.05} unit="×" />
        <label className="ped-num">Özel etkinlik<span><input type="checkbox" checked={cfg.event.on} onChange={e => set({ event: { ...cfg.event, on: e.target.checked } })} /></span></label>
        {cfg.event.on && <>
          <div className="field"><label>Etkinlik adı</label><input value={cfg.event.name} onChange={e => set({ event: { ...cfg.event, name: e.target.value } })} /></div>
          <div className="row">
            <div className="field"><label>Başlangıç</label><select value={cfg.event.from} onChange={e => set({ event: { ...cfg.event, from: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{HH(h)}</option>)}</select></div>
            <div className="field"><label>Bitiş</label><select value={cfg.event.to} onChange={e => set({ event: { ...cfg.event, to: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => h + 1).map(h => <option key={h} value={h}>{h === 24 ? '24:00' : HH(h)}</option>)}</select></div>
          </div>
          <div className="row">
            <div className="field"><label>Etkilenen akış</label><select value={cfg.event.flows} onChange={e => set({ event: { ...cfg.event, flows: e.target.value as DemandCfg['event']['flows'] } })}>
              <option value="sosyal">Meydan/sahil yayası</option><option value="carsi">Çarşı yayası</option><option value="hepsi">Tüm akışlar</option></select></div>
            <Num label="Çarpan" value={cfg.event.factor} set={v => set({ event: { ...cfg.event, factor: v } })} max={10} step={0.1} unit="×" />
          </div>
        </>}
      </Acc>

      <Acc sub id="left.demand.vol" title="Hacim, bekleme ve yön varsayımları">
        <Num label="Çarşı yayası (ortalama gün)" value={cfg.daily.carsi} set={v => set({ daily: { ...cfg.daily, carsi: v } })} step={500} unit="kişi" />
        <Num label="Meydan/sahil yayası (ortalama gün)" value={cfg.daily.sosyal} set={v => set({ daily: { ...cfg.daily, sosyal: v } })} step={500} unit="kişi" />
        <Num label="Hafta sonu oranı: çarşı" value={cfg.weRatio.carsi} set={v => set({ weRatio: { ...cfg.weRatio, carsi: v } })} max={5} step={0.05} unit="×" />
        <Num label="Hafta sonu oranı: meydan/sahil" value={cfg.weRatio.sosyal} set={v => set({ weRatio: { ...cfg.weRatio, sosyal: v } })} max={5} step={0.05} unit="×" />
        <Num label="İskeleye geliş: kalkıştan en erken" value={cfg.accum.from} set={v => set({ accum: { ...cfg.accum, from: Math.max(v, cfg.accum.to) } })} max={60} unit="dk önce" />
        <Num label="İskeleye geliş: kalkıştan en geç" value={cfg.accum.to} set={v => set({ accum: { ...cfg.accum, to: Math.min(v, cfg.accum.from) } })} max={30} unit="dk önce" />
        <Num label="Otobüs hattı sefer aralığı (bekleme)" value={cfg.busHeadway} set={v => set({ busHeadway: v })} min={1} max={60} unit="dk" />
        <Num label="Dolmuş aralığı (bekleme)" value={cfg.minibusHeadway} set={v => set({ minibusHeadway: v })} min={1} max={30} unit="dk" />
        <Num label="Turyol sefer aralığı (tarife yok)" value={cfg.turyolHeadway} set={v => set({ turyolHeadway: v })} min={5} max={60} unit="dk" />
        <div className="small"><b>Aktarma dışı yolcuların yönü</b> (iskele ve M4 ile kent arasında, %)</div>
        {GATES.map(g => <Num key={g.id} label={g.label} value={cfg.gateShare[g.id]} set={v => set({ gateShare: { ...cfg.gateShare, [g.id as GateId]: v } })} max={100} unit="%" />)}
        <button className="btn small" onClick={() => ped.set({ cfg: { ...DEFAULT_CFG, model: cfg.model, window: cfg.window, startHour: cfg.startHour, endHour: cfg.endHour } })}>Tüm varsayımları varsayılana döndür</button>
      </Acc>

      <Acc sub id="left.demand.table" title="Saatlik talep tablosu ve kaynaklar">
        <table className="t air-t"><thead><tr><th>Akış</th><th>Bölge</th><th className="num">Günlük</th><th>Kaynak</th></tr></thead>
          <tbody>{FLOWS.map(f => { const s = dem.rows.filter(r => r.flow === f.id).reduce((a, r) => a + r.n, 0)
            return <tr key={f.id}><td>{f.label}</td><td>{f.zone}</td><td className="num">{n0(s)}</td>
              <td><span className={`badge ${f.volume === 'veri' ? 'data' : 'assumption'}`}>hacim: {f.volume === 'veri' ? 'veri' : 'varsayım'}</span>{' '}
                <span className={`badge ${f.profile === 'veri' && !cfg.coef[f.id]?.[dem.kind] ? 'data' : 'assumption'}`}>saat: {f.profile === 'veri' && !cfg.coef[f.id]?.[dem.kind] ? 'veri' : 'varsayım'}</span></td></tr> })}</tbody></table>
        <button className="btn small" onClick={csv}>Saatlik tabloyu indir (CSV)</button>
        <details className="more"><summary>Kaynaklar ve gerekçeler</summary>
          <p><b>Veri:</b> {rid?.sources.join(' · ') ?? 'İBB açık veri yüklenemedi'}. İskele yolcusunun %{n0(100 * (rid?.operatorShare?.ibb ?? 0.71))}'i İBB (Şehir Hatları) iskelelerinde; bu pay Şehir Hatları resmî tarifesindeki seferlere dağıtılır. Hafta içi/hafta sonu gün oranı: iskele {rid?.dayRatio?.iskele.wd ?? '—'} / {rid?.dayRatio?.iskele.we ?? '—'}, M4 {rid?.dayRatio?.metro.wd ?? '—'} / {rid?.dayRatio?.metro.we ?? '—'}.</p>
          <p><b>Varsayım:</b> iniş = biniş (günlük); inişlerin saatlik dağılımı başlangıç tablosundan (sabah ve akşam pikleri); çarşı ve meydan/sahil yayası hacmi ve dağılımı (yaya sayımı yok); Turyol sefer aralığı; mevsim, yağış, etkinlik çarpanları; iskelede bekleme süresi; durakta bekleme (sefer aralığının yarısı ortalama); aktarma dışı yolcuların kent bağlantılarına dağılımı. Başlangıç tablosu: 00–05 çok düşük … 07–09 ve 17–19 çok yüksek; tablo yumuşatılır ve ortalaması 1,00’e ölçeklenir.</p>
          <p><b>Tutarlılık:</b> seferi olmayan saatlerde o işletmeciden yolcu üretilmez; o saatlerin payı aynı günün seferli saatlerine dağıtılır, günlük toplam korunur. Her yolcu tek bir yolculuk olarak üretilir ve haritada aynı anda tek bir bölgede sayılır.</p>
          <p><b>Marmaray:</b> çalışma alanında Marmaray istasyonu yoktur (en yakını Söğütlüçeşme); C bölgesi M4 Kadıköy’dür.</p>
        </details>
      </Acc>
    </>}
  </Acc>
}
