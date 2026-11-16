import { useState } from 'react'
import type { Kpi, Method } from '../types'

export const METHOD_LABEL: Record<Method, string> = {
  data: 'Veri tabanlı gözlem',
  geometric: 'Geometrik hesaplama',
  literature: 'Literatür tabanlı tahmin',
  assumption: 'Varsayım',
  model: 'Model tabanlı sonuç',
}

export function Badge({ m }: { m: Method }) {
  return <span className={`badge ${m}`} title={METHOD_LABEL[m]}>{METHOD_LABEL[m]}</span>
}

export function fmt(v: unknown, unit = '') {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    const s = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('tr-TR') : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
    return unit ? `${s} ${unit}` : s
  }
  return String(v)
}

export function KpiCard({ k, base, delta, onExplain, better = 'up' }: {
  k: Kpi; base?: Kpi; delta?: number | null; onExplain: (k: Kpi) => void; better?: 'up' | 'down'
}) {
  const numeric = typeof k.value === 'number'
  const good = delta != null && delta !== 0 ? ((delta > 0) === (better === 'up')) : null
  return (
    <div className="kpi">
      <div className="lbl">{k.label}</div>
      <div className={`val ${numeric ? '' : 'text'}`}>
        {numeric ? <>{fmt(k.value)}<small>{k.unit !== '—' ? k.unit : ''}</small></> : String(k.value)}
      </div>
      {base && delta != null && (
        <div className={`delta ${good === null ? 'muted' : good ? 'pos' : 'neg'}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {fmt(Math.abs(delta))} {k.unit === '%' ? 'puan' : k.unit} <span className="muted">(önce {fmt(base.value)})</span>
        </div>
      )}
      <div className="foot"><Badge m={k.method} /><button className="how" onClick={() => onExplain(k)}>Nasıl hesaplandı?</button></div>
    </div>
  )
}

export function ExplainModal({ k, onClose, sources }: { k: Kpi | null; onClose: () => void; sources?: Record<string, any> }) {
  if (!k) return null
  const e = k.explain
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={ev => ev.stopPropagation()}>
        <header><div><h3>Bu sonuç nasıl hesaplandı?</h3><div className="muted small">{k.label}</div></div><Badge m={k.method} /></header>
        <div className="body">
          <dl>
            <dt>Değer</dt><dd><b>{fmt(k.value, k.unit !== '—' ? k.unit : '')}</b></dd>
            <dt>Yöntem</dt><dd>{METHOD_LABEL[k.method]}</dd>
            <dt>Veri kaynağı</dt><dd>{e.veri_kaynagi || '—'}</dd>
            <dt>Veri tarihi</dt><dd>{e.veri_tarihi || '—'}</dd>
            <dt>Kullanılan parametre</dt><dd>{e.parametre || '—'}</dd>
            <dt>Formül / model</dt><dd><code>{e.formul || '—'}</code></dd>
            <dt>Literatür kaynağı</dt><dd>{e.literatur?.length ? e.literatur.map(s => sources?.[s]?.kunye ?? s).join('; ') : 'Kullanılmadı'}</dd>
            <dt>Varsayımlar</dt><dd>{e.varsayim?.length ? <ul className="plain">{e.varsayim.map(a => <li key={a.ad}><b>{a.ad}</b>: {String(a.deger)} {a.birim ?? ''} — {a.kullanim}</li>)}</ul> : 'Yok'}</dd>
            <dt>Belirsizlik</dt><dd>{e.belirsizlik || '—'}</dd>
          </dl>
        </div>
      </div>
    </div>
  )
}

export function useExplain() {
  const [k, setK] = useState<Kpi | null>(null)
  return { k, open: setK, close: () => setK(null) }
}

// KPIs where a decrease is the desirable direction
export const LOWER_IS_BETTER = new Set(['sert_oran', 'gunes_acik_sert_m2', 'aktarma_ort_mesafe'])
