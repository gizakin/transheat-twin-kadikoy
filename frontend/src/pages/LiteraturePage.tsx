import { useEffect, useState } from 'react'
import { api } from '../api'

export default function LiteraturePage() {
  const [lit, setLit] = useState<any>(null)
  useEffect(() => { api.literature().then(setLit) }, [])
  if (!lit) return <div className="page">Yükleniyor…</div>
  const src = lit.sources as Record<string, any>
  return <div className="page">
    <h2>Literatür ve varsayımlar</h2>
    <div className="muted">Bir değer ancak kaynağı metniyle kontrol edildiyse kullanılır. Kaynağı bulunamayan parametreler “Literatür parametresi tanımlanmamış” olarak gösterilir.
      Kütüphane dosyası: <code>backend/app/literature/params.yaml</code> (elle genişletilebilir).</div>

    <div className="card"><h3>Parametreler</h3>
      <table className="t"><thead><tr><th>Müdahale</th><th>Parametre</th><th className="num">Değer / aralık</th><th>Kaynak</th><th>Yıl</th><th>Çalışma alanı</th><th>Yöntem</th><th>Güven / belirsizlik</th></tr></thead>
        <tbody>{lit.parameters.map((p: any) => { const s = src[p.kaynak] ?? {}; return <tr key={p.id}>
          <td>{p.mudahale}</td><td>{p.parametre}{p.not && <div className="muted small">{p.not}</div>}</td>
          <td className="num">{p.tanimlanmamis ? <span className="muted">Literatür parametresi tanımlanmamış</span> : <>{p.deger[0]}{p.deger[1] !== p.deger[0] && `–${p.deger[1]}`} {p.birim}</>}</td>
          <td>{s.kunye ? <>{s.kunye.split('(')[0].trim()}{s.doi && <div className="small"><a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">doi:{s.doi}</a></div>}</> : '—'}</td>
          <td>{s.kunye?.match(/\((\d{4})/)?.[1] ?? '—'}</td><td>{s.calisma_alani ?? '—'}</td><td>{s.yontem ?? '—'}</td><td>{p.guven ?? '—'}</td>
        </tr> })}</tbody></table>
    </div>

    <div className="card"><h3>Kaynaklar ve doğrulama yolu</h3>
      <table className="t"><thead><tr><th>Künye</th><th>Doğrulama</th></tr></thead>
        <tbody>{Object.entries(src).map(([k, s]: any) => <tr key={k}><td>{s.kunye}{s.url && <div className="small"><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></div>}</td><td className="small">{s.dogrulama}</td></tr>)}</tbody></table>
    </div>

    <div className="card"><h3>Varsayımlar</h3>
      <table className="t"><thead><tr><th>Varsayım</th><th>Değer</th><th>Nerede kullanılır</th></tr></thead>
        <tbody>{lit.assumptions.map((a: any) => <tr key={a.id}><td>{a.ad}</td><td>{String(a.deger)} {a.birim ?? ''}</td><td>{a.kullanim}</td></tr>)}</tbody></table>
    </div>

    <div className="card"><h3>Yöntem etiketleri</h3>
      <ul className="plain">
        <li><span className="badge data">Veri tabanlı gözlem</span> Klasördeki veriden (CAD, SHP, ortofoto, yüklenen uydu rasterı) doğrudan okunan ya da sınıflandırılan değer.</li>
        <li><span className="badge geometric">Geometrik hesaplama</span> Alan, oran, gölge ve mesafe gibi doğrudan hesaplanan göstergeler.</li>
        <li><span className="badge literature">Literatür tabanlı tahmin</span> Yukarıdaki doğrulanmış parametrelerle kurulan etki aralığı; Kadıköy'de ölçülmemiştir.</li>
        <li><span className="badge assumption">Varsayım</span> Açıkça listelenen kabuller (kat yüksekliği, opak taç vb.).</li>
        <li><span className="badge model">Model tabanlı sonuç</span> Fiziksel mikroklima modeli (ör. UMEP/SOLWEIG). Bu prototipte henüz çalıştırılmamıştır.</li>
      </ul>
    </div>
  </div>
}
