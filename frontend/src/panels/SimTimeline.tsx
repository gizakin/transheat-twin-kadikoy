import { useEffect, useRef } from 'react'
import { ped, simClock, usePed } from '../engine/pedctl'

const n0 = (x: number) => Math.round(x).toLocaleString('tr-TR')
const I = {
  play: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>,
  restart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>,
}

/** Playback bar of the pedestrian simulation, docked at the bottom of the map. Ferry arrivals of the schedule are marked on the track. */
export default function SimTimeline({ onClose }: { onClose: () => void }) {
  const { running, speed, info } = usePed()
  const done = useRef<HTMLDivElement>(null), knob = useRef<HTMLDivElement>(null), clk = useRef<HTMLSpanElement>(null)
  const infoRef = useRef(info); infoRef.current = info
  // smooth progress: read the simulation clock every frame, outside React
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const i = infoRef.current
      if (i && i.tEnd > 0) {
        const f = Math.min(1, ped.t / i.tEnd)
        if (done.current) done.current.style.width = `${100 * f}%`
        if (knob.current) knob.current.style.left = `${100 * f}%`
        if (clk.current) clk.current.textContent = simClock(i.start, ped.t)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!info) return null
  const ready = !info.busy && info.tEnd > 0
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget, r = el.getBoundingClientRect()
    const at = (x: number) => { ped.t = Math.max(0, Math.min(1, (x - r.left) / r.width)) * info.tEnd }
    at(e.clientX)
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => at(ev.clientX)
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
  }
  const ticks = ready ? [0, 0.25, 0.5, 0.75, 1].map(f => (f === 1 && info.tEnd >= 86399 ? '24:00' : simClock(info.start, f * info.tEnd))) : []
  return <section className="tl" aria-label="Yaya simülasyonu zaman çizelgesi">
    <div className="tl-r1">
      <button className="pb" onClick={() => { ped.t = 0; ped.set({ running: true }) }} disabled={!ready} aria-label="Yeniden başlat" title="Yeniden başlat">{I.restart}</button>
      <button className="pb main" onClick={() => ped.set({ running: !running })} disabled={!ready} aria-label={running ? 'Duraklat' : ped.t > 0 ? 'Devam et' : 'Başlat'}
        title={running ? 'Duraklat' : ped.t > 0 ? 'Devam et' : 'Başlat'}>{running ? I.pause : I.play}</button>
      <button className="pb" onClick={() => { ped.set({ running: false }); ped.t = 0 }} disabled={!ready} aria-label="Durdur" title="Durdur (başa döner)">{I.stop}</button>
      <span className="tl-t" ref={clk}>{simClock(info.start, ped.t)}</span>
      <div className="tl-cap">
        <b>Yaya akışı · {info.label ?? (info.ibb ? 'İBB yolcu verisi' : 'varsayım talep')}</b>
        <span>{info.busy || <>{n0(info.n)} yürüyüş / {info.windowMin >= 120 ? `${info.windowMin / 60} sa` : `${info.windowMin} dk`} · şu an {n0(info.walking)} yürüyor{info.night ? '' : `, ${n0(info.inSun)} güneşte`}{info.waitPier != null ? ` · ${n0(info.waitPier + (info.waitStop ?? 0))} bekliyor` : ''} · {info.ferries.length} vapur varışı{info.deps?.length ? `, ${info.deps.length} kalkış` : ''}</>}</span>
      </div>
      <div className="seg tl-speed">{(info.windowMin > 120 ? [60, 300, 900] : [10, 30, 60]).map(v => <button key={v} className={speed === v ? 'on' : ''} onClick={() => ped.set({ speed: v })} title={`${v} kat hız`}>×{v}</button>)}</div>
      <button className="tl-x" onClick={onClose} aria-label="Yaya akışını kapat" title="Yaya akışını kapat">✕</button>
    </div>
    <div className="tl-track" onPointerDown={ready ? seek : undefined} role="slider" aria-label="Simülasyon zamanı" aria-valuemin={0} aria-valuemax={Math.round(info.tEnd)} tabIndex={0}
      onKeyDown={e => { if (e.key === 'ArrowRight') ped.t = Math.min(info.tEnd, ped.t + 60); if (e.key === 'ArrowLeft') ped.t = Math.max(0, ped.t - 60) }}>
      <div className="bar" /><div className="done" ref={done} /><div className="knob" ref={knob} />
      {ready && info.ferries.filter(f => f >= 0 && f <= info.tEnd).map((f, i) => <i key={'a' + i} className="ferry" style={{ left: `${(100 * f) / info.tEnd}%` }} title={`vapur varışı ${simClock(info.start, f)}`} />)}
      {ready && (info.deps ?? []).filter(f => f >= 0 && f <= info.tEnd).map((f, i) => <i key={'d' + i} className="ferry dep" style={{ left: `${(100 * f) / info.tEnd}%` }} title={`vapur kalkışı ${simClock(info.start, f)}`} />)}
      <div className="ticks">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
    </div>
  </section>
}
