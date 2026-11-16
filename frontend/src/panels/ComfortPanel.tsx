import { useMemo } from 'react'
import { sunState, type Weather } from '../engine/weather'
import type { Exposure } from '../engine/trafficLink'
import { MIN_STRETCH_M, WALK_SPEED, type ComfortPath, type ComfortProfile, type Stretch } from '../engine/comfort'

// single-hue ramp: light = in the sun, dark = in the shade (colour never carries the value alone: cells have titles, details give numbers)
export const SHADE_RAMP: [number, string][] = [[0, '#f4ecd8'], [0.25, '#cfe3dc'], [0.5, '#8cc2b7'], [0.75, '#3f948a'], [1, '#0b5f66']]
export function shadeColor(v: number | null) {
  if (v == null) return '#d5d9dd'
  for (let i = 1; i < SHADE_RAMP.length; i++) if (v <= SHADE_RAMP[i][0]) {
    const [a, ca] = SHADE_RAMP[i - 1], [b, cb] = SHADE_RAMP[i]
    const t = (v - a) / (b - a)
    const mix = (k: number) => Math.round(parseInt(ca.slice(k, k + 2), 16) * (1 - t) + parseInt(cb.slice(k, k + 2), 16) * t).toString(16).padStart(2, '0')
    return `#${mix(1)}${mix(3)}${mix(5)}`
  }
  return SHADE_RAMP[SHADE_RAMP.length - 1][1]
}

const PAIR_LABEL: Record<string, string> = {
  'iskele→metro': 'İskele → Metro', 'iskele→otobus': 'İskele → Otobüs', 'metro→otobus': 'Metro → Otobüs', 'iskele→minibus': 'İskele → Dolmuş', 'metro→minibus': 'Metro → Dolmuş',
}
const short = (s: string) => s.replace(/M4 Kadıköy yapısı (\d+).*/, 'M4 yapısı $1').replace(/\s*\(.*?\)\s*/g, ' ').trim()
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const n1 = (x: number) => x.toLocaleString('tr-TR', { maximumFractionDigits: 1 })
const pct = (v: number | null) => (v == null ? '—' : `%${Math.round(v * 100)}`)

function bestWorst(p: ComfortPath, hours: number[]) {
  const day = p.shade.map((v, i) => ({ v, h: hours[i] })).filter(x => x.v != null && x.h >= 8 && x.h <= 19) as { v: number; h: number }[]
  if (!day.length) return null
  const best = day.reduce((a, b) => (b.v > a.v ? b : a)), worst = day.reduce((a, b) => (b.v < a.v ? b : a))
  return { best, worst }
}

