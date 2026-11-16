import type { Intervention, ScenarioDef, Selection } from '../types'
import type { DrawMode } from '../map/MapView'
import { fmt } from '../components/ui'
import { Acc } from '../components/Acc'

export const IV_LABELS: Record<string, string> = {
  tree_planting: 'Ağaçlandırma',
  green_conversion: 'Yeşil alan',
  hard_reduction: 'Sert zemini azalt',
  shade_structure: 'Gölgeleme elemanı',
  pv_shading: 'Fotovoltaik gölgeleme',
  permeable_surface: 'Geçirgen yüzey',
  cool_pavement: 'Açık renkli / cool pavement',
  surface_change: 'Zemin malzemesi değişimi',
  pedestrian_route: 'Yaya güzergâhı',
  transfer_area: 'Aktarma alanı',
}

const MATERIALS: Record<string, string> = {
  asfalt: 'Asfalt', beton: 'Beton', granit: 'Granit plak taş', bazalt: 'Bazalt plak taş', acik_renkli: 'Açık renkli kaplama',
  gecirgen_beton: 'Geçirgen beton / kaplama', agac_kabugu: 'Ağaç kabuğu (malç)', cim: 'Çim',
}

export function defaults(type: string): Intervention {
  switch (type) {
    case 'tree_planting': return { type, tree_count: 20, canopy_diameter: 5, tree_height: 7, species: 'Senaryo ağacı' }
    case 'shade_structure': return { type, height: 4, shade_ratio: 80, shade_type: 'Pergola / tente' }
    case 'pv_shading': return { type, height: 4, shade_ratio: 90 }
    case 'surface_change': return { type, current_material: '', new_material: 'beton', albedo: '' }
    case 'cool_pavement': return { type, current_material: 'asfalt', new_material: 'acik_renkli', albedo: 0.4 }
    case 'permeable_surface': return { type, new_material: 'gecirgen_beton' }
    case 'transfer_area': return { type, transfer_type: 'otobus', name: 'Önerilen aktarma noktası' }
    default: return { type }
  }
}

const needs = (t: string): DrawMode => t === 'pedestrian_route' ? 'linestring' : t === 'transfer_area' ? 'point' : 'polygon'

function Num({ label, v, on, step = 1, min = 0, max }: { label: string; v: unknown; on: (x: number) => void; step?: number; min?: number; max?: number }) {
  return <div className="field"><label>{label}</label><input type="number" value={v as number} step={step} min={min} max={max} onChange={e => on(Number(e.target.value))} /></div>
}

