import { useState, type ReactNode } from 'react'
import { Acc } from '../components/Acc'
import { LAT, LON } from '../engine/sun'
import { compass, dni, EAQI, eaqiBand, RAIN_MM, SUNSHINE_DNI, sunState, WHO_24H, WHO_O3_8H, WMO, type Air, type AirHour, type Weather, type WeatherHour } from '../engine/weather'

const n0 = (x: number | null | undefined) => (x == null ? '—' : Math.round(x).toLocaleString('tr-TR'))
const n1 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('tr-TR', { maximumFractionDigits: 1 }))
const c3 = (x: number) => x.toFixed(3).replace('.', ',')

/** Collapsible detail block inside the weather accordion: a one-line digest when closed; remembered per viewer. */
function Fold({ id, title, digest, children }: { id: string; title: ReactNode; digest?: ReactNode; children: ReactNode }) {
  return <Acc sub id={`fold.${id}`} title={title} count={digest}>{children}</Acc>
}

/** Air-quality hour shown for the selected time (the 15-min current value when following today's clock). */
export function airAt(a: Air, time: string, useCurrent: boolean) {
  const hr = time.slice(0, 13)
  return (useCurrent && a.current) ? a.current : a.hours.find(h => h.time.slice(0, 13) === hr) ?? null
}

function gridKm(lat: number, lon: number) {
  const dx = (lon - LON) * 111.32 * Math.cos((LAT * Math.PI) / 180), dy = (lat - LAT) * 110.54
  return Math.hypot(dx, dy)
}

export function WeatherInfo({ w, at, time, err, loading }: {
  w: Weather | null; at: (WeatherHour & { isCurrent: boolean }) | null; time: string; err: string; loading: boolean
}) {
  const hhmm = time.slice(11, 16)
  if (err) return <Fold id="weather" title="Hava durumu ayrıntıları" digest="veri alınamadı"><div className="note small">Hava verisi alınamadı ({err}). Gölge yalnızca güneş geometrisiyle (bulutsuz gökyüzü) gösterilir.</div></Fold>
  if (!w || !at) return <Fold id="weather" title="Hava durumu ayrıntıları" digest={loading ? 'alınıyor…' : '—'}><div className="small muted">{loading ? 'Hava verisi alınıyor…' : 'Bu saat için hava verisi yok.'}</div></Fold>
  const st = sunState(at.direct, time, at.precip)
  const n = dni(at.direct, time)
  const day = w.hours
  const rainDay = day.reduce((s, h) => s + (h.precip ?? 0), 0)
  const icon = st === 'sunny' ? '☀' : st === 'cloudy' ? '☁' : st === 'rain' ? '🌧' : st === 'night' ? '☾' : '·'
  const digest = <>{at.isCurrent ? at.time.slice(11, 16) : `${hhmm.slice(0, 2)}:00`} · {icon} {n1(at.temp)} °C · {at.code != null ? WMO[at.code] ?? '' : ''}{at.precip ? ` · ${n1(at.precip)} mm` : ''}</>
  return <Fold id="weather" title="Hava durumu ayrıntıları" digest={digest}><div className="weather">
    <div className="badges"><span className="badge model">Model tabanlı sonuç</span><span className="small muted">Open-Meteo · {w.source === 'forecast' ? 'tahmin/analiz' : 'arşiv (yeniden analiz)'} · {at.isCurrent ? '15 dk güncel değer' : 'saatlik değer'}</span></div>
    {at.code != null && <div className="wx-code">{WMO[at.code] ?? `WMO kodu ${at.code}`}</div>}
    <div className="wx-grid">
      <div><span className="muted">Sıcaklık</span><b>{n1(at.temp)} °C</b></div>
      <div><span className="muted">Hissedilen</span><b>{n1(at.app)} °C</b></div>
      <div><span className="muted">Nem</span><b>%{n0(at.rh)}</b></div>
      <div><span className="muted">Basınç</span><b>{n0(at.pressure)} hPa</b></div>
      <div><span className="muted">Rüzgâr</span><b>{n1(at.wind)} km/sa {compass(at.windDir)}</b></div>
      <div><span className="muted">Hamle</span><b>{n1(at.gust)} km/sa</b></div>
      <div><span className="muted">Yağış (1 sa)</span><b>{n1(at.precip)} mm</b></div>
      {at.precipProb != null ? <div><span className="muted">Yağış olasılığı</span><b>%{n0(at.precipProb)}</b></div>
        : <div><span className="muted">Günlük yağış</span><b>{n1(rainDay)} mm</b></div>}
      <div><span className="muted">Bulutluluk</span><b>%{n0(at.cloud)}</b></div>
      <div><span className="muted">Alçak / orta / yüksek</span><b>{n0(at.cloudLow)} / {n0(at.cloudMid)} / {n0(at.cloudHigh)}</b></div>
      <div><span className="muted">Direkt güneş</span><b>{n0(at.direct)} W/m²</b></div>
      <div><span className="muted">Yayılı ışınım</span><b>{n0(at.diffuse)} W/m²</b></div>
      {at.uv != null && <div><span className="muted">UV indeksi</span><b>{n1(at.uv)}</b></div>}
      {at.visibility != null && <div><span className="muted">Görüş</span><b>{n1(at.visibility / 1000)} km</b></div>}
      {at.snow != null && at.snow > 0 && <div><span className="muted">Kar</span><b>{n1(at.snow)} cm</b></div>}
    </div>
    <div className={`wx-sun ${st}`}>
      {st === 'sunny' && <>☀ Güneş açık (direkt normal ışınım ≈{n0(n)} W/m² ≥ {SUNSHINE_DNI}): haritadaki gölgeler bu saat için anlamlıdır.</>}
      {st === 'cloudy' && <>☁ Güneş bulut arkasında (direkt normal ışınım ≈{n0(n)} W/m² &lt; {SUNSHINE_DNI}): hesaplanan gölgeler bu saatte zayıftır; gölgeli ile güneşli yer arasındaki fark az hissedilir.</>}
      {st === 'rain' && <>🌧 Yağışlı saat ({n1(at.precip)} mm ≥ {RAIN_MM} mm): gölge göstergeleri bu saatte anlamlı değildir; yağıştan korunma (saçak, kapalı geçiş) önem kazanır.</>}
      {st === 'night' && <>Güneş ufkun altında: gölge göstergeleri bu saatte anlamlı değildir.</>}
      {st === 'unknown' && <>Güneş ufka çok yakın; güneşlenme belirlenemedi.</>}
    </div>
    <DayStrip w={w} />
    <div className="small muted" style={{ marginTop: 6 }}>Değerler sayısal hava modelinin ızgara hücresinden gelir ({c3(w.gridLat)}° K, {c3(w.gridLon)}° D; meydana ≈{n1(gridKm(w.gridLat, w.gridLon))} km), istasyon ölçümü değildir.
      Güneşlenme eşiği: WMO, direkt normal ışınım ≥ {SUNSHINE_DNI} W/m². Gölge hesabı bulutları içermez. <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a> (CC BY 4.0)</div>
  </div></Fold>
}

