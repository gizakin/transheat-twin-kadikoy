// Time-dependent passenger and pedestrian demand for the pedestrian simulation (24 h, weekday / weekend, per flow).
// MEASURED: ferry and M4 boardings at Kadıköy (İBB open data: 2025 daily volume of the month, Sep 2024 hour profile and
// weekday/weekend ratio), the İBB/Şehir Hatları share of pier passengers, the İstanbulkart transfer share, the Şehir Hatları
// timetable. ASSUMED (editable, labelled): every alighting profile (alightings = boardings per day), the non-transit çarşı and
// meydan/sahil pedestrian volumes and profiles, seasonal / weather / event multipliers, waiting times, gate shares.
// A coefficient of 1.00 is the mean hour of the day: passengers(h) = daily × coef(h) / 24 × multiplier(h). Multipliers are
// applied once, in one place (no flow is increased twice), and never to a factor the data already contains.
import type { Ridership } from './pedsim'

export type DayKind = 'wd' | 'we'
export type ServiceDay = 'wd' | 'sat' | 'sun'
export type FlowId = 'iskele_inen' | 'iskele_binen' | 'metro_inen' | 'metro_binen' | 'carsi' | 'sosyal'
export type GateId = 'carsi' | 'moda' | 'rihtim' | 'sahil'
export type Season = 'ilkbahar' | 'yaz' | 'sonbahar' | 'kis'

export interface FlowDef { id: FlowId; label: string; zone: string; mode: string; profile: 'veri' | 'varsayim'; volume: 'veri' | 'varsayim'; note: string }
export const FLOWS: FlowDef[] = [
  { id: 'iskele_inen', label: 'Vapurdan inen', zone: 'A · İskele', mode: 'Vapur', profile: 'varsayim', volume: 'veri',
    note: 'Günlük hacim = iskele binişi (İBB verisi; iniş = biniş varsayımı). Saatlik dağılım varsayım. Varışlar Şehir Hatları tarifesinden (İBB payı) ve Turyol için sefer aralığı varsayımından.' },
  { id: 'iskele_binen', label: 'Vapura binen', zone: 'A · İskele', mode: 'Vapur', profile: 'veri', volume: 'veri',
    note: 'Günlük hacim ve hafta içi/sonu saatlik dağılımı İBB verisinden. Yolcular kalkıştan önce iskeleye gelir ve bekler.' },
  { id: 'metro_inen', label: 'M4’ten inen', zone: 'C · M4 Kadıköy', mode: 'Metro', profile: 'varsayim', volume: 'veri',
    note: 'Günlük hacim = M4 Kadıköy binişi (İBB verisi; iniş = biniş varsayımı). Saatlik dağılım varsayım.' },
  { id: 'metro_binen', label: 'M4’e binen', zone: 'C · M4 Kadıköy', mode: 'Metro', profile: 'veri', volume: 'veri',
    note: 'Günlük hacim ve saatlik dağılım İBB verisinden.' },
  { id: 'carsi', label: 'Çarşı yayası', zone: 'E · Çarşı girişi', mode: 'Yaya (toplu taşıma dışı)', profile: 'varsayim', volume: 'varsayim',
    note: 'Çarşı ile meydan/sahil arasında yürüyen, toplu taşıma kullanmayan yaya. Hacim ve dağılım varsayım (yaya sayımı yok).' },
  { id: 'sosyal', label: 'Meydan ve sahil yayası', zone: 'B · Meydan', mode: 'Yaya (toplu taşıma dışı)', profile: 'varsayim', volume: 'varsayim',
    note: 'Moda, Rıhtım ve sahil yönünden meydana/sahile gelen sosyal amaçlı yaya. Hacim ve dağılım varsayım.' },
]

/** Levels of the starting table → coefficients before smoothing and normalising to a mean of 1.00. */
const L = { cd: 0.03, d: 0.4, do: 0.75, o: 1.0, oy: 1.3, y: 1.65, cy: 2.1 }
type Lv = keyof typeof L
const raw = (s: string) => s.split(' ').map(x => L[x as Lv])
// 24 values, 00:00 … 23:00 (the hour starting at that time)
const BASE_WD = raw('cd cd cd cd cd d o cy cy o o oy oy o o o y cy cy oy oy do do d')
const BASE_WE = raw('do d cd cd cd cd d d do o oy oy oy y y y y y oy oy oy o o do')
const CARSI_WD = raw('cd cd cd cd cd cd cd d do o o oy y y oy oy y cy cy y oy o do d')
const CARSI_WE = raw('d cd cd cd cd cd cd cd d do oy y cy cy cy cy cy cy y y oy o do d')
const SOSYAL_WD = raw('d cd cd cd cd cd d do do o o o oy o o o oy y y cy cy y o do')
const SOSYAL_WE = raw('o do cd cd cd cd cd d do o oy y y cy cy cy cy cy cy cy y y oy o')

