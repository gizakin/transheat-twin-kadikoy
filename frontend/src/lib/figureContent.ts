// Legend, sources/methods and description for an exported figure — built only from what is on the map and from computed
// results already in the app. Observations, geometric calculations, literature-based simulations and model values are named
// as such; nothing that is not shown or computed is added.
import { SURFACE_COLORS, SURFACE_LABELS, TRANSFER_COLORS, TOGGLES } from '../map/layers'
import { INTERVENTIONS } from '../engine/scenario'
import { WMO, sunState, type WeatherHour } from '../engine/weather'
import type { LegendGroup } from './exporter'
import type { LayerMeta, ScenarioResult } from '../types'

const HEAT_COLORS = ['#2a78d6', '#f0efec', '#e34948']
const n1 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('tr-TR', { maximumFractionDigits: 1 }))

export interface HeatLegend { title: string; ticks: string[]; method: string }

/** Heat legend for one panel: observed LST, or a simulated LST / ΔLST from the heat simulation panel. */
export function heatLegend(kind: 'obs' | 'sim', heat: any, sim: any, simView: 'lst' | 'delta', simMode: 'local' | 'literature', who: string): HeatLegend | null {
  if (kind === 'obs') {
    const st = heat?.stats
    if (!st) return null
    return { title: 'Yüzey sıcaklığı (Landsat 2025)', ticks: [`${n1(st.p2)} °C`, `${n1((st.p2 + st.p98) / 2)}`, `${n1(st.p98)} °C`], method: 'Yüzey sıcaklığı: Landsat 2025 uydu yüzey sıcaklığı (veri tabanlı gözlem; hava sıcaklığı değildir).' }
  }
  if (!sim?.available) return null
  const m = simMode === 'local' ? 'yerel kalibrasyon (Kadıköy LST–bitki örtüsü ilişkisi)' : 'literatür üst sınırı (Armson vd. 2012 vb.)'
  if (simView === 'delta') return { title: `ΔLST simülasyonu – ${who}`, ticks: [`−${n1(sim.scaleMax)} °C`, '0', `+${n1(sim.scaleMax)} °C`], method: `Isı (${who}): simüle edilmiş yüzey sıcaklığı değişimi, ${m} — literatür tabanlı tahmin, ölçüm değildir.` }
  return { title: `Simüle yüzey sıcaklığı – ${who}`, ticks: [`${n1(sim.p2)} °C`, `${n1((sim.p2 + sim.p98) / 2)}`, `${n1(sim.p98)} °C`], method: `Isı (${who}): simüle edilmiş yüzey sıcaklığı, ${m} — literatür tabanlı tahmin, ölçüm değildir.` }
}

