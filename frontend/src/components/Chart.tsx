import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

// Categorical slots in fixed order (validated light/dark; see dataviz reference palette).
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']

export function isDark() {
  const t = document.documentElement.dataset.theme
  if (t) return t === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function chartTokens() {
  const dark = isDark()
  return {
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    ink: dark ? '#e5eef0' : '#12262c',
    ink2: dark ? '#b2c3c7' : '#44585e',
    grid: dark ? '#26353c' : '#e3e9ea',
    surface: dark ? '#141e23' : '#ffffff',
    divNeg: dark ? '#e66767' : '#e34948',
    divPos: dark ? '#3987e5' : '#2a78d6',
    divMid: dark ? '#383835' : '#f0efec',
  }
}

export default function Chart({ option, height = 320 }: { option: (t: ReturnType<typeof chartTokens>) => echarts.EChartsOption; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    inst.current = echarts.init(el.current!, undefined, { renderer: 'svg' })
    const ro = new ResizeObserver(() => inst.current?.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); inst.current?.dispose() }
  }, [])
  useEffect(() => {
    const t = chartTokens()
    inst.current?.setOption({
      textStyle: { color: t.ink, fontFamily: 'IBM Plex Sans, Segoe UI, system-ui, sans-serif' },
      color: t.series,
      ...option(t),
    }, true)
  })
  return <div ref={el} style={{ width: '100%', height }} />
}