/** Circular 1-2-1 smoothing (no unrealistic jumps between hours) and normalisation to a daily mean of 1.00. */
export function smoothNorm(v: number[], passes = 1) {
  let a = v.slice()
  for (let p = 0; p < passes; p++) a = a.map((x, i) => 0.25 * a[(i + 23) % 24] + 0.5 * x + 0.25 * a[(i + 1) % 24])
  const m = a.reduce((s, x) => s + x, 0) / 24
  return a.map(x => Math.round((1000 * x) / (m || 1)) / 1000)
}
export const norm = (v: number[]) => { const m = v.reduce((s, x) => s + x, 0) / 24; return v.map(x => Math.round((1000 * x) / (m || 1)) / 1000) }

/** Default coefficients: data-based where İBB data exist (boardings), the starting assumption table elsewhere. */
export function defaultCoef(rid: Ridership | null): Record<FlowId, Record<DayKind, number[]>> {
  const data = (k: 'iskele' | 'metro', d: DayKind) => (rid?.profileByDay ? norm(rid.profileByDay[k][d].map(x => x * 24)) : null)
  return {
    iskele_inen: { wd: smoothNorm(BASE_WD), we: smoothNorm(BASE_WE) },
    iskele_binen: { wd: data('iskele', 'wd') ?? smoothNorm(BASE_WD), we: data('iskele', 'we') ?? smoothNorm(BASE_WE) },
    metro_inen: { wd: smoothNorm(BASE_WD), we: smoothNorm(BASE_WE) },
    metro_binen: { wd: data('metro', 'wd') ?? smoothNorm(BASE_WD), we: data('metro', 'we') ?? smoothNorm(BASE_WE) },
    carsi: { wd: smoothNorm(CARSI_WD), we: smoothNorm(CARSI_WE) },
    sosyal: { wd: smoothNorm(SOSYAL_WD), we: smoothNorm(SOSYAL_WE) },
  }
}

export const GATES: { id: GateId; label: string; ll: [number, number] }[] = [
  { id: 'carsi', label: 'Çarşı girişi (Söğütlüçeşme–Muvakkithane)', ll: [29.02545, 40.99095] },
  { id: 'moda', label: 'Moda / Caferağa yönü', ll: [29.0220, 40.9897] },
  { id: 'rihtim', label: 'Rıhtım Caddesi kuzey (Haydarpaşa yönü)', ll: [29.0245, 40.9965] },
  { id: 'sahil', label: 'Sahil yolu (Moda sahili yönü)', ll: [29.0190, 40.9869] },
]
export const SPOTS: { id: string; label: string; ll: [number, number] }[] = [
  { id: 'meydan', label: 'Meydan', ll: [29.0226, 40.9905] },
  { id: 'sahil', label: 'Sahil', ll: [29.0172, 40.9909] },
]

