import { useState } from 'react'
import { buildLegend, type HeatLegend } from '../lib/figureContent'

/** Compact legend of the layers that are on, docked on the map (same content as the exported figure's legend). */
export default function MapLegend({ visible, heats, scenarioOn, busLine, raised }: {
  visible: Record<string, boolean>; heats: HeatLegend[]; scenarioOn: boolean; busLine: string | null; raised: boolean
}) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('transheat.legend') !== '0' } catch { return true } })
  const groups = buildLegend(visible, heats, scenarioOn)
  if (visible.peds) groups.push({ title: 'Yaya akışı (simülasyon)', items: [{ color: '#f2a33a', label: 'Güneşte yürüyen', kind: 'dot' }, { color: '#0b5f66', label: 'Gölgede yürüyen', kind: 'dot' }, { color: '#3b6fb6', label: 'Bekleyen yolcu', kind: 'dot' }] })
  if (busLine) groups.push({ title: `İETT hattı ${busLine}`, items: [{ color: '#2a78d6', label: 'Gidiş', kind: 'line' }, { color: '#d55181', label: 'Dönüş', kind: 'line' }] })
  if (!groups.length) return null
  const toggle = () => setOpen(o => { try { localStorage.setItem('transheat.legend', o ? '0' : '1') } catch { /* storage unavailable */ } return !o })
  return <div className={`map-legend ${raised ? 'raised' : ''} ${open ? 'open' : ''}`}>
    <button className="ml-head" onClick={toggle} aria-expanded={open}>Lejant <span aria-hidden="true">{open ? '▾' : '▸'}</span></button>
    {open && <div className="ml-body">{groups.map(g => <div key={g.title} className="ml-group">
      <h4>{g.title}</h4>
      {g.ramp ? <><div className="ml-ramp" style={{ background: `linear-gradient(90deg, ${g.ramp.colors.join(', ')})` }} />
        <div className="ml-ticks">{g.ramp.ticks.map((t, i) => <span key={i}>{t}</span>)}</div></>
        : <div className="ml-items">{g.items?.map(it => <span key={it.label}>
          <i className={`ml-sw ${it.kind ?? 'fill'}`} style={{ background: it.kind === 'dash' ? 'transparent' : it.color, borderColor: it.kind === 'dash' ? it.color : undefined }} />{it.label}</span>)}</div>}
    </div>)}</div>}
  </div>
}
