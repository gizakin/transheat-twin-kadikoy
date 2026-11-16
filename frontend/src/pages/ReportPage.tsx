import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import Chart from '../components/Chart'
import { fmt, METHOD_LABEL } from '../components/ui'
import { bboxOf, loadData, toTM, type Data, type XY } from '../engine/data'
import type { ScenarioResult } from '../types'

const CLASS_RGB: Record<number, [number, number, number]> = { 1: [90, 164, 105], 2: [167, 184, 106], 3: [205, 199, 188], 4: [95, 99, 105], 5: [226, 217, 200], 6: [111, 168, 220] }

/** Schematic map of a scenario on the analysis grid (class raster + shade + interventions), as a data URL. */
function schematic(D: Data, r: ScenarioResult) {
  const G = D.meta.grid
  const area = (r.geoms.analysis_area as GeoJSON.Feature).geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
  const ring = (area.type === 'Polygon' ? [area.coordinates] : area.coordinates).flat().flat().map(([lon, lat]) => toTM(lon, lat))
  const [x0, y0, x1, y1] = bboxOf([ring as any])
  const s = 2 // px per metre in the output
  const W = Math.round((x1 - x0) * s), H = Math.round((y1 - y0) * s)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d')!
  const img = c.createImageData(W, H)
  const cls = D.cls[r.scenario.base]
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = x0 + px / s, y = y1 - py / s
    const col = Math.floor((x - G.x0) / G.res), row = Math.floor((G.ytop - y) / G.res)
    const v = col >= 0 && row >= 0 && col < G.w && row < G.h ? cls[row * G.w + col] : 0
    const rgb = CLASS_RGB[v] ?? [200, 214, 222]
    const k = (py * W + px) * 4
    img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = 255
  }
  c.putImageData(img, 0, 0)
  const T = ([x, y]: XY): XY => [(x - x0) * s, (y1 - y) * s]
  const drawImg = (o: { url: string; tm: XY[] } | undefined) => new Promise<void>(res => {
    if (!o) return res()
    const im = new Image()
    im.onload = () => { const [a, b] = [T(o.tm[0]), T(o.tm[2])]; c.drawImage(im, a[0], a[1], b[0] - a[0], b[1] - a[1]); res() }
    im.onerror = () => res()
    im.src = o.url
  })
  const lines = (fc: any, style: string, w: number, fill?: string) => {
    for (const f of (fc?.features ?? [])) {
      const g = f.geometry
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : g.type === 'LineString' ? [[g.coordinates]] : []
      for (const p of polys) {
        c.beginPath()
        for (const r0 of p) r0.forEach(([lon, lat]: number[], i: number) => { const [px, py] = T(toTM(lon, lat)); i ? c.lineTo(px, py) : c.moveTo(px, py) })
        if (fill) { c.fillStyle = fill; c.fill() }
        c.strokeStyle = style; c.lineWidth = w; c.stroke()
      }
    }
  }
  return (async () => {
    await drawImg(r.images?.base_shade as any)
    await drawImg(r.images?.new_shade as any)
    lines(r.geoms.intervention_areas, '#e8a33d', 3)
    lines(r.geoms.new_tree_crowns, '#0b5d2a', 1, 'rgba(21,163,74,0.85)')
    lines(r.geoms.structures, '#374151', 1.5, 'rgba(156,163,175,0.6)')
    lines(r.geoms.affected_paths, '#d64545', 2.5)
    lines(r.geoms.routes, '#7b3fb6', 3)
    return cv.toDataURL('image/png')
  })()
}

function csv(results: ScenarioResult[]) {
  const rows = [['senaryo', 'gosterge', 'birim', 'temel', 'senaryo_degeri', 'fark', 'yontem']]
  for (const r of results) {
    const b = Object.fromEntries(r.kpis_base.map(k => [k.id, k]))
    for (const k of r.kpis_scenario) rows.push([r.scenario.scenario_name, k.label, k.unit, String(b[k.id]?.value ?? ''), String(k.value ?? ''), String(r.deltas[k.id] ?? ''), METHOD_LABEL[k.method]])
  }
  return rows.map(r => r.map(x => (x.includes(';') ? `"${x}"` : x)).join(';')).join('\n')
}