export function buildLegend(visible: Record<string, boolean>, heats: HeatLegend[], scenarioOn: boolean): LegendGroup[] {
  const g: LegendGroup[] = []
  const uniq = heats.filter((h, i) => heats.findIndex(o => o.title === h.title && o.ticks.join() === h.ticks.join()) === i)
  if (visible.heat) for (const h of uniq) g.push({ title: h.title, ramp: { colors: HEAT_COLORS, ticks: h.ticks } })
  if (visible.surfaces) g.push({ title: 'Yüzey sınıfları', items: Object.entries(SURFACE_COLORS).filter(([k]) => k !== 'bina').map(([k, c]) => ({ color: c, label: SURFACE_LABELS[k] })) })
  const base: { color: string; label: string; kind?: 'fill' | 'line' | 'dot' | 'dash' }[] = []
  if (visible.buildings) base.push({ color: '#e2d9c8', label: 'Bina' })
  if (visible.trees) base.push({ color: '#2e8b57', label: 'Ağaç tacı' })
  if (visible.shadow) base.push({ color: '#1f2a44', label: 'Gölge (seçili saat)' })
  if (visible.boundary) base.push({ color: '#9aa5b1', label: 'Çalışma alanı sınırı', kind: 'dash' })
  if (visible.project_extent) base.push({ color: '#e8a33d', label: 'Proje çizimi kapsamı', kind: 'dash' })
  if (base.length) g.push({ title: 'Kentsel doku', items: base })
  if (scenarioOn && visible.scenario) g.push({ title: 'Senaryo müdahaleleri', items: [
    { color: '#e8a33d', label: 'Müdahale alanı', kind: 'line' }, { color: '#15a34a', label: 'Yeni ağaç tacı' },
    { color: '#3b6fb6', label: 'Yeni gölge' }, { color: '#9ca3af', label: 'Gölgeleme elemanı' },
    { color: '#d64545', label: 'Etkilenen yürüme yolu', kind: 'line' }, { color: '#7b3fb6', label: 'Önerilen güzergâh', kind: 'line' }] })
  const tr: { color: string; label: string; kind?: 'fill' | 'line' | 'dot' | 'dash' }[] = []
  if (visible.transfer_points) Object.entries(TRANSFER_COLORS).filter(([k]) => k !== 'otobus').forEach(([k, c]) => tr.push({ color: c, label: ({ metro: 'M4 yapısı', iskele: 'İskele', minibus: 'Dolmuş durağı' } as any)[k], kind: 'dot' }))
  if (visible.iett_stops) tr.push({ color: '#c2560f', label: 'İETT durağı', kind: 'dot' })
  if (visible.transfer_paths) tr.push({ color: '#7b3fb6', label: 'Aktarma yürüme yolu', kind: 'line' })
  if (visible.minibus_lines) tr.push({ color: '#7b3fb6', label: 'Dolmuş hattı', kind: 'line' })
  if (visible.ferry_lines) tr.push({ color: '#1f5fa8', label: 'Deniz ulaşımı', kind: 'dash' })
  if (tr.length) g.push({ title: 'Ulaşım', items: tr })
  if (visible.bus_corridors) g.push({ title: 'Otobüs hat yoğunluğu (hat sayısı)', ramp: { colors: ['#f6c48a', '#eb8a2f', '#c2560f', '#7a2e05'], ticks: ['1', '10', '25', '41'] } })
  if (visible.traffic) g.push({ title: 'Trafik yoğunluğu (İBB)', items: [['#77b791', 'Serbest'], ['#4d8463', 'Açık'], ['#f9a346', 'Akıcı'], ['#d85050', 'Yoğun'], ['#842320', 'Çok yoğun'], ['#a8a8a8', 'Veri yok']].map(([c, l]) => ({ color: c, label: l, kind: 'line' as const })) })
  if (visible.stop_access) g.push({ title: 'Durağa yürüme mesafesi', items: [{ color: '#1b5e20', label: '0–200 m' }, { color: '#66bb6a', label: '200–400 m' }, { color: '#e67828', label: '400 m üzeri' }] })
  if (visible.comfort) g.push({ title: 'Aktarma yolunda gölgeli pay', ramp: { colors: ['#e9c46a', '#cfe3dc', '#8cc2b7', '#3f948a', '#0b5f66'], ticks: ['%0 (güneşte)', '%50', '%100 (gölgede)'] } })
  const k: { color: string; label: string; kind?: 'fill' | 'line' | 'dot' | 'dash' }[] = []
  if (visible.heritage) k.push({ color: '#b42318', label: 'Tescilli yapı' })
  if (visible.sit) k.push({ color: '#b42318', label: 'Sit alanı sınırı', kind: 'dash' })
  if (visible.ownership) k.push({ color: '#9aa5b1', label: 'Mülkiyet parseli', kind: 'line' })
  if (visible.infrastructure) k.push({ color: '#17becf', label: 'Yer altı altyapı hattı', kind: 'line' })
  if (k.length) g.push({ title: 'Kısıtlar', items: k })
  return g
}

export interface MetaCtx {
  visible: Record<string, boolean>; layers: LayerMeta[]; time: string; sun: { elevation: number; azimuth: number } | null
  stateLabels: string[]; heats: HeatLegend[]; traffic: { live: boolean; date: string } | null
  weather: (WeatherHour & { isCurrent: boolean }) | null; pitch: number
}

