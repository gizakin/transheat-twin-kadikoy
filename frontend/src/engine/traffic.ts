// İBB live traffic density (UYM Trafik Yoğunluk Haritası). The browser reads the public, CORS-open JSON service directly;
// when that request fails (offline, blocked by the host page) the snapshot written by etl/traffic.py is shown and labelled.
import { DATA_URL } from './data'

const API = 'https://tkmservices.ibb.gov.tr/web/api'

/** Class codes, labels and colours exactly as on the İBB map (yharita6 app.css / LanguageText). */
export const TRAFFIC_CLASSES: { c: number; label: string; color: string }[] = [
  { c: 1, label: 'Serbest', color: '#77b791' },
  { c: 2, label: 'Açık', color: '#4d8463' },
  { c: 3, label: 'Akıcı', color: '#f9a346' },
  { c: 4, label: 'Yoğun', color: '#d85050' },
  { c: 5, label: 'Çok yoğun', color: '#842320' },
]
export const TRAFFIC_NODATA = '#a8a8a8'
export const trafficLabel = (c: number) => TRAFFIC_CLASSES.find(k => k.c === c)?.label ?? 'Veri yok'

export interface TrafficRec { V: number; C: number; T: string; D: string }
export interface TrafficState {
  live: boolean
  date: string          // service timestamp (ISO)
  fetchedAt: number     // ms, when this page received it
  recs: Record<number, TrafficRec>
  index: number | null  // İstanbul-wide traffic index (live only)
  error?: string
}

let segCache: Promise<GeoJSON.FeatureCollection> | null = null
export function trafficSegments() {
  segCache ??= fetch(DATA_URL + 'traffic_segments.geojson').then(r => r.json())
  return segCache
}

async function getJSON(url: string, ms = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

function pick(data: any[], ids: Set<number>) {
  const recs: Record<number, TrafficRec> = {}
  for (const d of data ?? []) if (ids.has(d.S)) recs[d.S] = { V: Number(d.V), C: Number(d.C), T: String(d.T ?? ''), D: String(d.D ?? '') }
  return recs
}

export async function loadTraffic(): Promise<TrafficState> {
  const segs = await trafficSegments()
  const ids = new Set(segs.features.map(f => Number(f.properties!.S)))
  try {
    const [sd, ix] = await Promise.all([getJSON(`${API}/TrafficData/v4/SegmentData`),
      getJSON(`${API}/TrafficData/v1/TrafficIndex`).catch(() => null)])
    return { live: true, date: sd.Date, fetchedAt: Date.now(), recs: pick(sd.Data, ids), index: ix?.Result ?? null }
  } catch (e: any) {
    const snap = await (await fetch(DATA_URL + 'traffic_snapshot.json')).json()
    return { live: false, date: snap.Date, fetchedAt: Date.now(), recs: pick(snap.Data, ids), index: null,
      error: e?.name === 'AbortError' ? 'zaman aşımı' : (e?.message || 'bağlantı engellendi') }
  }
}

/** Segments with the live attributes merged in, ready for the map source. */
export function trafficFeatures(segs: GeoJSON.FeatureCollection, st: TrafficState | null): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: segs.features.map(f => {
    const r = st?.recs[Number(f.properties!.S)]
    return { ...f, properties: { ...f.properties, C: r?.C ?? 0, V: r?.V ?? null, D: r?.D ?? '', T: r?.T ?? '', live: st?.live ?? false } }
  }) }
}

/** Length-weighted summary: km per class (index 0 = no data) and mean speed, for the study area and the 1.5 km context. */
export function trafficSummary(segs: GeoJSON.FeatureCollection, st: TrafficState) {
  const part = (onlySite: boolean) => {
    const km = [0, 0, 0, 0, 0, 0]
    let vs = 0, ls = 0, n = 0
    for (const f of segs.features) {
      const p = f.properties!
      if (onlySite && !p.alanda) continue
      const L = Number(p.uzunluk_m) / 1000
      const r = st.recs[Number(p.S)]
      const c = r && r.C >= 1 && r.C <= 5 ? r.C : 0
      km[c] += L
      n++
      if (c) { vs += r!.V * L; ls += L }
    }
    return { km, n, total: km.reduce((a, b) => a + b, 0), meanSpeed: ls ? vs / ls : null, covered: ls }
  }
  return { site: part(true), context: part(false) }
}
