// Solar position — NOAA Solar Calculator equations (Meeus-based), with atmospheric refraction.
// Accuracy is well within 0.1° for these dates, sufficient for geometric shadow casting.
export const LAT = 40.9905, LON = 29.023
const UTC_OFFSET_H = 3 // Türkiye uses UTC+3 all year (since 2016)

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export interface Sun { elevation: number; azimuth: number; time: string }

export function sunPosition(isoLocal: string, lat = LAT, lon = LON): Sun {
  const [d, t] = isoLocal.split('T')
  const [Y, M, D] = d.split('-').map(Number)
  const [hh, mm] = (t ?? '12:00').split(':').map(Number)
  const utcMin = (hh - UTC_OFFSET_H) * 60 + mm
  const ms = Date.UTC(Y, M - 1, D) + utcMin * 60000
  const jd = ms / 86400000 + 2440587.5
  const T = (jd - 2451545) / 36525
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
  const Ma = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const C = Math.sin(rad(Ma)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * Ma)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * Ma)) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega))
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(rad(omega))
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)))
  const y = Math.tan(rad(eps / 2)) ** 2
  const eot = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(Ma)) + 4 * e * y * Math.sin(rad(Ma)) * Math.cos(2 * rad(L0))
    - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(Ma)))
  const minutesOfDayUTC = ((utcMin % 1440) + 1440) % 1440
  const tst = (minutesOfDayUTC + eot + 4 * lon) % 1440
  const ha = rad(tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180)
  const phi = rad(lat)
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)))
  let el = 90 - deg(zen)
  // refraction (NOAA)
  const te = Math.tan(rad(el))
  let refr = 0
  if (el > 85) refr = 0
  else if (el > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
  else if (el > -0.575) refr = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))
  else refr = -20.772 / te
  el += refr / 3600
  const az = (deg(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi))) + 180 + 360) % 360
  return { elevation: el, azimuth: az, time: isoLocal }
}
