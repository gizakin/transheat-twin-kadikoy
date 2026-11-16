import Chart from '../components/Chart'
import { KpiCard, LOWER_IS_BETTER, METHOD_LABEL } from '../components/ui'
import type { Kpi, ScenarioResult, StateKpis } from '../types'

const GROUP_ORDER = ['Kentsel tasarım', 'Gölge', 'Isı', 'Ulaşım']

export function Groups({ kpis, base, deltas, onExplain }: { kpis: Kpi[]; base?: Record<string, Kpi>; deltas?: Record<string, number | null>; onExplain: (k: Kpi) => void }) {
  return <>{GROUP_ORDER.map(g => {
    const ks = kpis.filter(k => k.group === g && k.id !== 'alan')
    if (!ks.length) return null
    return <div className="section" key={g}><h3>{g}</h3><div className="kpis">
      {ks.map(k => <KpiCard key={k.id} k={k} base={base?.[k.id]} delta={deltas?.[k.id]} onExplain={onExplain} better={LOWER_IS_BETTER.has(k.id) ? 'down' : 'up'} />)}
    </div></div>
  })}</>
}

const n1 = (v: number) => v.toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

/** Heat-layer card: legend in °C, site statistics and an observation summary derived from the data. */
export function HeatInfo({ heat }: { heat: any }) {
  const st = heat.stats ?? {}
  const y = heat.yorum
  return <div className="small">
    <div><b>{heat.name}</b></div>
    <div className="heat-ramp" aria-hidden="true" />
    <div className="heat-ticks"><span>{n1(st.p2)} °C</span><span>{n1((st.p2 + st.p98) / 2)} °C</span><span>{n1(st.p98)} °C</span></div>
    <div>Çalışma alanında: min {n1(st.min)} · ortalama <b>{n1(st.ortalama)}</b> · maks {n1(st.max)} °C ({st.piksel} piksel)</div>
    <div className="muted">Sıcak nokta eşiği (%{st.esik_p} dilim): {n1(st.esik_deger)} °C · Katmanı açmak için sol listeden “Isı haritası (uydu LST)”.</div>
    {y && <details style={{ marginTop: 6 }} open>
      <summary><b>Verinin söyledikleri</b> <span className="badge data">Veri tabanlı gözlem</span></summary>
      <ul className="plain">
        <li>Çalışma alanının kara pikselleri ortalama <b>{n1(y.calisma_alani_kara.ortalama)} °C</b>; çevredeki 1,5 km'lik kıyıdan uzak kent dokusu <b>{n1(y.cevre_1500m_kiyi_disi.ortalama)} °C</b>
          (fark {n1(y.cevre_1500m_kiyi_disi.ortalama - y.calisma_alani_kara.ortalama)} °C).</li>
        <li>Kıyıya 60 m'den yakın pikseller ortalama <b>{n1(y.gruplar['kıyıya ≤ 60 m'].ortalama)} °C</b>, 120 m'den uzak olanlar <b>{n1(y.gruplar['kıyıya > 120 m'].ortalama)} °C</b>:
          alandaki farkın büyük kısmını denize yakınlık açıklıyor (basit modelde R² {y.regresyon.r2}).</li>
        <li>En sıcak %10 ({y.sicak_noktalar.piksel} piksel, ≥ {n1(y.sicak_noktalar.esik_p90_C)} °C) büyük ölçüde sert zemin (ortalama %{Math.round(y.sicak_noktalar.mevcut_sert_ort * 100)}):
          sahildeki açık otopark (İSPARK) ile Rıhtım Caddesi boyunca otobüs/araç alanları. Bu piksellerde proje yeşil payı %{Math.round(y.sicak_noktalar.mevcut_yesil_ort * 100)} → %{Math.round(y.sicak_noktalar.proje_yesil_ort * 100)}.</li>
        <li>Bu çözünürlükte (≈23×30 m; termal bandın doğal çözünürlüğü 100 m) yeşil alan ve ağaç taçlarının etkisi denize yakınlıktan ayrıştırılamıyor; ilişki kesitseldir, nedensellik göstermez.</li>
      </ul>
    </details>}
    <div className="muted">{heat.metadata?.not ?? 'Uydu LST yüzey (deri) sıcaklığıdır; hava sıcaklığı veya termal konfor değildir.'}</div>
  </div>
}

