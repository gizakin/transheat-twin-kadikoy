import { TRAFFIC_CLASSES, TRAFFIC_NODATA, trafficSummary, type TrafficState } from '../engine/traffic'

const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) }
const fmt1 = (x: number) => x.toLocaleString('tr-TR', { maximumFractionDigits: 1 })

function ClassBar({ km, total }: { km: number[]; total: number }) {
  const parts = [...TRAFFIC_CLASSES.map(k => ({ ...k, v: km[k.c] })), { c: 0, label: 'Veri yok', color: TRAFFIC_NODATA, v: km[0] }].filter(p => p.v > 0)
  return <div>
    <div className="traffic-bar" role="img" aria-label={parts.map(p => `${p.label} ${fmt1(p.v)} km`).join(', ')}>
      {parts.map(p => <span key={p.c} style={{ flex: p.v, background: p.color }} title={`${p.label}: ${fmt1(p.v)} km`} />)}
    </div>
    <div className="small traffic-bar-legend">{parts.map(p => <span key={p.c}><i style={{ background: p.color }} />{p.label} {Math.round((100 * p.v) / total)}%</span>)}</div>
  </div>
}

export default function TrafficInfo({ st, segs, onRefresh }: { st: TrafficState | null; segs: GeoJSON.FeatureCollection | null; onRefresh: () => void }) {
  if (!st || !segs) return <div className="section"><h3>Canlı trafik (İBB)</h3><div className="small muted">Veri alınıyor…</div></div>
  const s = trafficSummary(segs, st)
  return <div className="section">
    <h3>Canlı trafik (İBB)</h3>
    <div className="badges"><span className="badge data">Veri tabanlı gözlem</span>{st.live ? <span className="badge live">● canlı</span> : <span className="badge assumption">anlık görüntü</span>}</div>
    {st.live
      ? <div className="small">İBB veri zamanı: <b>{fmtTime(st.date)}</b> · her 60 sn yenilenir <button className="how" onClick={onRefresh}>şimdi yenile</button></div>
      : <div className="note small">Canlı bağlantı kurulamadı ({st.error}). Gösterilen veri {fmtTime(st.date)} tarihli anlık görüntüdür. <button className="how" onClick={onRefresh}>tekrar dene</button></div>}
    <div className="kpi-row">
      <div><div className="small muted">Çalışma alanındaki yollar</div>
        <b className="big">{s.site.meanSpeed != null ? `${Math.round(s.site.meanSpeed)} km/sa` : '—'}</b>
        <div className="small muted">ortalama hız · {s.site.n} yol parçası, {fmt1(s.site.total)} km</div></div>
      <div><div className="small muted">1,5 km çevre</div>
        <b className="big">{s.context.meanSpeed != null ? `${Math.round(s.context.meanSpeed)} km/sa` : '—'}</b>
        <div className="small muted">ortalama hız · {s.context.n} yol parçası, {fmt1(s.context.total)} km</div></div>
    </div>
    <div className="small muted" style={{ marginTop: 6 }}>Çalışma alanı: yoğunluk sınıfına göre yol uzunluğu</div>
    <ClassBar km={s.site.km} total={s.site.total} />
    <div className="small muted" style={{ marginTop: 6 }}>1,5 km çevre</div>
    <ClassBar km={s.context.km} total={s.context.total} />
    {st.index != null && <div className="small" style={{ marginTop: 6 }}>İstanbul geneli trafik indeksi (İBB): <b>{st.index}</b></div>}
    <details className="small" style={{ marginTop: 6 }}><summary>Bu veri nedir?</summary>
      <p>Hız ve yoğunluk sınıfı İBB Ulaşım Yönetim Merkezi'nin yol parçası ölçümüdür (Trafik Yoğunluk Haritası ile aynı kaynak). Ortalamalar yol uzunluğuyla ağırlıklandırılmıştır; veri olmayan parçalar ortalamaya girmez.</p>
      <p>Gözlem olarak kullanılır: yaya konforunda sıkışık trafiğe bitişik yürüme, senaryoda müdahale alanındaki trafik ve hat seçicide canlı geçiş süresi. Isı ve gölge hesaplarına girdi değildir; trafiğin ısı katkısı bir model ve araç sayısı verisi gerektirir.</p>
    </details>
  </div>
}

const CLASS_LABEL: Record<number, string> = { 0: 'veri yok', 1: 'Serbest', 2: 'Açık', 3: 'Akıcı', 4: 'Yoğun', 5: 'Çok yoğun' }

/** Live road traffic inside the scenario's intervention areas (observation, no prediction of the intervention's effect on traffic). */
export function ScenarioTraffic({ a, live }: { a: import('../engine/trafficLink').AreaTraffic | null; live: boolean }) {
  if (!a) return null
  return <div className="section">
    <h3>Müdahale alanındaki trafik (İBB)</h3>
    <div className="badges"><span className="badge data">Veri tabanlı gözlem</span>{live ? <span className="badge live">● canlı</span> : <span className="badge assumption">anlık görüntü</span>}</div>
    {a.segs.length === 0 ? <div className="small muted">Müdahale alanı İBB trafik yol parçalarından hiçbirini kesmiyor.</div> : <>
      <div className="small">Alan, şu an <b>{a.segs.length}</b> yol parçasının toplam <b>{Math.round(a.inside)} m</b>'sini kesiyor
        {a.meanSpeed != null && <>; bu kesimlerde ortalama hız <b>{Math.round(a.meanSpeed)} km/sa</b></>}, en kötü sınıf <b>{CLASS_LABEL[a.worst]}</b>{a.time ? ` (İBB veri saati ${a.time})` : ''}.</div>
      {a.lines > 0 && <div className="small" style={{ marginTop: 4 }}>Buradaki en yoğun koridordan <b>{a.lines}</b> otobüs hattı geçiyor: <span className="muted">{a.lineNames.slice(0, 18).join(', ')}{a.lineNames.length > 18 ? '…' : ''}</span></div>}
      <table className="t air-t" style={{ marginTop: 6 }}><thead><tr><th>Yol parçası</th><th>Alanda</th><th>Hız</th><th>Sınıf</th></tr></thead>
        <tbody>{a.segs.slice(0, 6).map(s => <tr key={s.S}><td>{s.S}</td><td>{Math.round(s.inside)} m</td><td>{s.V != null ? `${s.V} km/sa` : '—'}</td><td>{CLASS_LABEL[s.C]}</td></tr>)}</tbody></table>
      <div className="small muted" style={{ marginTop: 4 }}>Bu, müdahalenin trafik üzerindeki etkisinin tahmini değildir; alanın bugün hangi trafik koşullarına dokunduğunu gösterir. Etki tahmini bir trafik atama modeli gerektirir.</div>
    </>}
  </div>
}