function Params({ iv, set }: { iv: Intervention; set: (p: Partial<Intervention>) => void }) {
  const crownArea = iv.type === 'tree_planting' ? Math.PI * ((iv.canopy_diameter as number) / 2) ** 2 * (iv.tree_count as number) : 0
  switch (iv.type) {
    case 'tree_planting': return <>
      <div className="row"><Num label="Ağaç sayısı" v={iv.tree_count} on={x => set({ tree_count: x })} /><Num label="Taç çapı (m)" v={iv.canopy_diameter} step={0.5} on={x => set({ canopy_diameter: x })} /></div>
      <div className="row"><Num label="Ağaç boyu (m)" v={iv.tree_height} step={0.5} on={x => set({ tree_height: x })} />
        <div className="field"><label>Tür (isteğe bağlı)</label><input value={iv.species as string} onChange={e => set({ species: e.target.value })} /></div></div>
      <div className="muted small">Toplam taç izdüşümü (çakışmasız): {fmt(crownArea, 'm²')} · ağaçlar alana taç çapı aralığıyla altıgen düzende yerleştirilir; yoğunluk = sayı / alan.</div>
    </>
    case 'shade_structure': case 'pv_shading': return <>
      <div className="row"><Num label="Yükseklik (m)" v={iv.height} step={0.5} on={x => set({ height: x })} /><Num label="Gölgeleme oranı (%)" v={iv.shade_ratio} max={100} on={x => set({ shade_ratio: x })} /></div>
      {iv.type === 'shade_structure' && <div className="field"><label>Gölgeleme türü</label>
        <select value={iv.shade_type as string} onChange={e => set({ shade_type: e.target.value })}>
          {['Pergola / tente', 'Gergi bez', 'Sabit saçak', 'Ağaçlı pergola'].map(x => <option key={x}>{x}</option>)}</select></div>}
      {iv.type === 'pv_shading' && <div className="muted small">PV elemanının yalnızca gölgesi hesaplanır; enerji üretimi ve ek termal etki için doğrulanmış parametre yoktur.</div>}
    </>
    case 'surface_change': case 'cool_pavement': case 'permeable_surface': return <>
      {iv.type !== 'permeable_surface' && <div className="field"><label>Mevcut malzeme (biliniyorsa)</label>
        <select value={(iv.current_material as string) ?? ''} onChange={e => set({ current_material: e.target.value })}>
          <option value="">Bilinmiyor</option><option value="asfalt">Asfalt</option><option value="beton">Beton</option>
          <option value="granit">Granit</option><option value="bazalt">Bazalt</option></select></div>}
      <div className="field"><label>Yeni malzeme</label>
        <select value={iv.new_material as string} onChange={e => set({ new_material: e.target.value })}>
          {Object.entries(MATERIALS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {iv.type !== 'permeable_surface' && <Num label="Yeni yüzey albedosu (0–1, ölçüm/ürün verisi)" v={iv.albedo} step={0.01} max={1} on={x => set({ albedo: x })} />}
      <div className="muted small">Asfalt ve beton için albedo aralıkları literatürden (Santamouris 2013) gelir; diğer malzemeler için değer tanımlanmamıştır.</div>
    </>
    case 'transfer_area': return <>
      <div className="field"><label>Aktarma türü</label><select value={iv.transfer_type as string} onChange={e => set({ transfer_type: e.target.value })}>
        <option value="otobus">Otobüs</option><option value="minibus">Minibüs</option><option value="iskele">İskele</option><option value="metro">Metro girişi</option></select></div>
      <div className="field"><label>Ad</label><input value={iv.name as string} onChange={e => set({ name: e.target.value })} /></div>
    </>
    case 'pedestrian_route': return <div className="muted small">Haritada güzergâhı çizgi olarak çizin; uzunluk ve gölgeli pay hesaplanır.</div>
    default: return <div className="muted small">Seçilen alan yeşil alana (çim/bitkili) dönüştürülür.</div>
  }
}

export const canRun = (def: ScenarioDef) => def.interventions.length > 0 && def.interventions.every(iv => !!iv.geometry)

/** Primary actions, kept visible at the bottom of the left panel. */
export function RunBar({ def, onRun, onSave, running, hasResult }: { def: ScenarioDef; onRun: () => void; onSave: () => void; running: boolean; hasResult: boolean }) {
  const ivs = def.interventions
  return <div className="runbar">
    <div className="btns">
      <button className="btn primary" disabled={running || !canRun(def)} onClick={onRun}>{running ? 'Hesaplanıyor…' : 'Senaryoyu Çalıştır'}</button>
      <button className="btn" disabled={running || !hasResult} onClick={onSave}>Senaryoyu Kaydet</button>
    </div>
    {!ivs.length ? <div className="muted small">Önce “Müdahaleler” bölümünden bir müdahale ekleyin ya da haritada bir alana tıklayın.</div>
      : ivs.some(iv => !iv.geometry) && <div className="muted small">Her müdahale için haritada alan/güzergâh tanımlayın.</div>}
  </div>
}

export default function ScenarioPanel(p: {
  def: ScenarioDef; setDef: (d: ScenarioDef) => void
  selection: Selection | null
  onDraw: (m: DrawMode, idx: number) => void
  drawingFor: number | null
  onSelectDraw: () => void; onClearSelection: () => void
}) {
  const { def, setDef } = p
  const ivs = def.interventions
  const upd = (i: number, x: Partial<Intervention>) => setDef({ ...def, interventions: ivs.map((iv, j) => j === i ? { ...iv, ...x } : iv) })
  const add = (t: string) => setDef({ ...def, interventions: [...ivs, { ...defaults(t), geometry: p.selection && needs(t) === 'polygon' && p.selection.geometry.type.includes('Polygon') ? p.selection.geometry : undefined }] })
  const kind = ivs.length > 1 ? 'Karma senaryo' : ivs.length === 1 ? IV_LABELS[ivs[0].type] : '—'
  return <>
    <Acc id="left.scenario" title="Senaryo yönetimi" icon="scenario" count={def.base === 'proje' ? 'proje' : 'mevcut'}>
      <div className="field"><label>Senaryo adı</label><input value={def.scenario_name} onChange={e => setDef({ ...def, scenario_name: e.target.value })} /></div>
      <div className="field"><label>Temel durum</label>
        <div className="seg">
          <button className={def.base === 'mevcut' ? 'on' : ''} onClick={() => setDef({ ...def, base: 'mevcut' })}>Mevcut durum</button>
          <button className={def.base === 'proje' ? 'on' : ''} onClick={() => setDef({ ...def, base: 'proje' })}>Proje durumu</button>
        </div></div>
      <div className="muted small">Senaryo türü: <b>{kind}</b> · {ivs.length} müdahale</div>
    </Acc>

    <Acc id="left.area" title="Çalışma alanı" icon="area" count={p.selection?.info ? fmt(p.selection.info.area_m2, 'm²') : p.selection ? 'seçili' : ''}>
      {!p.selection && <div className="muted small">Haritada bir yüzeye tıklayın ya da aşağıdan alan çizin. Seçilen alanın yüzey karışımı, yeşil ve gölge payı burada görünür.</div>}
      {p.selection && <div className="iv">
        <div><b>{p.selection.label}</b></div>
        {p.selection.info && <>
          <div className="small">Alan: <b>{fmt(p.selection.info.area_m2, 'm²')}</b></div>
          <ul className="plain small">{p.selection.info.surface_mix.slice(0, 5).map(m => <li key={m.ad + m.sinif}>{m.ad}: {fmt(m.alan_m2, 'm²')}</li>)}</ul>
          <div className="small">Yeşil: <b>{fmt(p.selection.info.kpis.find(k => k.id === 'yesil_oran')?.value, '%')}</b> · Gölge: <b>{fmt(p.selection.info.kpis.find(k => k.id === 'golge_oran')?.value, '%')}</b> · Ağaç: <b>{fmt(p.selection.info.kpis.find(k => k.id === 'agac_sayisi')?.value)}</b></div>
        </>}
      </div>}
      <div className="btns"><button className="btn small" onClick={p.onSelectDraw}>Alan çiz</button>
        {p.selection && <button className="btn small" onClick={p.onClearSelection}>Seçimi temizle</button>}</div>
    </Acc>

    <Acc id="left.iv" title="Müdahaleler" icon="tree" count={ivs.length || ''}>
      {ivs.map((iv, i) => (
        <div className="iv" key={i}>
          <div className="iv-head"><span>{i + 1}. {IV_LABELS[iv.type]}</span>
            <button className="btn small" onClick={() => setDef({ ...def, interventions: ivs.filter((_, j) => j !== i) })}>Kaldır</button></div>
          <Params iv={iv} set={x => upd(i, x)} />
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small">{iv.geometry ? <b className="pos">✓ Alan tanımlı</b> : <span className="neg">Alan tanımlı değil</span>}</span>
            <button className="btn small" onClick={() => p.onDraw(needs(iv.type), i)}>{p.drawingFor === i ? 'Çiziliyor…' : needs(iv.type) === 'linestring' ? 'Güzergâh çiz' : needs(iv.type) === 'point' ? 'Nokta koy' : 'Alan çiz'}</button>
            {p.selection && needs(iv.type) === 'polygon' && p.selection.geometry.type.includes('Polygon') &&
              <button className="btn small" onClick={() => upd(i, { geometry: p.selection!.geometry })}>Seçili alanı kullan</button>}
          </div>
        </div>))}
      <div className="field"><label>Müdahale ekle</label>
        <select value="" onChange={e => e.target.value && add(e.target.value)}>
          <option value="">Seçin…</option>
          {Object.entries(IV_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></div>
    </Acc>
  </>
}
