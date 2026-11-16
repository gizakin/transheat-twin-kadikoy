import { useEffect, useState, type ReactNode } from 'react'

/** Accordion section of the side panels. Closed by default; the viewer's open/closed choice is remembered.
 *  `keep` keeps the content mounted while closed (for parts that must keep running, e.g. the pedestrian simulation). */
// key v2: open states saved by earlier versions are dropped once, so every section starts closed
const read = (id: string) => { try { return localStorage.getItem(`transheat.acc2.${id}`) === '1' } catch { return false } }
const write = (id: string, v: boolean) => { try { localStorage.setItem(`transheat.acc2.${id}`, v ? '1' : '0') } catch { /* storage unavailable */ } }

/** Open an accordion from elsewhere (e.g. after a scenario run). Not remembered: the next visit starts closed again. */
export const openAcc = (...ids: string[]) => ids.forEach(id => window.dispatchEvent(new CustomEvent('tt-acc', { detail: id })))

export function Acc({ id, title, icon, count, children, keep = false, sub = false }: {
  id: string; title: ReactNode; icon?: keyof typeof ICONS; count?: ReactNode; children: ReactNode; keep?: boolean; sub?: boolean
}) {
  const [open, setOpen] = useState(() => read(id))
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail === id) setOpen(true) }
    window.addEventListener('tt-acc', h)
    return () => window.removeEventListener('tt-acc', h)
  }, [id])
  const toggle = () => setOpen(o => { write(id, !o); return !o })
  return <section className={`${sub ? 'sub' : 'acc'} ${open ? 'open' : ''}`} data-acc={id}>
    <button className="acc-head" onClick={toggle} aria-expanded={open}>
      {icon && <span className="ic" aria-hidden="true">{ICONS[icon]}</span>}
      <span className="acc-title">{title}</span>
      {count != null && count !== '' && <span className="cnt">{count}</span>}
      <span className="chev" aria-hidden="true">›</span>
    </button>
    {(open || keep) && <div className="acc-body" hidden={!open}>{children}</div>}
  </section>
}

/** Small status line for a data source that could not be reached: last success and a retry. Never a substitute value. */
export function Status({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <div className="status" role="status"><span className="dot" aria-hidden="true" /><span>{children}</span>
    {onRetry && <button onClick={onRetry}>Tekrar dene</button>}</div>
}

const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
export const ICONS = {
  scenario: svg(<path d="M4 19h16M4 15l4-4 4 3 6-7" />),
  area: svg(<path d="M4 4h16v16H4z" strokeDasharray="3 2" />),
  tree: svg(<path d="M12 22V12M7 12a5 5 0 1 1 10 0z" />),
  layers: svg(<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />),
  tools: svg(<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></>),
  pulse: svg(<path d="M3 12h4l3-8 4 16 3-8h4" />),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  thermo: svg(<path d="M14 14.8V3.5a2.5 2.5 0 0 0-5 0v11.3a4.5 4.5 0 1 0 5 0z" />),
  leaf: svg(<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.4 5-6" />),
  bus: svg(<><rect x="4" y="4" width="16" height="13" rx="2" /><path d="M4 11h16M8 21v-4M16 21v-4" /></>),
  walk: svg(<><circle cx="13" cy="4" r="2" /><path d="M9 21l2-6 3 3v3M7 12l3-4 4 2 2 4" /></>),
  chart: svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
}
