import { Acc } from '../components/Acc'
import { TOGGLES } from '../map/layers'
import type { LayerMeta } from '../types'

/** Display groups of the layer list (the map bindings and ids stay as defined in map/layers). */
const GROUPS: [string, string[]][] = [
  ['Temel', ['boundary']],
  ['Kentsel yapı', ['surfaces', 'buildings', 'trees', 'project_extent', 'insitu']],
  ['Isı ve gölge', ['shadow', 'heat']],
  ['Ulaşım', ['transfer_points', 'iett_stops', 'bus_corridors', 'traffic', 'stop_access', 'minibus_lines', 'ferry_lines']],
  ['Yaya hareketliliği', ['peds', 'comfort', 'transfer_paths']],
  ['Kısıtlar', ['heritage', 'sit', 'ownership', 'infrastructure']],
  ['Senaryo ve öneriler', ['scenario']],
]
const TAG: Record<string, string> = { traffic: 'canlı', peds: 'simülasyon', heat: 'uydu' }

export default function LayerPanel({ visible, setVisible, uploads, meta }: {
  visible: Record<string, boolean>; setVisible: (v: Record<string, boolean>) => void; uploads: LayerMeta[]; meta: Record<string, LayerMeta>
}) {
  const tog = (id: string) => setVisible({ ...visible, [id]: !visible[id] })
  const titleFor = (id: string) => {
    const m = meta[id === 'trees' ? 'tree_crowns' : id]
    return m ? `${m.source} · ${m.date}${m.notes ? ' · ' + m.notes : ''}` : ''
  }
  const byId = Object.fromEntries(TOGGLES.map(t => [t.id, t]))
  const listed = new Set(GROUPS.flatMap(g => g[1]))
  const groups = [...GROUPS.map(([g, ids]) => [g, ids.filter(i => byId[i])] as [string, string[]]),
    ['Diğer', TOGGLES.filter(t => !listed.has(t.id)).map(t => t.id)] as [string, string[]]].filter(g => g[1].length)
  const nOn = TOGGLES.filter(t => visible[t.id]).length + uploads.filter(u => visible[u.id]).length
  return <Acc id="left.layers" title="Harita katmanları" icon="layers" count={`${nOn} açık`}>
    <div className="layers">
      {groups.map(([g, ids]) => <Acc key={g} sub id={`left.layers.${g}`} title={g} count={`${ids.filter(i => visible[i]).length}/${ids.length}`}>
        <div className="lyr">{ids.map(id => {
          const t = byId[id]
          return <label key={id} title={titleFor(id)}>
            <input type="checkbox" checked={!!visible[id]} onChange={() => tog(id)} />
            <span className="swatch" style={{ background: t.swatch }} />{t.label}{TAG[id] && <span className="tag">{TAG[id]}</span>}
          </label>
        })}</div>
      </Acc>)}
      {uploads.length > 0 && <Acc sub id="left.layers.uploads" title="Yüklenen veriler" count={`${uploads.filter(u => visible[u.id]).length}/${uploads.length}`}>
        <div className="lyr">{uploads.map(u => <label key={u.id} title={u.source}><input type="checkbox" checked={!!visible[u.id]} onChange={() => tog(u.id)} />
          <span className="swatch" style={{ background: '#0ea5e9' }} />{u.title}</label>)}</div></Acc>}
      <div className="small muted">Açık katmanların lejantı haritanın sol altındadır.</div>
    </div>
  </Acc>
}
