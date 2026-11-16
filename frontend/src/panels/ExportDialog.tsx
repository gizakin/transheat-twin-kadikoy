import { useMemo, useState } from 'react'
import { maxEdge, outputSize, type Layout, type Res } from '../lib/exporter'

export type ExportKind = 'view' | 'mevcut' | 'proje' | 'senaryo' | 'cmp_mp' | 'cmp_sc'
export type ExportPreset = 'asis' | 'heat' | 'green' | 'transport'
export interface ExportOpts {
  kind: ExportKind; preset: ExportPreset; res: Res; format: 'png' | 'jpeg'; layout: Layout
  title: string; showTitle: boolean; showLegend: boolean; showScale: boolean; showMeta: boolean; showDesc: boolean
  legendPos: 'overlay' | 'bottom' | 'side'
}

const KINDS: [ExportKind, string, string][] = [
  ['view', 'Ekrandaki görünüm', 'Şu an haritada görünen durum, katmanlar ve kamera'],
  ['mevcut', 'Mevcut durum haritası', 'Senaryo katmanları olmadan bugünkü durum'],
  ['proje', 'Proje durumu haritası', 'İBB meydan düzenleme projesi'],
  ['senaryo', 'Seçili müdahale senaryosu', 'Çalıştırılmış senaryonun sonucu'],
  ['cmp_mp', 'Karşılaştırma: Mevcut ↔ Proje', 'Aynı kamera ve saatte yan yana'],
  ['cmp_sc', 'Karşılaştırma: Müdahale öncesi ↔ sonrası', 'Aynı taban durumda senaryosuz ve senaryolu'],
]
const PRESETS: [ExportPreset, string, string][] = [
  ['asis', 'Ekrandaki katmanlar', 'Katman seçimine dokunulmaz'],
  ['heat', 'Kentsel ısı / yüzey sıcaklığı', 'Isı haritası + bina; proje/senaryo tarafında simülasyon'],
  ['green', 'Yeşil alan, ağaç ve gölge', 'Yüzey sınıfları, ağaç taçları, gölge, senaryo müdahaleleri'],
  ['transport', 'Ulaşım ve aktarma', 'Duraklar, aktarma noktaları ve yolları, durağa erişim'],
]

