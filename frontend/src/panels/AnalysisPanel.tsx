import type { ReactNode } from 'react'
import Chart from '../components/Chart'
import { Acc, Status } from '../components/Acc'
import { Badge, KpiCard, LOWER_IS_BETTER, fmt } from '../components/ui'
import { eaqiBand, sunState, WMO, type Air, type Weather, type WeatherHour } from '../engine/weather'
import { trafficSummary, type TrafficState } from '../engine/traffic'
import { HeatInfo } from './ResultPanel'
import { airAt } from './WeatherInfo'
import type { Kpi, Method, StateKpis } from '../types'

type Key = 'mevcut' | 'proje'
const LABEL: Record<Key, string> = { mevcut: 'Mevcut durum', proje: 'Proje durumu' }
const n1 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('tr-TR', { maximumFractionDigits: 1 }))
const n0 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : Math.round(x).toLocaleString('tr-TR'))
const hm = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso.slice(11, 16) : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) }
const kv = (s: StateKpis | null | undefined, id: string) => s?.kpis.find(k => k.id === id)

/** A compact KPI card for values that are not one of the engine's KPIs (weather, satellite statistics, live traffic). */
function Card({ label, value, unit, method, foot, color, wide }: { label: ReactNode; value: ReactNode; unit?: string; method?: Method; foot?: ReactNode; color?: string; wide?: boolean }) {
  return <div className={`kpi ${wide ? 'wide' : ''}`}>
    <div className="lbl">{label}</div>
    <div className="val" style={color ? { color } : undefined}>{value}{unit && <small>{unit}</small>}</div>
    {(method || foot) && <div className="foot">{method && <Badge m={method} />}{foot && <span className="muted small">{foot}</span>}</div>}
  </div>
}

/** Engine KPIs of one group as cards (with “Nasıl hesaplandı?”). */
function KpiGrid({ s, group, onExplain, skip = [] }: { s: StateKpis; group: string; onExplain: (k: Kpi) => void; skip?: string[] }) {
  const ks = s.kpis.filter(k => k.group === group && k.id !== 'alan' && !skip.includes(k.id))
  if (!ks.length) return null
  return <div className="kpis">{ks.map(k => <KpiCard key={k.id} k={k} onExplain={onExplain} better={LOWER_IS_BETTER.has(k.id) ? 'down' : 'up'} />)}</div>
}

export interface AnalysisProps {
  keys: Key[]; stateK: Partial<Record<Key, StateKpis | null>>; stateAt: Partial<Record<Key, string>>; time: string
  profile: { mevcut?: any[]; proje?: any[] }; heat: any; onExplain: (k: Kpi) => void
  weather: Weather | null; wAt: (WeatherHour & { isCurrent: boolean }) | null; weatherErr: string; weatherBusy: boolean; weatherOk: string; retryWeather: () => void
  air: Air | null; airErr: string; airBusy: boolean; airOk: string; retryAir: () => void; airCurrent: boolean
  traffic: TrafficState | null; trafficSegs: GeoJSON.FeatureCollection | null; trafficOk: string; retryTraffic: () => void
  visible: Record<string, boolean>; toggle: (id: string, on?: boolean) => void
  hasResult: boolean; resultName: string | null
  weatherNode: ReactNode; airNode: ReactNode; heatSimNode: ReactNode; trafficNode: ReactNode; scenarioTrafficNode: ReactNode
  comfortNode: ReactNode; pedNode: ReactNode; scenarioNode: ReactNode
  goSplit: () => void; goCompare: () => void
}

