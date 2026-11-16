// Weather and air quality from Open-Meteo (https://open-meteo.com, CC BY 4.0, no key, CORS open). These are numerical model values
// for the model grid cell around the square — not station measurements — and are labelled "Model tabanlı sonuç".
//   * forecast API:     ~3 months back to 15 days ahead (best-match high-resolution models), plus 15-min "current" values
//   * archive API:      older dates (reanalysis)
//   * air-quality API:  CAMS European air quality model (PM2.5, PM10, NO₂, O₃, SO₂, European AQI)
// The sun counts as "shining" when direct normal irradiance ≥ 120 W/m² (WMO sunshine-duration threshold), DNI = direct horizontal / sin(elevation).
import { LAT, LON, sunPosition } from './sun'

export const SUNSHINE_DNI = 120 // W/m², WMO threshold for sunshine duration
export const RAIN_MM = 0.1      // mm per hour counted as a wet hour

export interface WeatherHour {
  time: string; temp: number | null; app: number | null; rh: number | null; cloud: number | null
  cloudLow: number | null; cloudMid: number | null; cloudHigh: number | null
  direct: number | null; diffuse: number | null; sw: number | null; wind: number | null; gust: number | null; windDir: number | null
  uv: number | null; precip: number | null; precipProb: number | null; rain: number | null; snow: number | null
  code: number | null; pressure: number | null; visibility: number | null
}
export interface Weather {
  date: string; source: 'forecast' | 'archive'; model: string
  gridLat: number; gridLon: number; elevation: number
  hours: WeatherHour[]            // 24 hourly values for `date`
  current: (WeatherHour & { interval: number }) | null   // 15-min value, only for today
  fetchedAt: number
}

// variable name in the response → field
const MAP: [string, keyof WeatherHour][] = [
  ['temperature_2m', 'temp'], ['apparent_temperature', 'app'], ['relative_humidity_2m', 'rh'], ['cloud_cover', 'cloud'],
  ['cloud_cover_low', 'cloudLow'], ['cloud_cover_mid', 'cloudMid'], ['cloud_cover_high', 'cloudHigh'],
  ['direct_radiation', 'direct'], ['diffuse_radiation', 'diffuse'], ['shortwave_radiation', 'sw'],
  ['wind_speed_10m', 'wind'], ['wind_gusts_10m', 'gust'], ['wind_direction_10m', 'windDir'], ['uv_index', 'uv'],
  ['precipitation', 'precip'], ['precipitation_probability', 'precipProb'], ['rain', 'rain'], ['snowfall', 'snow'],
  ['weather_code', 'code'], ['pressure_msl', 'pressure'], ['visibility', 'visibility'],
]
const FORECAST_ONLY = new Set(['uv_index', 'precipitation_probability', 'visibility'])
const cache = new Map<string, Promise<Weather>>()

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)

async function getJSON(url: string, ms = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { signal: ac.signal })
    const j = await r.json()
    if (!r.ok || j.error) throw new Error(j.reason || `HTTP ${r.status}`)
    return j
  } finally { clearTimeout(t) }
}

function rows(block: any, vars: [string, string][]) {
  const t: string[] = block?.time ?? []
  return t.map((time, i) => Object.fromEntries([['time', time], ...vars.map(([k, f]) => [f, block?.[k]?.[i] ?? null])]))
}
function one(block: any, vars: [string, string][]) {
  return block ? Object.fromEntries([['time', block.time], ['interval', block.interval], ...vars.map(([k, f]) => [f, block[k] ?? null])]) : null
}

/** Hourly weather for `date` (YYYY-MM-DD, Istanbul local); today adds the 15-min current value. `refresh` bypasses the cache. */
export function loadWeather(date: string, today: string, refresh = false): Promise<Weather> {
  if (!refresh && cache.has(date)) return cache.get(date)!
  const p = (async () => {
    const d = dayDiff(date, today)
    if (d > 15) throw new Error('tarih tahmin aralığının (15 gün) dışında')
    const useForecast = d >= -90
    const vars = MAP.filter(([k]) => useForecast || !FORECAST_ONLY.has(k))
    const list = vars.map(([k]) => k).join(',')
    const base = useForecast ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive'
    const q = `latitude=${LAT}&longitude=${LON}&timezone=Europe%2FIstanbul&start_date=${date}&end_date=${date}&hourly=${list}` +
      (useForecast && d === 0 ? `&current=${list.replace(',precipitation_probability', '')}` : '')
    const j = await getJSON(`${base}?${q}`)
    const hours = rows(j.hourly, vars as [string, string][]) as unknown as WeatherHour[]
    for (const f of MAP.map(m => m[1])) hours.forEach(h => { if (!(f in h)) (h as any)[f] = null })
    const current = one(j.current, vars as [string, string][]) as any
    if (current) for (const f of MAP.map(m => m[1])) if (!(f in current)) current[f] = null
    return { date, source: useForecast ? 'forecast' : 'archive', model: useForecast ? 'Open-Meteo en uygun model (yüksek çözünürlüklü NWP)' : 'Open-Meteo arşivi (yeniden analiz)',
      gridLat: j.latitude, gridLon: j.longitude, elevation: j.elevation, hours, current, fetchedAt: Date.now() } as Weather
  })()
  cache.set(date, p)
  p.catch(() => cache.delete(date))
  return p
}

