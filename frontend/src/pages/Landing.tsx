// Entry screen: brand, place, developer and four module cards that open the map with matching layers.
import type { ReactNode } from 'react'
export type Module = 'heat' | 'transport' | 'green' | 'scenario'

const MODULES: { id: Module; title: string; sub: string; icon: ReactNode }[] = [
  { id: 'heat', title: 'Kentsel Isı Analizi', sub: 'Uydu yüzey sıcaklığı ve proje simülasyonu', icon: <Icon d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /> },
  { id: 'transport', title: 'Ulaşım Analizi', sub: 'Canlı trafik (İBB), İETT durakları, durağa erişim', icon: <Icon d="M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12H4zM6 18v2M18 18v2" /> },
  { id: 'green', title: 'Yeşil Alan ve Gölge', sub: 'Ağaç taçları, gölge ve yüzey sınıfları', icon: <Icon d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6" /> },
  { id: 'scenario', title: 'Senaryo Simülasyonu', sub: 'Alan seçin, müdahale ekleyin, karşılaştırın', icon: <Icon d="M3 3v18h18M7 16v-4M12 16V8M17 16v-7" /> },
]

export function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
}

export default function Landing({ onOpen, ready }: { onOpen: (m: Module | null) => void; ready: boolean }) {
  return <div className="landing" role="dialog" aria-label="Platform tanıtımı">
    <div className="landing-hero">
      <div className="landing-text">
        <img className="landing-logo" src="brand/logo.png" alt="Transheat Twin" />
        <h1>Dijital İkiz ve<br />Kentsel Analiz Platformu</h1>
        <div className="landing-place">
          <Icon size={18} d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
          Kadıköy Meydanı Ulaşım ve Kentsel Isı Dijital İkizi
        </div>
        <div className="landing-rule" />
        <div className="landing-dev"><span>Geliştirici</span><b>Transheat Twin</b></div>
        <button className="btn primary landing-go" onClick={() => onOpen(null)} disabled={!ready}>{ready ? 'Haritaya geç' : 'Veri yükleniyor…'}</button>
      </div>
      <figure className="landing-img">
        <img src="brand/hero.webp" alt="" />
        <figcaption>Temsili görsel: ölçüm ya da model çıktısı değildir</figcaption>
      </figure>
    </div>
    <nav className="landing-cards">
      {MODULES.map(m => <button key={m.id} className="landing-card" onClick={() => onOpen(m.id)} disabled={!ready}>
        <span className="lc-icon">{m.icon}</span><span><b>{m.title}</b><small>{m.sub}</small></span>
      </button>)}
    </nav>
  </div>
}
