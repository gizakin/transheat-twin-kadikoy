import { useEffect, useState } from 'react'
import { api } from '../api'
import { METHOD_LABEL } from '../components/ui'
import type { LayerMeta } from '../types'

export default function CatalogPage({ layers, reload }: { layers: LayerMeta[]; reload: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [crs, setCrs] = useState('')
  const [heat, setHeat] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')
  const [gee, setGee] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => { fetch('gee_landsat_lst.js').then(r => r.text()).then(setGee).catch(() => {}) }, [])
  const send = () => {
    if (!file) return
    setBusy(true); setErr(''); setRes(null)
    api.upload(file, crs, heat).then(r => { setRes(r); reload() }).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  const core = layers.filter(l => !l.id.startsWith('upload_'))
  const ups = layers.filter(l => l.id.startsWith('upload_'))
  return <div className="page">
    <h2>Veri kataloğu ve yükleme</h2>
    <div className="card"><h3>Yeni veri yükle</h3>
      <div className="muted small">Desteklenen: GeoJSON, Shapefile (.zip), GeoTIFF, CSV (lon/lat veya x/y), KML; PNG/JPG/PDF belge olarak kaydedilir.
        Sistem türü algılar, CRS'i kontrol eder, metaveri ve kaynak kaydı oluşturur. CRS içermeyen veri sessizce varsayılmaz.
        Dosyalar yalnızca bu tarayıcıda işlenir; hiçbir yere gönderilmez ve sayfa yenilenince silinir.</div>
      <div className="row" style={{ marginTop: 8, alignItems: 'end' }}>
        <div className="field"><label htmlFor="up-file">Dosya</label><input id="up-file" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
        <div className="field"><label htmlFor="up-crs">CRS (dosyada yoksa, ör. EPSG:5254)</label><input id="up-crs" value={crs} placeholder="boş bırakılabilir" onChange={e => setCrs(e.target.value)} /></div>
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}><input type="checkbox" checked={heat} onChange={e => setHeat(e.target.checked)} />Isı haritası olarak kullan (GeoTIFF)</label>
        <button className="btn primary" style={{ flex: 'none' }} disabled={!file || busy} onClick={send}>{busy ? 'Yükleniyor…' : 'Yükle'}</button>
      </div>
      {err && <div className="note">{err}</div>}
      {res && <div className="info small"><b>{res.metadata.dosya}</b> → tür: {res.kind}, CRS: {res.metadata.crs ?? 'yok'}
        {res.metadata.alanla_cakisma === false && ' · çalışma alanıyla çakışmıyor'}
        {res.metadata.uyarilar?.map((u: string) => <div key={u}>⚠ {u}</div>)}</div>}
      <details style={{ marginTop: 8 }}><summary className="small">Google Earth Engine: Landsat 8/9 yüzey sıcaklığı (LST) betiği</summary>
        <div className="small muted" style={{ margin: '6px 0' }}>Betiği GEE Code Editor'a yapıştırıp çalıştırın; Drive'a inen GeoTIFF'i buraya “Isı haritası olarak kullan” işaretli yükleyin.</div>
        <button className="btn small" onClick={() => navigator.clipboard.writeText(gee).then(() => setCopied('Kopyalandı'), () => setCopied('Kopyalanamadı; metni seçip kopyalayın'))}>{copied || 'Betiği kopyala'}</button>
        <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: 8, borderRadius: 6 }}>{gee}</pre>
      </details>
    </div>

    {ups.length > 0 && <div className="card"><h3>Yüklenen veriler</h3>
      <table className="t"><thead><tr><th>Ad</th><th>Tür</th><th>CRS</th><th>Yükleme</th><th>Uyarılar</th><th></th></tr></thead>
        <tbody>{ups.map(u => <tr key={u.id}><td>{u.title}</td><td>{u.kind}</td><td>{(u.metadata as any)?.crs ?? '—'}</td><td>{u.date}</td>
          <td className="small">{((u.metadata as any)?.uyarilar ?? []).join(' · ') || '—'}</td>
          <td className="btns">{u.kind === 'raster' && <button className="btn small" onClick={() => api.setHeat(u.id.replace('upload_', '')).then(reload)}>Isı katmanı yap</button>}
            <button className="btn small" onClick={() => api.deleteUpload(u.id.replace('upload_', '')).then(reload)}>Sil</button></td></tr>)}</tbody></table>
    </div>}

    <div className="card"><h3>Sistemdeki katmanlar</h3>
      <table className="t"><thead><tr><th>Katman</th><th>Grup</th><th className="num">Obje</th><th>Kaynak</th><th>Tarih</th><th>Yöntem</th><th>Not</th></tr></thead>
        <tbody>{core.map(l => <tr key={l.id}><td>{l.title}</td><td>{l.group}</td><td className="num">{l.count?.toLocaleString('tr-TR') ?? '—'}</td>
          <td className="small">{l.source}</td><td>{l.date}</td><td><span className={`badge ${l.method}`}>{METHOD_LABEL[l.method]}</span></td><td className="small">{l.notes ?? ''}</td></tr>)}</tbody></table>
    </div>
  </div>
}