/** Values at a local time: the 15-min current value when following today's clock, else the hourly value of that hour. */
export function weatherAt(w: Weather, time: string, useCurrent: boolean): (WeatherHour & { isCurrent: boolean }) | null {
  const hr = time.slice(0, 13)
  const h = w.hours.find(x => x.time.slice(0, 13) === hr) ?? null
  if (useCurrent && w.current) return { ...(h ?? {}), ...Object.fromEntries(Object.entries(w.current).filter(([, v]) => v != null)), isCurrent: true } as any
  return h ? { ...h, isCurrent: false } : null
}

/** Direct normal irradiance from the direct horizontal value and the sun elevation at `time` (null below 3°, where it is unstable). */
export function dni(direct: number | null, time: string) {
  const el = sunPosition(time).elevation
  if (direct == null || el < 3) return el <= 0 ? 0 : null
  return direct / Math.sin((el * Math.PI) / 180)
}

export type SunState = 'night' | 'sunny' | 'cloudy' | 'rain' | 'unknown'
export function sunState(direct: number | null, time: string, precip: number | null = null): SunState {
  if (precip != null && precip >= RAIN_MM) return 'rain'
  if (sunPosition(time).elevation <= 0) return 'night'
  const n = dni(direct, time)
  if (n == null) return 'unknown'
  return n >= SUNSHINE_DNI ? 'sunny' : 'cloudy'
}

/** WMO weather interpretation codes as used by Open-Meteo. */
export const WMO: Record<number, string> = {
  0: 'Açık', 1: 'Çoğunlukla açık', 2: 'Parçalı bulutlu', 3: 'Kapalı', 45: 'Sis', 48: 'Kırağılı sis',
  51: 'Hafif çisenti', 53: 'Çisenti', 55: 'Yoğun çisenti', 56: 'Hafif dondurucu çisenti', 57: 'Dondurucu çisenti',
  61: 'Hafif yağmur', 63: 'Yağmur', 65: 'Şiddetli yağmur', 66: 'Hafif dondurucu yağmur', 67: 'Dondurucu yağmur',
  71: 'Hafif kar', 73: 'Kar', 75: 'Yoğun kar', 77: 'Kar taneleri', 80: 'Hafif sağanak', 81: 'Sağanak', 82: 'Şiddetli sağanak',
  85: 'Kar sağanağı', 86: 'Yoğun kar sağanağı', 95: 'Gök gürültülü fırtına', 96: 'Dolulu fırtına', 99: 'Şiddetli dolulu fırtına',
}
export const compass = (deg: number | null) => (deg == null ? '—' : ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'][Math.round(deg / 45) % 8])

// ------------------------------------------------------------------ air quality (CAMS European model via Open-Meteo)
export interface AirHour { time: string; aqi: number | null; pm25: number | null; pm10: number | null; no2: number | null; o3: number | null; so2: number | null }
export interface Air { date: string; gridLat: number; gridLon: number; hours: AirHour[]; current: (AirHour & { interval: number }) | null }
const AIR: [string, keyof AirHour][] = [['european_aqi', 'aqi'], ['pm2_5', 'pm25'], ['pm10', 'pm10'], ['nitrogen_dioxide', 'no2'], ['ozone', 'o3'], ['sulphur_dioxide', 'so2']]
const airCache = new Map<string, Promise<Air>>()

export function loadAir(date: string, today: string, refresh = false): Promise<Air> {
  if (!refresh && airCache.has(date)) return airCache.get(date)!
  const p = (async () => {
    if (dayDiff(date, today) > 6) throw new Error('hava kalitesi tahmini en fazla 6 gün ileriyi kapsar')
    const list = AIR.map(([k]) => k).join(',')
    const q = `latitude=${LAT}&longitude=${LON}&timezone=Europe%2FIstanbul&start_date=${date}&end_date=${date}&hourly=${list}` + (date === today ? `&current=${list}` : '')
    const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`)
    return { date, gridLat: j.latitude, gridLon: j.longitude, hours: rows(j.hourly, AIR as [string, string][]) as unknown as AirHour[],
      current: one(j.current, AIR as [string, string][]) as any }
  })()
  airCache.set(date, p)
  p.catch(() => airCache.delete(date))
  return p
}

/** European Air Quality Index bands (EEA), as documented by Open-Meteo. */
export const EAQI: { max: number; label: string; color: string; ink: string }[] = [
  { max: 20, label: 'İyi', color: '#50f0e6', ink: '#0b3b46' }, { max: 40, label: 'Makul', color: '#50ccaa', ink: '#0b3b46' },
  { max: 60, label: 'Orta', color: '#f0e641', ink: '#3b3200' }, { max: 80, label: 'Kötü', color: '#ff5050', ink: '#ffffff' },
  { max: 100, label: 'Çok kötü', color: '#960032', ink: '#ffffff' }, { max: Infinity, label: 'Son derece kötü', color: '#7d2181', ink: '#ffffff' },
]
export const eaqiBand = (v: number | null) => (v == null ? null : EAQI.find(b => v <= b.max)!)

/** WHO 2021 air quality guideline levels, 24-hour means (µg/m³). Ozone's guideline is an 8-hour mean (100 µg/m³). */
export const WHO_24H: Partial<Record<keyof AirHour, number>> = { pm25: 15, pm10: 45, no2: 25, so2: 40 }
export const WHO_O3_8H = 100