/** 24-hour strip for the selected day: sunshine / cloud / rain per hour and the temperature range. */
function DayStrip({ w }: { w: Weather }) {
  const ts = w.hours.map(h => h.temp).filter((t): t is number => t != null)
  return <div style={{ marginTop: 8 }}>
    <div className="small muted">Günün saatleri: güneşli / bulutlu / yağışlı · sıcaklık {ts.length ? `${n1(Math.min(...ts))}–${n1(Math.max(...ts))} °C` : '—'}</div>
    <div className="wx-strip">{w.hours.map(h => {
      const s = sunState(h.direct, h.time, h.precip)
      return <span key={h.time} className={`cg-sun ${s}`} title={`${h.time.slice(11, 16)}: ${WMO[h.code ?? -1] ?? ''} · ${n1(h.temp)} °C · yağış ${n1(h.precip)} mm · bulut %${n0(h.cloud)}`} />
    })}</div>
    <div className="wx-strip-ticks small muted"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
  </div>
}

const POLL: { k: keyof AirHour; label: string; who: string }[] = [
  { k: 'pm25', label: 'PM2.5', who: `${WHO_24H.pm25}` }, { k: 'pm10', label: 'PM10', who: `${WHO_24H.pm10}` },
  { k: 'no2', label: 'NO₂', who: `${WHO_24H.no2}` }, { k: 'o3', label: 'Ozon (O₃)', who: `${WHO_O3_8H} (8 sa)` }, { k: 'so2', label: 'SO₂', who: `${WHO_24H.so2}` },
]

