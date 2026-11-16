import { useEffect, useState } from 'react'
import { api } from '../api'
import Chart from '../components/Chart'
import { Badge, fmt } from '../components/ui'

const ROWS: [string, string][] = [
  ['yesil_oran', 'Yeşil alan (%)'], ['agac_tac_oran', 'Ağaç taç örtüsü (%)'], ['golge_oran', 'Gölge alanı (%)'], ['golgeli_yaya_m2', 'Gölgeli yaya alanı (m²)'],
  ['sert_oran', 'Sert zemin (%)'], ['gecirgen_oran', 'Geçirgen yüzey (%)'], ['gunes_acik_sert_m2', 'Isı maruziyeti: güneşe açık sert zemin (m²)'],
  ['agac_sayisi', 'Ağaç sayısı'], ['aktarma_ort_mesafe', 'Yaya mesafesi: ort. aktarma (m)'], ['aktarma_golge', 'Aktarma güzergâhı gölgeli pay (%)'],
  ['albedo', 'Albedo (tanımlı yüzeyler)'], ['termal_konfor', 'Termal konfor'], ['lst', 'Uydu yüzey sıcaklığı'],
]
const CHART_ROWS = ['yesil_oran', 'agac_tac_oran', 'golge_oran', 'sert_oran', 'gecirgen_oran', 'aktarma_golge']