export interface DemandCfg {
  model: 'dynamic' | 'simple'
  dayMode: 'auto' | DayKind
  window: 'selected' | 'range'
  startHour: number; endHour: number           // range mode; end exclusive (1…24)
  coef: Partial<Record<FlowId, Partial<Record<DayKind, number[]>>>>   // user overrides only
  daily: { carsi: number; sosyal: number }       // persons per mean day (assumption)
  weRatio: { carsi: number; sosyal: number }     // weekend day / mean day (assumption)
  seasonOn: boolean
  seasonF: Record<Season, { carsi: number; sosyal: number }>
  holidayF: number                               // extra factor on public holidays (all flows)
  schoolOffF: number                             // factor when schools are closed (assumption flows)
  weather: 'auto' | 'dry' | 'rain'
  rainF: { carsi: number; sosyal: number }
  event: { on: boolean; name: string; from: number; to: number; factor: number; flows: 'sosyal' | 'carsi' | 'hepsi' }
  accum: { from: number; to: number }            // boarding passengers reach the pier this many minutes before departure
  busHeadway: number; minibusHeadway: number    // minutes (assumption): waiting at the stop is uniform in [0, headway]
  turyolHeadway: number; turyolHours: [number, number]
  gateShare: Record<GateId, number>             // where non-transfer pier/M4 passengers come from / go to (%)
}
export const DEFAULT_CFG: DemandCfg = {
  model: 'dynamic', dayMode: 'auto', window: 'selected', startHour: 0, endHour: 24, coef: {},
  daily: { carsi: 6000, sosyal: 4000 }, weRatio: { carsi: 1.35, sosyal: 1.6 },
  seasonOn: true,
  seasonF: { ilkbahar: { carsi: 1, sosyal: 1 }, yaz: { carsi: 1.05, sosyal: 1.25 }, sonbahar: { carsi: 1, sosyal: 1 }, kis: { carsi: 0.95, sosyal: 0.8 } },
  holidayF: 1, schoolOffF: 1, weather: 'auto', rainF: { carsi: 0.8, sosyal: 0.5 },
  event: { on: false, name: 'Etkinlik', from: 18, to: 22, factor: 1.5, flows: 'sosyal' },
  accum: { from: 30, to: 2 }, busHeadway: 12, minibusHeadway: 4, turyolHeadway: 20, turyolHours: [7, 23],
  gateShare: { carsi: 40, moda: 25, rihtim: 20, sahil: 15 },
}

// ------------------------------------------------------------------ calendar
/** Official public holidays (full days) 2025–2026. */
export const HOLIDAYS: Record<string, string> = {
  '2025-01-01': 'Yılbaşı', '2025-03-30': 'Ramazan Bayramı', '2025-03-31': 'Ramazan Bayramı', '2025-04-01': 'Ramazan Bayramı', '2025-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
  '2025-05-01': 'Emek ve Dayanışma Günü', '2025-05-19': 'Atatürk’ü Anma, Gençlik ve Spor Bayramı', '2025-06-06': 'Kurban Bayramı', '2025-06-07': 'Kurban Bayramı', '2025-06-08': 'Kurban Bayramı',
  '2025-06-09': 'Kurban Bayramı', '2025-07-15': 'Demokrasi ve Millî Birlik Günü', '2025-08-30': 'Zafer Bayramı', '2025-10-29': 'Cumhuriyet Bayramı',
  '2026-01-01': 'Yılbaşı', '2026-03-20': 'Ramazan Bayramı', '2026-03-21': 'Ramazan Bayramı', '2026-03-22': 'Ramazan Bayramı', '2026-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
  '2026-05-01': 'Emek ve Dayanışma Günü', '2026-05-19': 'Atatürk’ü Anma, Gençlik ve Spor Bayramı', '2026-05-27': 'Kurban Bayramı', '2026-05-28': 'Kurban Bayramı', '2026-05-29': 'Kurban Bayramı',
  '2026-05-30': 'Kurban Bayramı', '2026-07-15': 'Demokrasi ve Millî Birlik Günü', '2026-08-30': 'Zafer Bayramı', '2026-10-29': 'Cumhuriyet Bayramı',
}
/** School terms (MEB calendar): first day … last day, semester break excluded. */
const SCHOOL: [string, string][] = [['2024-09-09', '2025-01-17'], ['2025-02-03', '2025-06-20'], ['2025-09-08', '2026-01-16'], ['2026-02-02', '2026-06-26']]
export const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

export function dayInfo(date: string) {
  const dow = new Date(date + 'T12:00:00').getDay()
  const holiday = HOLIDAYS[date] ?? null
  const month = Number(date.slice(5, 7))
  const season: Season = month >= 3 && month <= 5 ? 'ilkbahar' : month >= 6 && month <= 8 ? 'yaz' : month >= 9 && month <= 11 ? 'sonbahar' : 'kis'
  const known = SCHOOL.some(([a]) => date.slice(0, 4) === a.slice(0, 4)) || SCHOOL.some(([, b]) => date.slice(0, 4) === b.slice(0, 4))
  const school = known ? SCHOOL.some(([a, b]) => date >= a && date <= b) : null
  return { dow, dayName: DAYS_TR[dow], holiday, kind: (dow === 0 || dow === 6 || holiday ? 'we' : 'wd') as DayKind,
    service: (dow === 0 || holiday ? 'sun' : dow === 6 ? 'sat' : 'wd') as ServiceDay, month, season, school }
}
export const SEASON_TR: Record<Season, string> = { ilkbahar: 'İlkbahar', yaz: 'Yaz', sonbahar: 'Sonbahar', kis: 'Kış' }

