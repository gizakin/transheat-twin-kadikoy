// Layer catalogue for the map: ids, legend swatches and grouping shown in the layer panel.

export const SURFACE_COLORS: Record<string, string> = {
  yesil: '#5aa469',
  gecirgen: '#a7b86a',
  sert: '#bdb6a8',
  asfalt: '#4b4f55',
  bina: '#e2d9c8',
  su: '#6fa8dc',
}

export const SURFACE_LABELS: Record<string, string> = {
  yesil: 'Yeşil alan', gecirgen: 'Geçirgen yüzey', sert: 'Sert zemin', asfalt: 'Asfalt', bina: 'Bina / yapı', su: 'Su',
}

export const TRANSFER_COLORS: Record<string, string> = {
  metro: '#d64545', iskele: '#1f5fa8', otobus: '#c2560f', minibus: '#7b3fb6',
}

export const INFRA_COLORS: Record<string, string> = {
  'İSKİ atıksu': '#8c564b', 'İSKİ yağmursuyu': '#17becf', 'İSKİ içmesuyu': '#1f77b4', 'İGDAŞ doğalgaz': '#ffbf00', 'AYEDAŞ elektrik': '#d62728',
}

export interface ToggleDef { id: string; label: string; group: string; swatch: string; default: boolean }

export const TOGGLES: ToggleDef[] = [
  { id: 'boundary', label: 'Çalışma alanı sınırı', group: 'Temel', swatch: '#ffffff', default: true },
  { id: 'surfaces', label: 'Yüzey sınıfları (seçili durum)', group: 'Kentsel tasarım', swatch: '#bdb6a8', default: true },
  { id: 'buildings', label: 'Binalar', group: 'Kentsel tasarım', swatch: '#e2d9c8', default: true },
  { id: 'trees', label: 'Ağaçlar (taç)', group: 'Kentsel tasarım', swatch: '#2e8b57', default: true },
  { id: 'project_extent', label: 'Proje çizimi kapsamı', group: 'Kentsel tasarım', swatch: '#e8a33d', default: false },
  { id: 'insitu', label: 'INSITU önerisi (görsel referans)', group: 'Kentsel tasarım', swatch: '#9cbf5a', default: false },
  { id: 'shadow', label: 'Gölge (seçili saat)', group: 'Isı ve gölge', swatch: '#1f2a44', default: true },
  { id: 'heat', label: 'Isı haritası (uydu LST)', group: 'Isı ve gölge', swatch: '#d73027', default: false },
  { id: 'transfer_points', label: 'Aktarma noktaları', group: 'Ulaşım', swatch: '#d64545', default: true },
  { id: 'transfer_paths', label: 'Aktarma yürüme güzergâhları', group: 'Ulaşım', swatch: '#7b3fb6', default: false },
  { id: 'minibus_lines', label: 'Dolmuş/minibüs hatları', group: 'Ulaşım', swatch: '#7b3fb6', default: false },
  { id: 'ferry_lines', label: 'Deniz ulaşımı hatları', group: 'Ulaşım', swatch: '#1f5fa8', default: false },
  { id: 'comfort', label: 'Yaya konforu (aktarma, saatlik gölge)', group: 'Ulaşım', swatch: '#3f948a', default: false },
  { id: 'peds', label: 'Yaya akışı (ajan simülasyonu)', group: 'Ulaşım', swatch: '#f2a33a', default: false },
  { id: 'traffic', label: 'Canlı trafik yoğunluğu (İBB)', group: 'Ulaşım', swatch: '#f9a346', default: false },
  { id: 'iett_stops', label: 'İETT durakları (aktif)', group: 'Ulaşım', swatch: '#c2560f', default: true },
  { id: 'bus_corridors', label: 'Otobüs hat yoğunluğu (koridor)', group: 'Ulaşım', swatch: '#eb8a2f', default: false },
  { id: 'stop_access', label: 'Durağa yürüme erişimi (≤400 m)', group: 'Ulaşım', swatch: '#66bb6a', default: false },
  { id: 'heritage', label: 'Tescilli yapılar', group: 'Kısıtlar', swatch: '#b42318', default: false },
  { id: 'sit', label: 'Sit alanları', group: 'Kısıtlar', swatch: '#b42318', default: false },
  { id: 'ownership', label: 'Mülkiyet parselleri', group: 'Kısıtlar', swatch: '#6b7280', default: false },
  { id: 'infrastructure', label: 'Yer altı altyapı hatları', group: 'Kısıtlar', swatch: '#17becf', default: false },
  { id: 'scenario', label: 'Senaryo müdahaleleri', group: 'Senaryo', swatch: '#e8a33d', default: true },
]

export const DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(TOGGLES.map(t => [t.id, t.default]))