export default function ComparePage({ time }: { time: string }) {
  const [list, setList] = useState<{ id: string; name: string; created_at: string }[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [radarCol, setRadarCol] = useState(1)

  const [loaded, setLoaded] = useState(false)
  useEffect(() => { api.scenarios().then(l => { setList(l); setSel(l.slice(-3).map(s => s.id)); setLoaded(true) }) }, [])
  const run = () => { setBusy(true); setErr(''); api.compare(sel, time).then(setData).catch(e => setErr(e.message)).finally(() => setBusy(false)) }
  // recompute when the scenario list has loaded, the selection changes or the time changes
  useEffect(() => { if (loaded) run() }, [loaded, time, sel.join(',')])

  const cols: any[] = data?.columns ?? []
  const val = (c: any, id: string) => c.kpis.find((k: any) => k.id === id)
  const num = (c: any, id: string) => { const v = val(c, id)?.value; return typeof v === 'number' ? v : null }
  const letter = (i: number) => i < 2 ? cols[i].name : `Senaryo ${String.fromCharCode(63 + i)}`

  return <div className="page">
    <h2>Senaryo karşılaştırma</h2>
    <div className="muted">Sistem "en iyi senaryo" hükmü vermez ve sıralama yapmaz; değişimleri ve dayanaklarını gösterir.</div>
    <div className="card">
      <h3>Karşılaştırılacak kayıtlı senaryolar</h3>
      {!list.length && <div className="muted">Henüz kayıtlı senaryo yok. Harita ekranında bir senaryo çalıştırıp “Senaryoyu Kaydet”e basın. Mevcut ve Proje sütunları yine de gösterilir.</div>}
      <div className="btns">{list.map(s => <label key={s.id} className="small" style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 12 }}>
        <input type="checkbox" checked={sel.includes(s.id)} onChange={() => setSel(sel.includes(s.id) ? sel.filter(x => x !== s.id) : [...sel, s.id].slice(-3))} />{s.name}</label>)}</div>
      <div className="btns" style={{ marginTop: 8 }}><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Hesaplanıyor…' : 'Karşılaştır'}</button>
        <span className="muted small">En fazla 3 senaryo · zaman: {time.replace('T', ' ')}{data && ` · güneş yüksekliği ${data.sun.elevation.toFixed(1)}°`}</span></div>
      {err && <div className="note">{err}</div>}
    </div>

    {data && <>
      <div className="card">
        <h3>Gösterge tablosu</h3>
        <div className="muted small">{data.note}</div>
        <table className="t"><thead><tr><th>Gösterge</th>{cols.map((c, i) => <th className="num" key={c.id}>{letter(i)}<div className="muted small" style={{ fontWeight: 400 }}>{i >= 2 ? c.name : ''}</div></th>)}<th>Yöntem</th></tr></thead>
          <tbody>{ROWS.map(([id, l]) => <tr key={id}><td>{l}</td>{cols.map(c => { const k = val(c, id); return <td className="num" key={c.id}>{k ? (typeof k.value === 'number' ? fmt(k.value) : <span className="muted small">{String(k.value)}</span>) : '—'}</td> })}
            <td>{val(cols[0], id) && <Badge m={val(cols[0], id).method} />}</td></tr>)}</tbody></table>
      </div>

      {cols.length > 1 && <div className="card">
        <h3>Çok kriterli karşılaştırma (Mevcut duruma göre)</h3>
        <table className="t"><thead><tr><th>Kriter</th>{cols.slice(1).map((c, i) => <th key={c.id} className="num">{letter(i + 1)}</th>)}</tr></thead>
          <tbody>
            {[['yesil_oran', 'Yeşil alan değişimi'], ['golge_oran', 'Gölge alanı'], ['agac_tac_oran', 'Ağaç taç örtüsü'], ['aktarma_ort_mesafe', 'Yaya mesafesi'],
              ['sert_oran', 'Sert zemin'], ['gunes_acik_sert_m2', 'Isı maruziyeti (güneşe açık sert zemin)']].map(([id, l]) =>
              <tr key={id}><td>{l}</td>{cols.slice(1).map(c => <td key={c.id} className="num"><b>{c.symbols?.[id] ?? '0'}</b></td>)}</tr>)}
            <tr><td>Termal konfor</td>{cols.slice(1).map(c => <td key={c.id} className="num muted small">{c.literature_effects?.length ? 'yalnız literatür aralığı' : 'hesaplanmadı'}</td>)}</tr>
            <tr><td>Veri güveni</td>{cols.slice(1).map(c => <td key={c.id} className="num">{c.confidence}</td>)}</tr>
          </tbody></table>
        <div className="muted small">+ / − işaretleri, göstergenin istenen yönündeki (ör. sert zemin ve mesafe için azalma) göreli değişimi gösterir; 0: %1'den az. Semboller yalnızca hesaplanan değerlerden üretilir.</div>
      </div>}

      <div className="grid2">
        <div className="card"><h3>Gösterge karşılaştırması (%)</h3>
          <Chart option={t => ({
            grid: { left: 40, right: 10, top: 34, bottom: 60 },
            legend: { top: 0, textStyle: { color: t.ink2 } },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'category', data: CHART_ROWS.map(r => ROWS.find(x => x[0] === r)![1].replace(' (%)', '')), axisLabel: { color: t.ink2, interval: 0, rotate: 25 }, axisLine: { lineStyle: { color: t.grid } } },
            yAxis: { type: 'value', axisLabel: { color: t.ink2 }, splitLine: { lineStyle: { color: t.grid } } },
            series: cols.map((c, i) => ({ name: letter(i), type: 'bar', barGap: '8%', data: CHART_ROWS.map(r => num(c, r)), itemStyle: { borderRadius: [4, 4, 0, 0], borderColor: t.surface, borderWidth: 1 } })),
          })} />
        </div>
        <div className="card"><h3>Radar: Mevcut ve seçili sütun</h3>
          <div className="field" style={{ maxWidth: 240 }}><select value={radarCol} onChange={e => setRadarCol(Number(e.target.value))}>
            {cols.slice(1).map((c, i) => <option key={c.id} value={i + 1}>{letter(i + 1)}</option>)}</select></div>
          {cols[radarCol] && <Chart height={280} option={t => {
            const ids = CHART_ROWS
            const mx = ids.map(id => Math.max(1, ...cols.map(c => num(c, id) ?? 0)))
            return {
              legend: { bottom: 0, textStyle: { color: t.ink2 } },
              tooltip: {},
              radar: { indicator: ids.map((id, i) => ({ name: ROWS.find(r => r[0] === id)![1].replace(' (%)', ''), max: Math.ceil(mx[i] * 1.1) })),
                axisName: { color: t.ink2, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } }, splitArea: { show: false }, axisLine: { lineStyle: { color: t.grid } } },
              series: [{ type: 'radar', symbolSize: 8, lineStyle: { width: 2 }, data: [
                { name: letter(0), value: ids.map(id => num(cols[0], id) ?? 0), itemStyle: { color: t.series[0] } },
                { name: letter(radarCol), value: ids.map(id => num(cols[radarCol], id) ?? 0), itemStyle: { color: t.series[1] } }] }],
            }
          }} />}
          <div className="muted small">Her eksen, sütunlar arasındaki en büyük değere göre ölçeklenir. Sert zemin ekseninde düşük değer istenen yöndür.</div>
        </div>
      </div>

      {cols.length > 1 && <div className="card"><h3>Göreli değişim matrisi (Mevcut duruma göre, %)</h3>
        <Chart height={60 + 34 * CHART_ROWS.length} option={t => {
          const ys = CHART_ROWS.map(r => ROWS.find(x => x[0] === r)![1].replace(' (%)', ''))
          const pts: [number, number, number | null][] = []
          cols.slice(1).forEach((c, i) => CHART_ROWS.forEach((r, j) => {
            const a = num(cols[0], r), b = num(c, r)
            pts.push([i, j, a && b != null ? Math.round(1000 * (b - a) / a) / 10 : null])
          }))
          const m = Math.max(1, ...pts.map(p => Math.abs(p[2] ?? 0)))
          return {
            grid: { left: 190, right: 20, top: 10, bottom: 50 },
            tooltip: { formatter: (p: any) => `${ys[p.value[1]]} · ${letter(p.value[0] + 1)}: ${p.value[2] ?? '—'} %` },
            xAxis: { type: 'category', data: cols.slice(1).map((_, i) => letter(i + 1)), axisLabel: { color: t.ink2 }, splitArea: { show: false } },
            yAxis: { type: 'category', data: ys, axisLabel: { color: t.ink2 } },
            visualMap: { min: -m, max: m, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, textStyle: { color: t.ink2 },
              inRange: { color: [t.divNeg, t.divMid, t.divPos] } },
            series: [{ type: 'heatmap', data: pts, label: { show: true, color: t.ink, formatter: (p: any) => p.value[2] == null ? '—' : `${p.value[2] > 0 ? '+' : ''}${p.value[2]}` },
              itemStyle: { borderColor: t.surface, borderWidth: 2 } }],
          }
        }} />
        <div className="muted small">Mavi: artış, kırmızı: azalış (göstergenin istenen yönünden bağımsız). Gri: değişim yok.</div>
      </div>}

      <div className="card"><h3>Açıklamalar</h3>
        {cols.slice(2).map((c, i) => <div key={c.id} style={{ marginBottom: 10 }}><b>{letter(i + 2)}: {c.name}</b>
          <ul className="plain small">{(c.narrative ?? []).map((n: string) => <li key={n}>{n}</li>)}</ul>
          {(c.literature_effects ?? []).map((e: any, j: number) => <div key={j} className="small"><span className="badge literature">Literatür · güven {e.confidence}</span> {e.text}</div>)}
        </div>)}
        {cols.length <= 2 && <div className="muted">Senaryo seçilmedi.</div>}
        <div className="muted small">Açıklamalar, senaryonun kendi müdahale çevresi analizinden gelir; tablo değerleri tüm çalışma alanı içindir.</div>
      </div>
    </>}
  </div>
}