export function AirQualityInfo({ a, time, useCurrent, err, loading }: { a: Air | null; time: string; useCurrent: boolean; err: string; loading: boolean }) {
  if (err) return <Fold id="air" title="Hava kalitesi ayrıntıları" digest="veri alınamadı"><div className="note small">Hava kalitesi verisi alınamadı ({err}).</div></Fold>
  if (!a) return <Fold id="air" title="Hava kalitesi ayrıntıları" digest={loading ? 'alınıyor…' : '—'}><div className="small muted">{loading ? 'Hava kalitesi verisi alınıyor…' : '—'}</div></Fold>
  const hr = time.slice(0, 13)
  const at = airAt(a, time, useCurrent)
  const mean = (k: keyof AirHour) => { const v = a.hours.map(h => h[k]).filter((x): x is number => typeof x === 'number'); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
  const o3max8 = (() => { const v = a.hours.map(h => h.o3); let best: number | null = null
    for (let i = 0; i + 8 <= v.length; i++) { const w = v.slice(i, i + 8); if (w.every(x => x != null)) { const m = (w as number[]).reduce((s, x) => s + x, 0) / 8; best = best == null ? m : Math.max(best, m) } }
    return best })()
  const band = eaqiBand(at?.aqi ?? null)
  const overs = POLL.filter(p => { const m = p.k === 'o3' ? o3max8 : mean(p.k); const lim = p.k === 'o3' ? WHO_O3_8H : WHO_24H[p.k]; return m != null && lim != null && m > lim }).map(p => p.label)
  const digest = <>{band && <span className="aqi-dot" style={{ background: band.color }} />}AQI {at?.aqi ?? '—'} · {band?.label ?? '—'}{overs.length ? ` · WHO ▲ ${overs.join(', ')}` : ''}</>
  return <Fold id="air" title="Hava kalitesi ayrıntıları" digest={<>{at ? (useCurrent && a.current ? a.current.time.slice(11, 16) : `${hr.slice(11, 13)}:00`) : '—'} · {digest}</>}><div className="air">
    <div className="badges"><span className="badge model">Model tabanlı sonuç</span><span className="small muted">Copernicus CAMS Avrupa modeli</span></div>
    {at && <div className="aqi-row">
      <span className="aqi-badge" style={{ background: band?.color ?? '#ccc', color: band?.ink ?? '#000' }}>{at.aqi ?? '—'}</span>
      <div><b>Avrupa hava kalitesi indeksi: {band?.label ?? '—'}</b><div className="aqi-scale">{EAQI.map(b => <i key={b.label} style={{ background: b.color }} title={`${b.label}: ≤${b.max === Infinity ? '100+' : b.max}`} />)}</div></div>
    </div>}
    <table className="t air-t">
      <thead><tr><th>Kirletici (µg/m³)</th><th>Bu saat</th><th>Gün ort.</th><th>WHO 2021</th></tr></thead>
      <tbody>{POLL.map(p => {
        const m = p.k === 'o3' ? o3max8 : mean(p.k)
        const lim = p.k === 'o3' ? WHO_O3_8H : (WHO_24H[p.k] ?? null)
        const over = m != null && lim != null && m > lim
        return <tr key={p.k}><td>{p.label}</td><td>{n1(at?.[p.k] as number | null)}</td>
          <td className={over ? 'over' : ''}>{n1(m)}{p.k === 'o3' ? <span className="muted"> (8 sa en yüksek)</span> : null}{over ? ' ▲' : ''}</td><td className="muted">{p.who}</td></tr>
      })}</tbody>
    </table>
    <div className="small muted" style={{ marginTop: 4 }}>▲ günlük ortalama WHO 2021 kılavuz değerini aşıyor (kılavuz değerler 24 saatlik ortalama içindir; ozon için 8 saatlik). Izgara hücresi {c3(a.gridLat)}° K, {c3(a.gridLon)}° D (≈{n1(gridKm(a.gridLat, a.gridLon))} km; CAMS Avrupa ≈11 km çözünürlük), istasyon ölçümü değildir. Kaynak: Copernicus Atmosphere Monitoring Service, <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0).</div>
  </div></Fold>
}

const OVERLAYS: [string, string][] = [['wind', 'Rüzgâr'], ['gust', 'Hamle'], ['rain', 'Yağış'], ['clouds', 'Bulut'], ['temp', 'Sıcaklık'], ['rh', 'Nem'],
  ['pressure', 'Basınç'], ['visibility', 'Görüş'], ['thunder', 'Fırtına'], ['waves', 'Dalga'], ['pm2p5', 'PM2.5'], ['no2', 'NO₂']]

/** Windy's free embeddable map (embed.windy.com) for regional context; it shows Windy's own current forecast, not the selected hour. */
export function WindyMap() {
  const [big, setBig] = useState(false)
  const [ov, setOv] = useState('wind')
  const src = (w: number, h: number, zoom: number) => `https://embed.windy.com/embed2.html?lat=40.99&lon=29.02&detailLat=${LAT}&detailLon=${LON}&width=${w}&height=${h}&zoom=${zoom}` +
    `&level=surface&overlay=${ov}&product=${ov === 'pm2p5' || ov === 'no2' ? 'cams' : 'ecmwf'}&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`
  const buttons = <div className="windy-ov">{OVERLAYS.map(([k, l]) => <button key={k} className={`btn small ${k === ov ? 'primary' : ''}`} onClick={() => setOv(k)}>{l}</button>)}</div>
  return <Fold id="windy" title="Windy haritası" digest="bölgesel rüzgâr, yağış, bulut…">
    {buttons}
    <iframe className="windy-frame" title="Windy hava haritası" src={src(340, 260, 9)} loading="lazy" />
    <div className="small muted">Windy'nin kendi güncel tahminidir (seçili saatten bağımsız); görsel bağlam içindir, analize girmez. <button className="how" onClick={() => setBig(true)}>büyüt</button></div>
    {big && <div className="modal-bg" onClick={() => setBig(false)}>
      <div className="modal windy-modal" onClick={e => e.stopPropagation()}>
        <div className="windy-modal-head"><b>Bölgesel hava haritası (Windy)</b>{buttons}<button className="btn small" onClick={() => setBig(false)}>Kapat</button></div>
        <iframe className="windy-frame big" title="Windy hava haritası (büyük)" src={src(1000, 620, 9)} />
      </div>
    </div>}
  </Fold>
}

export default WeatherInfo
