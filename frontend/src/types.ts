export type Method = 'data' | 'geometric' | 'literature' | 'assumption' | 'model'

/** Raster overlay produced by the engine: PNG data URL + corner coordinates in TM30 (TL, TR, BR, BL). */
export interface OverlayImg { canvas: HTMLCanvasElement; url: string; tm: [number, number][] }
/** Raster overlay with WGS84 corners (TL, TR, BR, BL). */
export interface LLImg { canvas: HTMLCanvasElement; corners: [number, number][] }

export interface Explain {
  veri_kaynagi: string
  veri_tarihi: string
  parametre: string
  formul: string
  literatur: string[]
  varsayim: { ad: string; deger: unknown; birim?: string; kullanim: string }[]
  belirsizlik: string
}

export interface Kpi {
  id: string
  label: string
  value: number | string | null
  unit: string
  method: Method
  group: string
  explain: Explain
}

export interface LayerMeta {
  id: string
  title: string
  group: string
  method: Method
  source: string
  date: string
  notes?: string
  count?: number
  url?: string | null
  tiles?: string | null
  kind?: string
  metadata?: Record<string, unknown>
  geojson?: GeoJSON.FeatureCollection
  image?: LLImg
}

export interface Intervention {
  type: string
  geometry?: GeoJSON.Geometry
  [k: string]: unknown
}

export interface ScenarioDef {
  id?: string
  scenario_name: string
  area: string
  base: 'mevcut' | 'proje'
  time: string
  interventions: Intervention[]
  source: string
  analysis_method?: string[]
  created_at?: string
}

export interface LitEffect { text: string; method: Method; params: string[]; confidence: string }
export interface ImpactItem { text: string; basis: string }

export interface ScenarioResult {
  scenario: ScenarioDef
  base_label: string
  time: string
  sun: { elevation: number; azimuth: number }
  area_m2: number
  kpis_base: Kpi[]
  kpis_scenario: Kpi[]
  deltas: Record<string, number | null>
  symbols: Record<string, string>
  literature_effects: LitEffect[]
  narrative: string[]
  impacts: { positive: ImpactItem[]; negative: ImpactItem[]; affected: ImpactItem[]; stakeholders: { name: string; basis: string }[] }
  log: string[]
  warnings: string[]
  notes: string[]
  methods: Method[]
  confidence: string
  geoms: Record<string, GeoJSON.FeatureCollection | GeoJSON.Feature>
  images?: { new_shade: OverlayImg; base_shade: OverlayImg }
}

export interface StateKpis {
  label: string
  notes: string[]
  sun: { elevation: number; azimuth: number }
  area_m2: number
  kpis: Kpi[]
  shadow: OverlayImg | null
  transfer_paths: GeoJSON.FeatureCollection
}

export interface Selection {
  geometry: GeoJSON.Geometry
  label: string
  info?: { area_m2: number; kpis: Kpi[]; surface_mix: { sinif: string; ad: string; alan_m2: number; malzeme: string }[] }
}