export function buildMeta(c: MetaCtx): string[] {
  const out: string[] = []
  out.push(`Çalışma alanı: Kadıköy Meydanı, İstanbul. Analiz koordinat sistemi TUREF/TM30 (EPSG:5254); harita gösterimi Web Mercator.`)
  out.push(`Durum: ${c.stateLabels.join(' | ')}.`)
  out.push(`Tarih ve saat: ${c.time.replace('T', ' ')} (Europe/Istanbul)${c.sun ? `; güneş yüksekliği ${n1(c.sun.elevation)}°, azimut ${n1(c.sun.azimuth)}° (NOAA güneş konumu)` : ''}.`)
  out.push('Altlık: ortofoto ve CAD paftaları (yarışma veri seti, İBB).')
  const byId = Object.fromEntries(c.layers.map(l => [l.id, l]))
  const srcs = new Set<string>()
  for (const t of TOGGLES) if (c.visible[t.id]) { const m = byId[t.id === 'trees' ? 'tree_crowns' : t.id]; if (m?.source && !/ortofoto/i.test(m.source)) srcs.add(`${t.label}: ${m.source}${m.date && m.date !== 'bilinmiyor' ? ` (${m.date})` : ''}`) }
  ;[...srcs].slice(0, 6).forEach(s => out.push(s))
  if (c.visible.shadow) out.push('Gölge: binalar, ağaçlar ve yapılar için güneş geometrisiyle geometrik hesaplama (bulutsuz gökyüzü, yatay zemin).')
  if (c.visible.heat) c.heats.forEach(h => out.push(h.method))
  if (c.visible.traffic && c.traffic) out.push(`Trafik: İBB Ulaşım Yönetim Merkezi yol parçası hız ve yoğunluk sınıfı, ${c.traffic.live ? 'canlı' : 'anlık görüntü'}, veri zamanı ${c.traffic.date.slice(0, 16).replace('T', ' ')} (veri tabanlı gözlem).`)
  if (c.visible.comfort) out.push('Yaya konforu: aktarma yollarının seçili saatte gölgede kalan payı (geometrik hesaplama); Tmrt, UTCI ve PET hesaplanmamıştır.')
  if (c.visible.stop_access) out.push('Durağa erişim: 2 m yürüme ağında en yakın İETT durağına yürüme mesafesi (geometrik hesaplama; taşıt yolları ayrıştırılmamıştır).')
  if (c.weather) {
    const w = c.weather, s = sunState(w.direct, c.time, w.precip)
    out.push(`Hava (Open-Meteo, model tabanlı; istasyon ölçümü değildir): ${w.code != null ? `${WMO[w.code] ?? ''}, ` : ''}${n1(w.temp)} °C, bulutluluk %${n1(w.cloud)}, yağış ${n1(w.precip)} mm; ${s === 'sunny' ? 'güneş açık (DNI ≥ 120 W/m²)' : s === 'cloudy' ? 'güneş bulut arkasında: gölgeler zayıf' : s === 'rain' ? 'yağışlı saat' : 'güneş ufkun altında'}.`)
  }
  if (c.pitch > 1) out.push('Eğik (3B) görünüm: ölçek çubuğu gösterilmez; kuzey oku yaklaşık yönü verir.')
  return out
}

export function buildDesc(kind: string, result: ScenarioResult | null, labels: string[]): string[] {
  const d: string[] = []
  if (kind === 'cmp_mp' || kind === 'cmp_sc') d.push(`Sol/üst: ${labels[0]}; sağ/alt: ${labels[1]}. İki görünüm aynı tarih, saat, kamera ve katmanlarla üretilmiştir.`)
  else d.push(labels[0] + '.')
  if (result && (kind === 'senaryo' || kind === 'cmp_sc' || labels.some(l => l.includes('SENARYO')))) {
    const sc = result.scenario
    const counts = new Map<string, number>()
    sc.interventions.forEach(i => counts.set(i.type, (counts.get(i.type) ?? 0) + 1))
    d.push(`Senaryo “${sc.scenario_name}” (taban: ${result.base_label}): ${[...counts].map(([t, n]) => `${INTERVENTIONS[t] ?? t}${n > 1 ? ` ×${n}` : ''}`).join(', ')}.`)
    result.log.slice(0, 3).forEach(l => d.push(l))
    result.narrative.slice(0, 3).forEach(l => d.push(l))
  }
  return d
}