export function StatePanel({ s, profile, onExplain, heat }: {
  s: StateKpis | null; profile: { mevcut?: any[]; proje?: any[] }; onExplain: (k: Kpi) => void; heat: any
}) {
  if (!s) return <div className="empty">Göstergeler hesaplanıyor…</div>
  return <>
    <div className="section">
      <h3>{s.label}</h3>
      <div className="small">Analiz alanı (kara): <b>{(s.kpis.find(k => k.id === 'alan')?.value as number)?.toLocaleString('tr-TR')} m²</b> · güneş yüksekliği {s.sun.elevation.toFixed(1)}°</div>
      {s.notes.map(n => <div className="note" key={n}>{n}</div>)}
      <div className="info">Gölge güneş geometrisiyle (bulutsuz gökyüzü) hesaplanır. O saatteki bulutluluk ve güneşlenme “Hava durumu (Open-Meteo)” bölümündedir.</div>
    </div>
    {heat && <div className="section"><h3>Isı haritası (uydu LST)</h3>
      {heat.available ? <HeatInfo heat={heat} /> : <div className="note">{heat.message}</div>}
    </div>}
    <Groups kpis={s.kpis} onExplain={onExplain} />
    {(profile.mevcut || profile.proje) && <div className="section"><h3>Gün içi gölge profili</h3>
      <Chart height={220} option={t => ({
        grid: { left: 40, right: 12, top: 28, bottom: 28 },
        legend: { top: 0, textStyle: { color: t.ink2 }, itemWidth: 14 },
        tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v} %` },
        xAxis: { type: 'category', data: (profile.mevcut ?? profile.proje)!.map((r: any) => r.time.slice(11, 16)), axisLabel: { color: t.ink2 }, axisLine: { lineStyle: { color: t.grid } } },
        yAxis: { type: 'value', name: '% gölge', nameTextStyle: { color: t.ink2 }, axisLabel: { color: t.ink2 }, splitLine: { lineStyle: { color: t.grid } } },
        series: [
          ...(profile.mevcut ? [{ name: 'Mevcut', type: 'line' as const, data: profile.mevcut.map((r: any) => r.golge_oran), symbolSize: 8, lineStyle: { width: 2 } }] : []),
          ...(profile.proje ? [{ name: 'Proje', type: 'line' as const, data: profile.proje.map((r: any) => r.golge_oran), symbolSize: 8, lineStyle: { width: 2 } }] : []),
        ],
      })} />
      <div className="muted small">Geometrik hesaplama · tüm çalışma alanı · seçili tarih.</div>
    </div>}
  </>
}

export function ScenarioResultPanel({ r, onExplain, onShow, onClose }: { r: ScenarioResult; onExplain: (k: Kpi) => void; onShow: () => void; onClose: () => void }) {
  const base = Object.fromEntries(r.kpis_base.map(k => [k.id, k]))
  return <>
    <div className="section">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Sonuç: {r.scenario.scenario_name}</h3>
        <button className="btn small" style={{ flex: 'none' }} onClick={onClose}>Kapat</button></div>
      <div className="small">Temel: {r.base_label} · {r.time.replace('T', ' ')} · analiz alanı {r.area_m2.toLocaleString('tr-TR')} m²</div>
      <div className="small">Veri güveni: <b>{r.confidence}</b> · Yöntemler: {r.methods.map(m => METHOD_LABEL[m]).join(', ')}</div>
      <div className="btns" style={{ marginTop: 6 }}><button className="btn primary small" onClick={onShow}>Etkilenen alanları haritada göster</button></div>
      {r.warnings.map(w => <div className="note" key={w}>{w}</div>)}
      <ul className="plain small">{r.log.map(l => <li key={l}>{l}</li>)}</ul>
    </div>
    <div className="section"><h3>Mevcut durum → Müdahale → Beklenen sonuç</h3>
      <ul className="plain">{r.narrative.map(n => <li key={n}>{n}</li>)}</ul>
      {r.notes.map(n => <div className="info" key={n}>{n}</div>)}
    </div>
    <Groups kpis={r.kpis_scenario} base={base} deltas={r.deltas} onExplain={onExplain} />
    <div className="section"><h3>Literatür tabanlı etki aralıkları</h3>
      {r.literature_effects.length ? r.literature_effects.map((e, i) => <div className="small" key={i} style={{ marginBottom: 8 }}>
        <span className="badge literature">Literatür tabanlı tahmin · güven: {e.confidence}</span><div>{e.text}</div></div>)
        : <div className="muted small">Bu müdahale için uygulanabilir literatür parametresi yok.</div>}
    </div>
    <div className="section"><h3>Etki analizi</h3>
      <b className="small">Pozitif etkiler</b>
      <ul className="plain small">{r.impacts.positive.map(i => <li key={i.text}>{i.text} <span className="muted">[{i.basis}]</span></li>)}{!r.impacts.positive.length && <li className="muted">—</li>}</ul>
      <b className="small">Olası olumsuz etkiler</b>
      <ul className="plain small">{r.impacts.negative.map(i => <li key={i.text}>{i.text} <span className="muted">[{i.basis}]</span></li>)}{!r.impacts.negative.length && <li className="muted">—</li>}</ul>
      <b className="small">Etkilenen alanlar</b>
      <ul className="plain small">{r.impacts.affected.map(i => <li key={i.text}>{i.text}</li>)}{!r.impacts.affected.length && <li className="muted">—</li>}</ul>
      <b className="small">Etkilenen paydaşlar</b>
      <div className="small">{r.impacts.stakeholders.map(s => s.name).join(' · ')}</div>
      <div className="muted small">Paydaşlar mekânsal kesişim ve müdahale türünden türetilmiştir; varsayım içerir.</div>
    </div>
  </>
}

/** Simulated heat map card: mode, view, statistics and the method in plain words. */
export function HeatSimPanel({ sim, mode, view, setMode, setView, title, onShowLayer, layerOn }: {
  sim: any; mode: 'local' | 'literature'; view: 'lst' | 'delta'; setMode: (m: 'local' | 'literature') => void; setView: (v: 'lst' | 'delta') => void
  title: string; onShowLayer: () => void; layerOn: boolean
}) {
  if (!sim?.available) return null
  const s = sim.stats, k = sim.kalibrasyon
  const f = (v: number, d = 1) => v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })
  return <div className="section">
    <h3>Isı simülasyonu · {title}</h3>
    <span className="badge literature">Literatür tabanlı tahmin · simülasyon, ölçüm değil</span>
    <div className="field" style={{ marginTop: 8 }}><label>Yöntem</label>
      <div className="seg">
        <button className={mode === 'local' ? 'on' : ''} onClick={() => setMode('local')}>Yerel kalibrasyon</button>
        <button className={mode === 'literature' ? 'on' : ''} onClick={() => setMode('literature')}>Literatür üst sınırı</button>
      </div></div>
    <div className="field"><label>Haritada göster</label>
      <div className="seg">
        <button className={view === 'lst' ? 'on' : ''} onClick={() => setView('lst')}>Simüle LST</button>
        <button className={view === 'delta' ? 'on' : ''} onClick={() => setView('delta')}>Değişim (ΔLST)</button>
      </div></div>
    {!layerOn && <button className="btn small" onClick={onShowLayer}>Isı katmanını aç</button>}
    {view === 'lst'
      ? <><div className="heat-ramp" aria-hidden="true" /><div className="heat-ticks"><span>{f(sim.p2)} °C</span><span>{f((sim.p2 + sim.p98) / 2)} °C</span><span>{f(sim.p98)} °C</span></div></>
      : <><div className="heat-ramp delta" aria-hidden="true" /><div className="heat-ticks"><span>−{f(sim.scaleMax)} °C (serinleme)</span><span>0</span><span>+{f(sim.scaleMax)} °C</span></div></>}
    <div className="small">
      <div>Çalışma alanı ortalaması: gözlem <b>{f(s.ort_gozlem)} °C</b> → simülasyon <b>{f(s.ort_sim)} °C</b> ({s.ort_sim - s.ort_gozlem <= 0 ? '' : '+'}{f(s.ort_sim - s.ort_gozlem, 2)} °C)</div>
      <div>Değişen piksel: {sim.changed} · değişen piksellerde ortalama {f(s.degisen_ort, 2)} °C · en fazla serinleme {f(s.en_fazla_serinleme, 1)} °C{s.en_fazla_isinma > 0 ? ` · en fazla ısınma +${f(s.en_fazla_isinma, 1)} °C` : ''}</div>
      <div>≥ {f(s.sicak_esik)} °C olan sıcak piksel: {s.sicak_gozlem} → {s.sicak_sim}</div>
    </div>
    <details style={{ marginTop: 6 }} className="small">
      <summary><b>Simülasyon nasıl yapıldı?</b></summary>
      <ul className="plain">
        <li>Başlangıç gözlemdir: Landsat LST 2025 (≈23×30 m piksel). Her pikselde mevcut ve {title.toLowerCase()} yüzey örtüsü 0,5 m'lik analiz ızgarasından 64 örnekle ölçülür.</li>
        {mode === 'local'
          ? <li><b>Yerel kalibrasyon:</b> ΔLST = β × Δ(bitki örtüsü payı). β = {k ? f(k.beta_veg_C_per_full_cover, 2) : '−1,54'} °C (bir pikselin tamamen bitkiyle kaplanması),
            %95 aralık {k ? `${f(k.beta_veg_ci95[0], 2)} … ${f(k.beta_veg_ci95[1], 2)}` : '—'} °C. β, aynı Landsat verisinde ortofoto kapsamındaki {k?.n_piksel ?? '—'} kara pikselinde
            LST'nin bitki örtüsü, bina payı ve kıyıya uzaklıkla ilişkisinden hesaplandı (R² {k?.r2 ?? '—'}). Bitki örtüsü = çim/bitkili yüzey ∪ ağaç tacı.</li>
          : <li><b>Literatür üst sınırı:</b> ΔLST = −24 °C × Δ(çim payı) − 19 °C × Δ(yeni ağaç tacı payı). Değerler Armson vd. (2012, Manchester) saha ölçümlerinde
            çimin ve ağaç gölgesinin en yüksek yüzey sıcaklığını <i>en fazla</i> düşürdüğü miktarlardır; piksel ortalamasına uygulanınca etkiyi büyük olasılıkla abartır.</li>}
        <li>Açık renkli kaplama (yalnızca mevcut malzeme asfalt/beton ve yeni albedo girildiyse): −4,5 K / +0,1 albedo × değişen pay (Santamouris 2013'ten türetilmiş, düşük güven).</li>
        <li>Gölgeleme elemanı ve fotovoltaik simüle edilmez: uydu elemanın çatısını görür, altındaki gölgeli zemini değil.</li>
        <li>Hava sıcaklığı veya termal konfor değildir; mevsim/saat ve meteoroloji değişmediği varsayılır. Kesitsel ilişkiden türetildiği için nedensel bir tahmin değildir.</li>
      </ul>
    </details>
  </div>
}