export default function ComfortPanel({ prof, other, loading, hour, setHour, sel, setSel, onShow, onTry, weather, exposure }: {
  prof: ComfortProfile | null; other: ComfortProfile | null; loading: boolean; weather?: Weather | null
  exposure?: { byId: Record<number, Exposure>; time: string; live: boolean; isNow: boolean } | null
  hour: number; setHour: (h: number) => void; sel: number | null; setSel: (i: number | null) => void
  onShow: (s: Stretch) => void; onTry: (s: Stretch, p: ComfortPath) => void
}) {
  const hi = prof ? prof.hours.indexOf(hour) : -1
  const groups = useMemo(() => {
    const g = new Map<string, ComfortPath[]>()
    prof?.paths.forEach(p => g.set(p.pair, [...(g.get(p.pair) ?? []), p]))
    return [...g.entries()]
  }, [prof])
  if (!prof) return <div className="section"><h3>Yaya konforu</h3><div className="small muted">{loading ? 'Saatlik gölge hesaplanıyor (07:00–20:00)…' : 'Hazırlanıyor…'}</div></div>

  const now = hi >= 0 ? prof.paths.filter(p => p.shade[hi] != null) : []
  const meanNow = now.length ? now.reduce((s, p) => s + (p.shade[hi] as number) * p.dist_m, 0) / now.reduce((s, p) => s + p.dist_m, 0) : null
  const p = sel != null ? prof.paths[sel] : null
  const bw = p ? bestWorst(p, prof.hours) : null
  const op = p && other ? other.paths.find(o => o.from === p.from && o.to === p.to) : null
  const wx = weather && weather.date === prof.date ? weather : null
  const wHour = (h: number) => wx?.hours.find(x => Number(x.time.slice(11, 13)) === h) ?? null
  const wNow = hi >= 0 ? wHour(hour) : null
  const sunNow = wNow ? sunState(wNow.direct, `${prof.date}T${hh(hour)}`, wNow.precip) : null
  const expAll = exposure ? Object.values(exposure.byId) : []
  const expLen = expAll.reduce((s, e) => s + e.len, 0), expN = expAll.filter(e => e.len >= 1).length
  const allStretches = hi >= 0 ? prof.paths.flatMap(q => (q.stretches[hi] ?? []).map(s => ({ s, q }))).sort((a, b) => b.s.len - a.s.len).slice(0, 5) : []

  return <div className="section comfort">
    <h3>Yaya konforu · aktarma güzergâhları</h3>
    <div className="badges"><span className="badge geometric">Geometrik hesaplama</span><span className="badge data">Uydu yüzey sıcaklığı: gözlem</span></div>
    <div className="small muted">{prof.state} · {prof.date} · {prof.paths.length} güzergâh. “Konfor” burada güzergâhın gölgede kalan payıdır (bulutsuz gökyüzü). Tmrt, UTCI ve PET hesaplanmadı.</div>
    {hi < 0 ? <div className="note small">Seçili saat {hh(hour)} bu tablonun dışında (07:00–20:00).</div>
      : <div className="small" style={{ marginTop: 6 }}>Saat <b>{hh(hour)}</b>: güzergâhların uzunluk ağırlıklı ortalama gölgeli payı <b>{pct(meanNow)}</b>{prof.elev[hi] <= 0 ? ' (güneş ufkun altında)' : ''}.
        {wNow && <> Hava {wNow.temp != null ? `${n1(wNow.temp)} °C` : '—'}{wNow.app != null ? ` (hissedilen ${n1(wNow.app)} °C)` : ''}; {sunNow === 'sunny' ? 'güneş açık, gölge farkı belirgin' : sunNow === 'cloudy' ? 'güneş bulut arkasında, gölge farkı zayıf' : sunNow === 'rain' ? 'yağışlı, gölgeden çok yağıştan korunma önemli' : 'güneş yok'}.</>}</div>}

    {exposure && <div className="small" style={{ marginTop: 4 }}>Canlı trafik (İBB {exposure.time}{exposure.live ? '' : ', anlık görüntü'}): <b>{expN}</b> güzergâhta toplam <b>{Math.round(expLen)} m</b> yürüme yolu şu an “Yoğun/Çok yoğun” yol parçalarına ≤10 m.
      {!exposure.isNow && <span className="muted"> Trafik şu anki ölçümdür; seçili saatin trafiği değildir.</span>}</div>}
    <div className="comfort-grid" role="table" aria-label="Güzergâh ve saate göre gölgeli pay">
      <div className="cg-row cg-head" role="row"><span className="cg-label" />{prof.hours.map(h =>
        <button key={h} role="columnheader" className={`cg-h ${h === hour ? 'on' : ''}`} onClick={() => setHour(h)} title={`${hh(h)} saatine geç`}>{h}</button>)}</div>
      {wx && <>
        <div className="cg-row" role="row"><span className="cg-label muted" title="Open-Meteo: direkt normal ışınım ≥ 120 W/m² (WMO) ise güneş açık; saatlik yağış ≥ 0,1 mm ise yağışlı">Güneş/yağış</span>{prof.hours.map(h => {
          const w = wHour(h), s = w ? sunState(w.direct, `${prof.date}T${hh(h)}`, w.precip) : 'unknown'
          return <span key={h} className={`cg-c cg-sun ${s}`} title={`${hh(h)}: ${s === 'sunny' ? 'güneş açık' : s === 'cloudy' ? 'bulutlu (güneş kapalı)' : s === 'rain' ? `yağışlı (${w?.precip} mm)` : s === 'night' ? 'güneş yok' : 'belirsiz'}${w?.cloud != null ? `, bulutluluk %${w.cloud}` : ''}`} />
        })}</div>
        <div className="cg-row" role="row"><span className="cg-label muted">Sıcaklık °C</span>{prof.hours.map(h => {
          const w = wHour(h)
          return <span key={h} className="cg-t" title={w?.app != null ? `${hh(h)}: ${w.temp} °C, hissedilen ${w.app} °C` : ''}>{w?.temp != null ? Math.round(w.temp) : ''}</span>
        })}</div>
      </>}
      {groups.map(([pair, ps]) => <div key={pair}>
        <div className="cg-group">{PAIR_LABEL[pair] ?? pair}</div>
        {ps.map(q => <div key={q.id} role="row" className={`cg-row ${q.id === sel ? 'sel' : ''}`}>
          <button className="cg-label" onClick={() => setSel(q.id === sel ? null : q.id)} title={`${q.from} → ${q.to} · ${q.dist_m} m`}>{short(q.from)} → {short(q.to)}</button>
          {q.shade.map((v, i) => <button key={i} role="cell" className={`cg-c ${prof.hours[i] === hour ? 'now' : ''}`} style={{ background: shadeColor(v) }}
            title={`${short(q.from)} → ${short(q.to)} · ${hh(prof.hours[i])}: ${v == null ? 'güneş yok' : `${pct(v)} gölgede, ${n1(q.sunMin[i]!)} dk güneşte`}`}
            onClick={() => { setSel(q.id); setHour(prof.hours[i]) }} />)}
        </div>)}
      </div>)}
      <div className="cg-legend small"><span>Güneşte</span><i style={{ background: `linear-gradient(90deg, ${SHADE_RAMP.map(([, c]) => c).join(',')})` }} /><span>Gölgede</span>
        <i className="cg-night" /><span>güneş yok</span></div>
    </div>

    {p && <div className="comfort-detail">
      <b>{p.from} → {p.to}</b>
      <div className="small muted">{PAIR_LABEL[p.pair] ?? p.pair} · {p.dist_m} m · ≈{n1(p.dist_m / WALK_SPEED / 60)} dk yürüme <span className="badge assumption">Varsayım: {n1(WALK_SPEED)} m/s</span></div>
      {hi >= 0 && <div className="small" style={{ marginTop: 4 }}>{hh(hour)}: <b>{pct(p.shade[hi])}</b> gölgede{p.sunMin[hi] != null ? <> · <b>{n1(p.sunMin[hi]!)} dk</b> güneşte yürüme</> : null}
        {op && op.shade[hi] != null && <> · {other!.state.startsWith('Proje') ? 'Proje' : other!.state.startsWith('Mevcut') ? 'Mevcut' : other!.state}: <b>{pct(op.shade[hi])}</b></>}</div>}
      {bw && <div className="small">08:00–19:00 arasında en gölgeli saat <b>{hh(bw.best.h)}</b> ({pct(bw.best.v)}), en güneşli <b>{hh(bw.worst.h)}</b> ({pct(bw.worst.v)}).</div>}
      {exposure && exposure.byId[p.id] && <div className="small">Şu an sıkışık trafiğe bitişik (≤10 m) yürüme: <b>{Math.round(exposure.byId[p.id].len)} m</b> (%{Math.round((100 * exposure.byId[p.id].len) / Math.max(1, exposure.byId[p.id].tot))}){exposure.byId[p.id].len >= 1 ? ' — haritada bordo kesikli' : ''} <span className="muted">(İBB {exposure.time}; geometrik maruziyet göstergesi, sıcaklık değil)</span></div>}
      {p.lst != null && <div className="small">Güzergâh boyunca ortalama uydu yüzey sıcaklığı <b>{n1(p.lst)} °C</b> <span className="muted">(Landsat 2025, tek gündüz geçişi; hava sıcaklığı değildir)</span></div>}
      {hi >= 0 && <>
        <div className="grp" style={{ marginTop: 8 }}>Neler yapılabilir?</div>
        {(p.stretches[hi] ?? []).length ? (p.stretches[hi] ?? []).map((s, k) => <div key={k} className="comfort-act small">
          <span><b>{Math.round(s.len)} m</b> kesintisiz güneşte (≈{Math.round(s.len / WALK_SPEED)} sn)</span>
          <span><button className="how" onClick={() => onShow(s)}>haritada</button> · <button className="how" onClick={() => onTry(s, p)}>senaryoda ağaç dene</button></span>
        </div>) : <div className="small muted">Bu saatte {MIN_STRETCH_M} m'den uzun kesintisiz güneşli kesim yok.</div>}
        <div className="small muted" style={{ marginTop: 4 }}>“Senaryoda ağaç dene” kesimin iki yanına 3 m'lik bir şerit çizip ağaçlandırma müdahalesi ekler; etkisi “Senaryoyu Çalıştır” ile hesaplanır. Etkinin büyüklüğü önceden varsayılmaz.</div>
      </>}
    </div>}

    {!p && allStretches.length > 0 && <div style={{ marginTop: 8 }}>
      <div className="grp">Bu saatte gölge en çok gereken kesimler</div>
      {allStretches.map(({ s, q }, k) => <div key={k} className="comfort-act small">
        <span><b>{Math.round(s.len)} m</b> · {short(q.from)} → {short(q.to)}</span>
        <span><button className="how" onClick={() => { setSel(q.id); onShow(s) }}>göster</button> · <button className="how" onClick={() => onTry(s, q)}>ağaç dene</button></span>
      </div>)}
      <div className="small muted">Bir güzergâh seçmek için tablodaki satıra tıklayın.</div>
    </div>}
  </div>
}
