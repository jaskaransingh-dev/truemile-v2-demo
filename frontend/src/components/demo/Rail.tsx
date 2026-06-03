import { Home, Search, BarChart3, Settings } from 'lucide-react';

interface RailProps {
  activeScene: number;
  onSceneChange: (scene: number) => void;
}

export default function Rail({ activeScene, onSceneChange }: RailProps) {
  return (
    <aside className="rail" aria-label="Primary navigation">
      <div className="rail-header">
        <div className="rail-brand-row">
          <svg className="rail-brand-mark" viewBox="0 0 174 174" xmlns="http://www.w3.org/2000/svg" aria-label="TrueMile">
            <g transform="translate(-37, -41)">
              <line x1="60" y1="128" x2="124" y2="128" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <line x1="124" y1="128" x2="172" y2="86" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <line x1="124" y1="128" x2="172" y2="170" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <circle cx="124" cy="128" r="13" fill="currentColor" />
              <polygon points="170,79 188,79 179,65" fill="currentColor" />
              <polygon points="170,177 188,177 179,191" fill="currentColor" />
              <polygon points="167,128 191,116 191,140" fill="currentColor" />
            </g>
          </svg>
          <div className="rail-brand-text">
            <span className="rail-brand-primary">true<span className="accent">mile</span></span>
            <span className="rail-brand-secondary">Fleet</span>
          </div>
        </div>
        <div className="rail-workspace-label">
          <span style={{ fontWeight: 500 }}>Golden Mile Inc.</span>
          <span style={{ fontSize: '12px', color: 'var(--ink-3)' }}>375 trucks · 4 terminals</span>
        </div>
      </div>

      <nav className="rail-nav">
        <div className="rail-section">
          <div className="rail-section-label">Navigate</div>
          <button
            className={`rail-nav-item ${activeScene === 1 ? 'active' : ''}`}
            onClick={() => onSceneChange(1)}
          >
            <span className="rail-nav-number">01</span>
            <span className="rail-nav-label">Plan</span>
          </button>
          <button
            className={`rail-nav-item ${activeScene === 2 ? 'active' : ''}`}
            onClick={() => onSceneChange(2)}
          >
            <span className="rail-nav-number">02</span>
            <span className="rail-nav-label">Find & fill</span>
          </button>
          <button
            className={`rail-nav-item ${activeScene === 3 ? 'active' : ''}`}
            onClick={() => onSceneChange(3)}
          >
            <span className="rail-nav-number">03</span>
            <span className="rail-nav-label">Analytics</span>
          </button>
        </div>

        <div className="rail-section">
          <div className="rail-section-label">Account</div>
          <button className="rail-nav-item">
            <Settings size={16} />
            <span className="rail-nav-label">Settings</span>
          </button>
          <div className="rail-account">
            <div className="rail-account-avatar">H</div>
            <span>Harjot Singh</span>
          </div>
        </div>
      </nav>

      <div className="rail-footer">
        <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginBottom: '8px' }}>
          <span className="dot" style={{ display: 'inline-block', marginRight: '6px' }}></span>
          Live · synced from PCS & Samsara
        </div>
      </div>
    </aside>
  );
}
