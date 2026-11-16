import { useEffect, useLayoutEffect, useState } from 'react'

/** Light / dark theme: the system setting on first visit, an explicit choice is remembered per viewer.
 *  Only the `data-theme` attribute on <html> changes, so nothing reloads (maps and simulations keep running). */
export type Theme = 'light' | 'dark'
const KEY = 'transheat.theme'
const mq = () => window.matchMedia('(prefers-color-scheme: dark)')

export function useTheme() {
  const [saved, setSaved] = useState<Theme | null>(() => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null } catch { return null } })
  const [system, setSystem] = useState<Theme>(() => (mq().matches ? 'dark' : 'light'))
  useEffect(() => {
    const m = mq(), h = () => setSystem(m.matches ? 'dark' : 'light')
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  useLayoutEffect(() => {
    const el = document.documentElement
    if (saved) el.dataset.theme = saved; else delete el.dataset.theme
  }, [saved])
  const set = (t: Theme) => { try { localStorage.setItem(KEY, t) } catch { /* storage unavailable */ } setSaved(t) }
  return { theme: saved ?? system, set }
}