// ------------------------------------------------------------------ hourly demand
export interface HourDemand { flow: FlowId; h: number; coef: number; base: number; mult: number; n: number; why: string[] }

export function coefFor(cfg: DemandCfg, defs: Record<FlowId, Record<DayKind, number[]>>, f: FlowId, d: DayKind) {
  return cfg.coef[f]?.[d] ?? defs[f][d]
}

/** Daily volume per flow (persons per day for this day type) and its source. */
export function dailyVolume(cfg: DemandCfg, rid: Ridership | null, f: FlowId, d: DayKind, month: number) {
  if (f === 'carsi' || f === 'sosyal') return { n: cfg.daily[f] * (d === 'we' ? cfg.weRatio[f] : 1), src: 'varsayım' }
  const k = f.startsWith('iskele') ? 'iskele' : 'metro'
  const day = rid ? (rid.daily[k][String(month)] ?? 0) : 0
  const ratio = rid?.dayRatio?.[k]?.[d] ?? 1
  return { n: day * ratio, src: `İBB ${rid?.year ?? ''} ${month}. ay günlük ort. × ${d === 'we' ? 'hafta sonu' : 'hafta içi'} oranı ${ratio.toLocaleString('tr-TR')}` }
}

/** Passengers per flow and hour for a date, with the multipliers that were applied (each applied once). */
export function flowDemand(cfg: DemandCfg, rid: Ridership | null, date: string, rain: (boolean | null)[]): { day: ReturnType<typeof dayInfo>; kind: DayKind; rows: HourDemand[] } {
  const day = dayInfo(date)
  const kind: DayKind = cfg.dayMode === 'auto' ? day.kind : cfg.dayMode
  const defs = defaultCoef(rid)
  const rows: HourDemand[] = []
  for (const F of FLOWS) {
    const c = coefFor(cfg, defs, F.id, kind)
    const base = dailyVolume(cfg, rid, F.id, kind, day.month).n
    const assumed = F.volume === 'varsayim'
    for (let h = 0; h < 24; h++) {
      let mult = 1
      const why: string[] = []
      if (assumed && cfg.seasonOn) { const s = cfg.seasonF[day.season][F.id as 'carsi' | 'sosyal']; if (s !== 1) { mult *= s; why.push(`${SEASON_TR[day.season]} ×${s}`) } }
      if (day.holiday && cfg.holidayF !== 1) { mult *= cfg.holidayF; why.push(`resmî tatil ×${cfg.holidayF}`) }
      if (assumed && day.school === false && cfg.schoolOffF !== 1) { mult *= cfg.schoolOffF; why.push(`okul tatili ×${cfg.schoolOffF}`) }
      const isRain = cfg.weather === 'rain' || (cfg.weather === 'auto' && !!rain[h])
      if (assumed && isRain) { const r = cfg.rainF[F.id as 'carsi' | 'sosyal']; if (r !== 1) { mult *= r; why.push(`yağış ×${r}`) } }
      const ev = cfg.event
      if (ev.on && h >= ev.from && h < ev.to && (ev.flows === 'hepsi' || ev.flows === F.id)) { mult *= ev.factor; why.push(`${ev.name} ×${ev.factor}`) }
      rows.push({ flow: F.id, h, coef: c[h], base, mult, n: (base * c[h]) / 24 * mult, why })
    }
  }
  return { day, kind, rows }
}

/** Scale an hourly vector so its total is kept but only hours with service carry passengers (no passengers without a sailing). */
export function onService(v: number[], served: boolean[]) {
  const tot = v.reduce((s, x) => s + x, 0)
  const on = v.map((x, i) => (served[i] ? x : 0))
  const s = on.reduce((a, x) => a + x, 0)
  if (s > 0) return on.map(x => (x * tot) / s)
  // the served hours had zero weight: spread evenly over them
  const n = served.filter(Boolean).length
  return served.map(b => (b && n ? tot / n : 0))
}

export interface FerryEvent { kind: 'dep' | 'arr'; t: string; days: ServiceDay[]; line: string; est?: boolean }
export interface FerryData { source: string; fetched: string; lines: { name: string; url: string; piers: string[]; pier_match: string }[]; events: FerryEvent[]; notes: string }