export default function AnalysisPanel(A: AnalysisProps) {
  const ks = A.keys.filter(k => A.stateK[k])
  const split = A.keys.length > 1
  const perKey = (f: (s: StateKpis, k: Key) => ReactNode) => ks.map(k => <div key={k} className="perkey">
    {split && <h4 className="kgrp">{LABEL[k]}</h4>}{f(A.stateK[k]!, k)}</div>)
  const s0 = A.stateK[A.keys[0]] ?? null
  const pending = !s0 && <div className="small muted">Göstergeler hesaplanıyor…</div>

  // ---- weather / air digest
  const st = A.wAt ? sunState(A.wAt.direct, A.time, A.wAt.precip) : null
  const aAt = A.air ? airAt(A.air, A.time, A.airCurrent) : null
  const band = eaqiBand(aAt?.aqi ?? null)
  const sunTxt = { sunny: 'güneş açık · gölge belirgin', cloudy: 'bulutlu · gölge zayıf', rain: 'yağışlı · gölge anlamsız', night: 'gece', unknown: 'ufka yakın' }
  const hs = A.heat?.available ? A.heat.stats : null
  const y = A.heat?.available ? A.heat.yorum : null
  const tr = A.traffic && A.trafficSegs ? trafficSummary(A.trafficSegs, A.traffic) : null
  const trSite = tr?.site
  const congested = trSite && trSite.total > 0 ? (100 * (trSite.km[4] + trSite.km[5])) / trSite.total : null

  // ---- comparison table (states computed for the selected time)
  const cols = (['mevcut', 'proje'] as Key[]).filter(k => A.stateK[k] && A.stateAt[k] === A.time)
  const ROWS = ['yesil_oran', 'sert_oran', 'agac_tac_oran', 'golge_oran', 'gunes_acik_sert_m2', 'durak_erisim', 'aktarma_ort_mesafe', 'aktarma_golge']

  return <>
    <Acc id="right.overview" title="Genel durum" icon="pulse" count={s0 ? `yeşil %${n1(kv(s0, 'yesil_oran')?.value as number)} · gölge %${n1(kv(s0, 'golge_oran')?.value as number)}` : ''}>
      {pending}
      {perKey(s => <>
        <div className="kpis">
          <Card label="Analiz alanı (kara)" value={n0(s.area_m2 || (kv(s, 'alan')?.value as number))} unit="m²" method="geometric" />
          <Card label="Güneş yüksekliği" value={n1(s.sun.elevation)} unit="°" method="geometric" foot={s.sun.elevation > 0 ? (st ? sunTxt[st] : 'güneş ufkun üstünde') : 'gece'} />
          {[kv(s, 'yesil_oran'), kv(s, 'golge_oran')].filter((k): k is Kpi => !!k).map(k => <KpiCard key={k.id} k={k} onExplain={A.onExplain} better="up" />)}
        </div>
        <details className="more"><summary>{s.label}: notlar</summary>
          {s.notes.map(n => <p key={n}>{n}</p>)}
          <p>Gölge güneş geometrisiyle (bulutsuz gökyüzü) hesaplanır; o saatteki bulutluluk “Hava ve meteoroloji” bölümündedir.</p></details>
      </>)}
    </Acc>

    <Acc id="right.weather" title="Hava ve meteoroloji" icon="sun"
      count={A.weatherErr && !A.weather ? 'alınamadı' : A.wAt ? `${A.wAt.isCurrent ? A.wAt.time.slice(11, 16) : A.time.slice(11, 13) + ':00'} · ${n1(A.wAt.temp)} °C` : A.weatherBusy ? 'alınıyor…' : ''}>
      <div className="kpis">
        <Card label={`Hava${A.wAt?.code != null ? ' · ' + (WMO[A.wAt.code] ?? '') : ''}`} value={A.wAt ? n1(A.wAt.temp) : '—'} unit={A.wAt ? '°C' : undefined}
          method={A.wAt ? 'model' : undefined} foot={A.wAt ? `hissedilen ${n1(A.wAt.app)} °C` : A.weatherBusy ? 'alınıyor…' : 'veri yok'} />
        <Card label="Hava kalitesi (AQI)" value={aAt?.aqi ?? '—'} color={band?.color} method={aAt ? 'model' : undefined}
          foot={band ? band.label : A.airBusy ? 'alınıyor…' : 'veri yok'} />
        <Card label="Yağış / bulut" value={A.wAt ? n1(A.wAt.precip) : '—'} unit={A.wAt ? 'mm' : undefined} foot={A.wAt ? `bulut %${n0(A.wAt.cloud)} · rüzgâr ${n1(A.wAt.wind)} km/sa` : ''} />
        <Card label="Veri güncelliği" value={A.wAt ? (A.wAt.isCurrent ? A.wAt.time.slice(11, 16) : A.time.slice(11, 13) + ':00') : '—'}
          foot={A.wAt ? (A.wAt.isCurrent ? '15 dk güncel değer · Open-Meteo' : 'saatlik değer · Open-Meteo') : ''} />
      </div>
      {A.weatherErr && <Status onRetry={A.retryWeather}>Hava verisi alınamadı{A.weatherOk ? ` · son başarılı: ${A.weatherOk}` : ''}{A.weather ? ' (son alınan değerler gösteriliyor)' : ''}</Status>}
      {A.airErr && <Status onRetry={A.retryAir}>Hava kalitesi alınamadı{A.airOk ? ` · son başarılı: ${A.airOk}` : ''}{A.air ? ' (son alınan değerler gösteriliyor)' : ''}</Status>}
      {A.weatherNode}
      {A.airNode}
    </Acc>

    <Acc id="right.heat" title="Kentsel ısı" icon="thermo" count={hs ? `ort. ${n1(hs.ortalama)} °C` : ''}>
      {A.heat && !A.heat.available && <div className="note">{A.heat.message}</div>}
      {hs && <>
        <div className="kpis">
          <Card label="Ortalama yüzey sıcaklığı" value={n1(hs.ortalama)} unit="°C" method="data" foot="Landsat 2025" />
          <Card label="Min / maks" value={`${n1(hs.min)} / ${n1(hs.max)}`} unit="°C" foot={`${n0(hs.piksel)} piksel`} />
          <Card label={`Sıcak nokta eşiği (%${hs.esik_p} dilim)`} value={n1(hs.esik_deger)} unit="°C" foot="bu değerin üstü sıcak nokta" />
          {y && <Card label="Meydan − 1,5 km çevre" value={n1(y.calisma_alani_kara.ortalama - y.cevre_1500m_kiyi_disi.ortalama)} unit="°C" foot="kıyıdan uzak kent dokusuna göre" />}
        </div>
        <div><div className="heat-ramp" aria-hidden="true" /><div className="heat-ticks"><span>{n1(hs.p2)} °C</span><span>{n1((hs.p2 + hs.p98) / 2)}</span><span>{n1(hs.p98)} °C</span></div></div>
        <div className="btns"><button className="btn small" onClick={() => A.toggle('heat')}>{A.visible.heat ? 'Isı katmanını kapat' : 'Isı katmanını haritada aç'}</button></div>
        <Acc sub id="right.heat.info" title="Verinin söyledikleri ve yöntem"><HeatInfo heat={A.heat} /></Acc>
      </>}
      {perKey(s => <KpiGrid s={s} group="Isı" onExplain={A.onExplain} />)}
      {A.heatSimNode}
    </Acc>

    <Acc id="right.green" title="Yeşil alan ve gölgeleme" icon="leaf" count={s0 ? `%${n1(kv(s0, 'yesil_oran')?.value as number)} · %${n1(kv(s0, 'golge_oran')?.value as number)}` : ''}>
      {pending}
      {perKey(s => <><KpiGrid s={s} group="Kentsel tasarım" onExplain={A.onExplain} /><KpiGrid s={s} group="Gölge" onExplain={A.onExplain} skip={['golge_oran']} /></>)}
      {(A.profile.mevcut || A.profile.proje) && <Acc sub id="right.green.profile" title="Gün içi gölge profili">
        <Chart height={220} option={t => ({
          grid: { left: 40, right: 12, top: 28, bottom: 28 },
          legend: { top: 0, textStyle: { color: t.ink2 }, itemWidth: 14 },
          tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v} %` },
          xAxis: { type: 'category', data: (A.profile.mevcut ?? A.profile.proje)!.map((r: any) => r.time.slice(11, 16)), axisLabel: { color: t.ink2 }, axisLine: { lineStyle: { color: t.grid } } },
          yAxis: { type: 'value', name: '% gölge', nameTextStyle: { color: t.ink2 }, axisLabel: { color: t.ink2 }, splitLine: { lineStyle: { color: t.grid } } },
          series: [
            ...(A.profile.mevcut ? [{ name: 'Mevcut', type: 'line' as const, data: A.profile.mevcut.map((r: any) => r.golge_oran), symbolSize: 8, lineStyle: { width: 2 } }] : []),
            ...(A.profile.proje ? [{ name: 'Proje', type: 'line' as const, data: A.profile.proje.map((r: any) => r.golge_oran), symbolSize: 8, lineStyle: { width: 2 } }] : []),
          ],
        })} />
        <div className="muted small">Geometrik hesaplama · tüm çalışma alanı · seçili tarih.</div>
      </Acc>}
    </Acc>

    <Acc id="right.transport" title="Ulaşım ve hareketlilik" icon="bus" count={trSite?.meanSpeed != null ? `${Math.round(trSite.meanSpeed)} km/sa${A.traffic?.live ? ' · canlı' : ''}` : ''}>
      {pending}
      {perKey(s => <KpiGrid s={s} group="Ulaşım" onExplain={A.onExplain} />)}
      {tr && <div className="kpis">
        <Card label="Canlı trafik · çalışma alanı" value={trSite?.meanSpeed != null ? Math.round(trSite.meanSpeed) : '—'} unit="km/sa" method="data"
          foot={A.traffic!.live ? `İBB ${hm(A.traffic!.date)}` : 'anlık görüntü'} />
        <Card label="Yoğun / çok yoğun yol" value={congested != null ? `%${n0(congested)}` : '—'} foot={`${trSite!.n} yol parçası, ${n1(trSite!.total)} km`} />
      </div>}
      {A.traffic && !A.traffic.live && <Status onRetry={A.retryTraffic}>İBB canlı trafik alınamadı · {A.trafficOk ? `son başarılı: ${A.trafficOk}` : `anlık görüntü (${new Date(A.traffic.date).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}) gösteriliyor`}</Status>}
      <div className="btns">
        <button className="btn small" onClick={() => A.toggle('traffic')}>{A.visible.traffic ? 'Canlı trafiği kapat' : 'Canlı trafiği aç (İBB)'}</button>
        <button className="btn small" onClick={() => A.toggle('comfort')}>{A.visible.comfort ? 'Yaya konforunu kapat' : 'Yaya konforunu aç'}</button>
      </div>
      {A.trafficNode && <Acc sub id="right.transport.traffic" title="Canlı trafik ayrıntıları">{A.trafficNode}</Acc>}
      {A.scenarioTrafficNode}
      {A.comfortNode && <Acc sub id="right.transport.comfort" title="Yaya konforu: aktarma yollarında saatlik gölge">{A.comfortNode}</Acc>}
      <div className="small muted">Dinamik modelde Şehir Hatları vapur kalkış ve varışları resmî tariften alınır (veri); Turyol seferleri aralık varsayımıyla üretilir.</div>
    </Acc>

    <Acc id="right.peds" title="Yaya simülasyonu" icon="walk" count={A.visible.peds ? 'akış çalışıyor' : ''} keep>
      {A.visible.peds ? A.pedNode : <>
        <div className="small">Vapur ve M4'ten inen, otobüs ve dolmuşa yürüyen yolcuları ajan olarak canlandırır; her yolcunun güneşte ve gölgede yürüdüğü süreyi hesaplar.</div>
        <div className="btns"><button className="btn primary small" onClick={() => A.toggle('peds', true)}>Yaya akışını başlat</button></div>
      </>}
      <div className="small muted">İskelede ve durakta bekleyen yolcu ile bölgesel yoğunluk dinamik modelde hesaplanır; ölçüm değil, model tahminidir.</div>
    </Acc>

    <Acc id="right.perf" title="Performans ve karşılaştırma" icon="chart" count={A.hasResult ? `sonuç: ${A.resultName}` : cols.length > 1 ? 'mevcut · proje' : ''}>
      {A.scenarioNode}
      {!A.hasResult && <>
        {cols.length > 0 && <table className="t cmp"><thead><tr><th>Gösterge</th>{cols.map(k => <th key={k} className="num">{k === 'mevcut' ? 'Mevcut' : 'Proje'}</th>)}</tr></thead>
          <tbody>{ROWS.map(id => {
            const vs = cols.map(k => kv(A.stateK[k], id))
            if (!vs[0]) return null
            return <tr key={id}><td>{vs[0].label}</td>{vs.map((k, i) => {
              const v = k?.value, b = vs[0]?.value
              const d = i > 0 && typeof v === 'number' && typeof b === 'number' ? v - b : null
              const good = d != null && d !== 0 ? (d > 0) !== LOWER_IS_BETTER.has(id) : null
              return <td key={i} className="num">{fmt(v)}{k?.unit && k.unit !== '—' ? ` ${k.unit === '%' ? '' : k.unit}` : ''}{k?.unit === '%' ? ' %' : ''}
                {d != null && d !== 0 && <span className={`delta ${good ? 'pos' : 'neg'}`}> {d > 0 ? '▲' : '▼'}</span>}</td>
            })}</tr>
          })}</tbody></table>}
        {cols.length < 2 && <div className="small">Mevcut ve proje durumunu yan yana görmek için <button className="how" onClick={A.goSplit}>Split Screen</button>'e geçin.</div>}
        <details className="more"><summary>Nasıl okunur?</summary>
          <p>Sütunlar aynı tarih, saat ve analiz alanı için hesaplanır; ▲▼ yalnızca değişimin yönünü gösterir. Sistem en iyi senaryoyu seçmez; değişimi ve yöntemini gösterir.
            Kaydedilmiş senaryoların tümü <button className="how" onClick={A.goCompare}>Karşılaştırma</button> sekmesindedir.</p></details>
      </>}
    </Acc>
  </>
}