function Copy({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState('')
  return <button className="btn small" onClick={() => navigator.clipboard.writeText(text).then(() => setOk('Kopyalandı'), () => setOk('Kopyalanamadı; metni seçip kopyalayın'))}>{ok || label}</button>
}

export default function ReportPage() {
  const [list, setList] = useState<{ id: string; name: string; created_at: string; definition: any }[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [results, setResults] = useState<ScenarioResult[] | null>(null)
  const [maps, setMaps] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [imp, setImp] = useState('')
  const [err, setErr] = useState('')
  const [lit, setLit] = useState<any>(null)
  const [meta, setMeta] = useState<Record<string, any>>({})
  const load = () => api.scenarios().then(l => { setList(l); setSel(l.map(s => s.id)) })
  useEffect(() => { load(); api.literature().then(setLit); loadData().then(D => setMeta(D.meta.layers)) }, [])

  const build = async () => {
    setBusy(true); setErr('')
    try {
      const out: ScenarioResult[] = []
      for (const id of sel) out.push((await api.scenario(id)).results)
      const D = await loadData()
      setMaps(await Promise.all(out.map(r => schematic(D, r))))
      setResults(out)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const csvText = useMemo(() => (results ? csv(results) : ''), [results])
  const used = new Set(results?.flatMap(r => r.literature_effects.flatMap(e => e.params)) ?? [])

  return <div className="page">
    <h2>Rapor</h2>
    <div className="muted">Rapor bu sayfada oluşturulur: çalışma alanı, veriler ve kaynakları, mevcut/proje durumu, senaryolar, parametreler, yöntem, sonuçlar, harita,
      grafikler, varsayımlar, belirsizlikler ve literatür kaynakları. Tablo CSV olarak, senaryolar JSON olarak kopyalanabilir.</div>
    <div className="card"><h3>Kayıtlı senaryolar</h3>
      <div className="muted small">Senaryolar bu tarayıcıda saklanır; başkasıyla paylaşmak için JSON'unu kopyalayıp gönderin, karşı taraf aşağıdan içe aktarabilir.</div>
      <div className="tablewrap"><table className="t"><thead><tr><th></th><th>Ad</th><th>Temel</th><th>Müdahaleler</th><th>Oluşturulma</th><th></th></tr></thead>
        <tbody>{list.map(s => <tr key={s.id}>
          <td><input type="checkbox" checked={sel.includes(s.id)} onChange={() => setSel(sel.includes(s.id) ? sel.filter(x => x !== s.id) : [...sel, s.id])} aria-label={`${s.name} seç`} /></td>
          <td>{s.name}{s.definition.ornek && <span className="badge assumption" style={{ marginLeft: 6 }}>örnek</span>}</td><td>{s.definition.base}</td>
          <td className="small">{s.definition.interventions.map((i: any) => i.type).join(', ')}</td><td>{s.created_at}</td>
          <td className="btns"><Copy text={JSON.stringify(s.definition, null, 2)} label="JSON kopyala" />
            <button className="btn small" onClick={() => api.deleteScenario(s.id).then(load)}>Sil</button></td></tr>)}</tbody></table></div>
      <div className="btns" style={{ marginTop: 10 }}><button className="btn primary" disabled={!sel.length || busy} onClick={build}>{busy ? 'Hazırlanıyor…' : 'Raporu oluştur'}</button></div>
      <details style={{ marginTop: 10 }}><summary className="small">Senaryo JSON'u içe aktar</summary>
        <textarea id="import-json" value={imp} onChange={e => setImp(e.target.value)} rows={5} style={{ width: '100%', marginTop: 6 }} placeholder='{"scenario_name": "...", "interventions": [...]}' />
        <button className="btn small" onClick={() => api.importScenario(imp).then(() => { setImp(''); load() }).catch(e => setErr(e.message))}>İçe aktar</button>
      </details>
      {err && <div className="note">{err}</div>}
    </div>

    {results && <div className="card report">
      <h3>1. Çalışma alanı</h3>
      <p>Kadıköy Meydanı Kentsel Tasarım Yarışması alanı ({meta.boundary?.source}). Koordinat sistemi TUREF/TM30 (EPSG:5254). Hesaplar tarayıcıda, 0,5 m analiz ızgarasında yapılır.</p>
      <div className="note small">Rapor karar desteği amaçlıdır; senaryolar arasında otomatik sıralama veya “en iyi senaryo” hükmü verilmez. Hiçbir sıcaklık değeri fiziksel model çalıştırılarak üretilmemiştir.</div>
      <h3>2–3. Kullanılan veriler ve kaynakları</h3>
      <div className="tablewrap"><table className="t"><thead><tr><th>Katman</th><th>Kaynak</th><th>Tarih</th><th>Yöntem</th><th>Not</th></tr></thead>
        <tbody>{Object.entries(meta).map(([k, m]: any) => <tr key={k}><td>{m.title}</td><td className="small">{m.source}</td><td>{m.date}</td><td>{METHOD_LABEL[m.method as keyof typeof METHOD_LABEL] ?? m.method}</td><td className="small">{m.notes ?? ''}</td></tr>)}</tbody></table></div>
      {results.map((r, i) => {
        const b = Object.fromEntries(r.kpis_base.map(k => [k.id, k]))
        return <section key={i} style={{ marginTop: 18 }}>
          <h3>4–6. Senaryo: {r.scenario.scenario_name}</h3>
          <p className="small">Temel durum: <b>{r.base_label}</b> · Zaman: {r.time.replace('T', ' ')} (güneş yüksekliği {r.sun.elevation.toFixed(1)}°, azimut {r.sun.azimuth.toFixed(1)}°) ·
            analiz alanı {fmt(r.area_m2, 'm²')} · veri güveni: <b>{r.confidence}</b></p>
          {r.notes.map(n => <div className="info small" key={n}>{n}</div>)}
          <h4>7. Kullanılan parametreler</h4>
          <ul className="plain small">{r.scenario.interventions.map((iv, j) => <li key={j}><b>{iv.type}</b>: {Object.entries(iv).filter(([k]) => k !== 'type' && k !== 'geometry').map(([k, v]) => `${k}: ${v}`).join('; ')}</li>)}
            {r.log.map(l => <li key={l}>{l}</li>)}{r.warnings.map(w => <li key={w}><b>Uyarı:</b> {w}</li>)}</ul>
          <h4>8–9. Yöntem ve sonuçlar</h4>
          <div className="tablewrap"><table className="t"><thead><tr><th>Gösterge</th><th className="num">Temel</th><th className="num">Senaryo</th><th className="num">Fark</th><th>Yöntem</th><th>Formül</th></tr></thead>
            <tbody>{r.kpis_scenario.map(k => { const u = k.unit !== '—' ? k.unit : ''; return <tr key={k.id}><td>{k.label}</td><td className="num">{fmt(b[k.id]?.value)} {u}</td>
              <td className="num">{fmt(k.value)} {u}</td><td className="num">{r.deltas[k.id] ?? '—'}</td><td><span className={`badge ${k.method}`}>{METHOD_LABEL[k.method]}</span></td><td className="small">{k.explain.formul}</td></tr> })}</tbody></table></div>
          <h4>Değerlendirme</h4>
          <ul className="plain small">{r.narrative.map(n => <li key={n}>{n}</li>)}</ul>
          <h4>Literatür tabanlı etki aralıkları</h4>
          <ul className="plain small">{r.literature_effects.length ? r.literature_effects.map((e, j) => <li key={j}>{e.text} <span className="badge literature">güven: {e.confidence}</span></li>) : <li>Uygulanabilir literatür parametresi yok.</li>}</ul>
          <div className="grid2">
            <div><h4>Pozitif etkiler</h4><ul className="plain small">{r.impacts.positive.map(x => <li key={x.text}>{x.text} <span className="muted">[{x.basis}]</span></li>)}</ul></div>
            <div><h4>Olası olumsuz etkiler</h4><ul className="plain small">{r.impacts.negative.map(x => <li key={x.text}>{x.text} <span className="muted">[{x.basis}]</span></li>)}</ul></div>
            <div><h4>Etkilenen alanlar</h4><ul className="plain small">{r.impacts.affected.map(x => <li key={x.text}>{x.text}</li>)}</ul></div>
            <div><h4>Etkilenen paydaşlar</h4><div className="small">{r.impacts.stakeholders.map(s => s.name).join(' · ')}</div></div>
          </div>
          <h4>10. Harita (şematik)</h4>
          <img src={maps[i]} alt={`${r.scenario.scenario_name} şematik haritası`} style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 6 }} />
          <div className="muted small">Yüzey sınıfları (yeşil, sert zemin, asfalt, bina, su) · koyu lacivert: temel gölge · mavi: yeni gölge · turuncu: müdahale alanı ·
            yeşil daire: yeni ağaç · gri: gölgeleme elemanı · kırmızı: etkilenen aktarma güzergâhı · mor: önerilen güzergâh.</div>
        </section>
      })}
      <h3 style={{ marginTop: 18 }}>11. Grafik</h3>
      <Chart option={t => {
        const ids: [string, string][] = [['yesil_oran', 'Yeşil %'], ['golge_oran', 'Gölge %'], ['sert_oran', 'Sert zemin %'], ['agac_tac_oran', 'Taç örtüsü %'], ['gecirgen_oran', 'Geçirgen %']]
        const v = (ks: any[], id: string) => ks.find(k => k.id === id)?.value ?? null
        return {
          grid: { left: 40, right: 10, top: 34, bottom: 30 }, legend: { top: 0, textStyle: { color: t.ink2 } }, tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: ids.map(x => x[1]), axisLabel: { color: t.ink2 } },
          yAxis: { type: 'value', axisLabel: { color: t.ink2 }, splitLine: { lineStyle: { color: t.grid } } },
          series: results.flatMap((r, i) => [
            ...(i === 0 ? [] : []),
            { name: `${r.scenario.scenario_name} – önce`, type: 'bar' as const, data: ids.map(([id]) => v(r.kpis_base, id)), itemStyle: { borderRadius: [4, 4, 0, 0] } },
            { name: `${r.scenario.scenario_name} – sonra`, type: 'bar' as const, data: ids.map(([id]) => v(r.kpis_scenario, id)), itemStyle: { borderRadius: [4, 4, 0, 0] } },
          ]).slice(0, 5),
        }
      }} />
      <div className="muted small">Her senaryo kendi müdahale çevresindeki analiz alanında “önce/sonra” gösterilir (en fazla 5 seri).</div>
      <h3>12. Varsayımlar</h3>
      <div className="tablewrap"><table className="t"><thead><tr><th>Varsayım</th><th>Değer</th><th>Kullanım</th></tr></thead>
        <tbody>{lit?.assumptions.map((a: any) => <tr key={a.id}><td>{a.ad}</td><td>{String(a.deger)} {a.birim ?? ''}</td><td className="small">{a.kullanim}</td></tr>)}</tbody></table></div>
      <h3>13. Belirsizlikler</h3>
      <ul className="plain small">
        <li>Uydu yüzey sıcaklığı (LST), meteorolojik veri ve yaya sayımı veri setinde yoktur; termal konfor (Tmrt/UTCI/PET) hesaplanmamıştır.</li>
        <li>Mevcut durumda sert zemin, kalan alan olarak türetilmiştir; asfalt/taş ayrımı yapılamamıştır.</li>
        <li>Proje durumunda taramasız döşeme alanları desen çizgisi yoğunluğundan çıkarılmıştır.</li>
        <li>Yürüme mesafeleri, taşıt yolları ayrıştırılamadığından iyimser alt sınırdır; metro giriş/şaft ayrımı doğrulanamamıştır.</li>
        <li>Gölge geometrik hesaptır: yatay zemin, opak taç ve bulutsuz gökyüzü varsayılmıştır.</li>
      </ul>
      <h3>14. Literatür kaynakları</h3>
      <div className="tablewrap"><table className="t"><thead><tr><th>Parametre</th><th>Değer</th><th>Kaynak</th><th>Güven</th></tr></thead>
        <tbody>{lit?.parameters.filter((p: any) => !used.size || used.has(p.id)).map((p: any) => <tr key={p.id}><td>{p.parametre}</td>
          <td>{p.tanimlanmamis ? 'Literatür parametresi tanımlanmamış' : `${p.deger[0]}${p.deger[1] !== p.deger[0] ? '–' + p.deger[1] : ''} ${p.birim}`}</td>
          <td className="small">{lit.sources[p.kaynak]?.kunye ?? '—'}</td><td>{p.guven ?? '—'}</td></tr>)}</tbody></table></div>
      <h3>Tablo (CSV)</h3>
      <div className="btns"><Copy text={csvText} label="CSV'yi kopyala" /></div>
      <textarea id="csv-out" readOnly value={csvText} rows={6} style={{ width: '100%', marginTop: 6, fontFamily: 'Consolas, monospace', fontSize: 11 }} />
    </div>}
  </div>
}