export default function ExportDialog({ onClose, onExport, busy, error, done, hasResult, scenarioName }: {
  onClose: () => void; onExport: (o: ExportOpts) => void; busy: string; error: string; done: string; hasResult: boolean; scenarioName: string | null
}) {
  const [o, setO] = useState<ExportOpts>({ kind: 'view', preset: 'asis', res: '4k', format: 'png', layout: 'landscape', title: '',
    showTitle: true, showLegend: true, showScale: true, showMeta: true, showDesc: true, legendPos: 'overlay' })
  const legendOnly = o.showLegend && !o.showMeta && !o.showDesc
  const set = <K extends keyof ExportOpts>(k: K, v: ExportOpts[K]) => setO(s => ({ ...s, [k]: v }))
  const maxPx = useMemo(() => maxEdge(), [])
  const [W, H] = outputSize(o.res, o.layout)
  const needsResult = o.kind === 'senaryo' || o.kind === 'cmp_sc'
  const working = !!busy
  const embedded = (() => { try { return window.self !== window.top } catch { return true } })()
  return <div className="modal-bg" onClick={() => !working && onClose()}>
    <div className="modal export-modal" role="dialog" aria-label="Görseli dışa aktar" onClick={e => e.stopPropagation()}>
      <header><b>Görseli dışa aktar</b><button className="btn small" onClick={onClose} disabled={working}>Kapat</button></header>
      <div className="export-body">
        <fieldset disabled={working}>
          <div className="grp">Görsel türü</div>
          <div className="export-opts">{KINDS.map(([k, l, d]) => {
            const dis = (k === 'senaryo' || k === 'cmp_sc') && !hasResult
            return <label key={k} className={`export-opt ${o.kind === k ? 'on' : ''} ${dis ? 'dis' : ''}`} title={dis ? 'Önce bir senaryo çalıştırın' : d}>
              <input type="radio" name="kind" checked={o.kind === k} disabled={dis} onChange={() => set('kind', k)} />
              <span><b>{l}</b><small>{dis ? 'Önce bir senaryo çalıştırın' : k === 'senaryo' || k === 'cmp_sc' ? `${d}: “${scenarioName}”` : d}</small></span></label>
          })}</div>

          <div className="grp">İçerik</div>
          <div className="export-opts two">{PRESETS.map(([k, l, d]) => <label key={k} className={`export-opt ${o.preset === k ? 'on' : ''}`} title={d}>
            <input type="radio" name="preset" checked={o.preset === k} onChange={() => set('preset', k)} /><span><b>{l}</b><small>{d}</small></span></label>)}</div>

          <div className="export-row">
            <div><div className="grp">Çözünürlük</div>
              <div className="seg">{([['2k', '2K'], ['4k', '4K'], ['max', 'En yüksek']] as [Res, string][]).map(([k, l]) =>
                <button type="button" key={k} className={o.res === k ? 'on' : ''} onClick={() => set('res', k)}>{l}</button>)}</div></div>
            <div><div className="grp">Biçim</div>
              <div className="seg">{([['png', 'PNG'], ['jpeg', 'JPEG']] as ['png' | 'jpeg', string][]).map(([k, l]) =>
                <button type="button" key={k} className={o.format === k ? 'on' : ''} onClick={() => set('format', k)}>{l}</button>)}</div></div>
            <div><div className="grp">Düzen</div>
              <div className="seg">{([['landscape', 'Yatay'], ['portrait', 'Dikey']] as [Layout, string][]).map(([k, l]) =>
                <button type="button" key={k} className={o.layout === k ? 'on' : ''} onClick={() => set('layout', k)}>{l}</button>)}</div></div>
          </div>
          <div className="small muted">Çıktı: <b>{W}×{H} px</b>{o.res === 'max' ? ` (bu cihazda grafik kartının izin verdiği en büyük kenar ${maxPx} px)` : ''}. Harita bu çözünürlükte yeniden çizilir; ekran görüntüsü büyütülmez.</div>

          <div className="export-row" style={{ alignItems: 'flex-end' }}>
            <div className="grp" style={{ marginTop: 10 }}>Eklenecekler</div>
            <button type="button" className={`btn small ${legendOnly ? 'primary' : ''}`} style={{ marginLeft: 'auto' }}
              onClick={() => setO(s => ({ ...s, showLegend: true, showMeta: false, showDesc: false, legendPos: 'overlay' }))}
              title="Kaynak ve açıklama olmadan; lejant haritanın üzerinde">Yalnızca lejant</button>
          </div>
          <div className="export-checks">
            <label><input type="checkbox" checked={o.showTitle} onChange={e => set('showTitle', e.target.checked)} /> Başlık, çalışma alanı ve senaryo adı</label>
            <label><input type="checkbox" checked={o.showLegend} onChange={e => set('showLegend', e.target.checked)} /> Lejant ve renk skalası</label>
            {o.showLegend && <div className="export-legendpos">Lejant konumu:
              <label><input type="radio" name="lp" checked={o.legendPos === 'overlay'} onChange={() => set('legendPos', 'overlay')} /> harita üzerinde</label>
              <label><input type="radio" name="lp" checked={o.legendPos === 'bottom'} onChange={() => set('legendPos', 'bottom')} /> haritanın altında</label>
              <label><input type="radio" name="lp" checked={o.legendPos === 'side'} onChange={() => set('legendPos', 'side')} /> {o.layout === 'landscape' ? 'yan sütunda' : 'alt bilgi bloğunda'}</label></div>}
            <label><input type="checkbox" checked={o.showScale} onChange={e => set('showScale', e.target.checked)} /> Ölçek çubuğu ve kuzey oku</label>
            <label><input type="checkbox" checked={o.showMeta} onChange={e => set('showMeta', e.target.checked)} /> Veri kaynağı, yöntem, tarih ve çözünürlük</label>
            <label><input type="checkbox" checked={o.showDesc} onChange={e => set('showDesc', e.target.checked)} /> Mevcut durum / müdahale açıklaması</label>
          </div>
          {o.showTitle && <div className="field"><label htmlFor="exp-title">Başlık (boş bırakılırsa otomatik)</label>
            <input id="exp-title" value={o.title} onChange={e => set('title', e.target.value)} placeholder="ör. Kadıköy Meydanı – 15 Temmuz 14:00 gölge analizi" /></div>}
        </fieldset>
        {embedded && <div className="note small">Platform başka bir sayfanın içinde (ör. claude.ai önizlemesi) açık; bu görüntüleyici dosya indirmeyi engelleyebilir. Sorun olursa platformu kendi adresinde açın: transheat-twin-kadikoy.netlify.app</div>}
        {error && <div className="note">{error}</div>}
        {done && !error && !busy && <div className="info small">{done}</div>}
        <div className="export-foot">
          <span className="small muted">{busy || 'Arayüz düğmeleri, menüler ve imleç görsele girmez.'}</span>
          <button className="btn primary" disabled={working || (needsResult && !hasResult)} onClick={() => onExport(o)}>{working ? 'Hazırlanıyor…' : 'Dışa aktar ve indir'}</button>
        </div>
      </div>
    </div>
  </div>
}
