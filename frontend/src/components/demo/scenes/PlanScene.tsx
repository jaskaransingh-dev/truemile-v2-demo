import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface Truck {
  id: string;
  number: string;
  driver: string;
  status: string;
  days: string[];
}

const MOCK_TRUCKS: Truck[] = [
  { id: '1', number: '1042', driver: 'G. Sandhu', status: 'OTR', days: ['M 4/27', 'T 4/28', 'W 4/29', 'T 4/30'] },
  { id: '2', number: '1108', driver: 'J. Dhaliwal', status: 'OTR', days: ['M 4/27', 'T 4/28', 'W 4/29'] },
  { id: '3', number: '1156', driver: 'A. Singh', status: 'local', days: ['M 4/27', 'T 4/28', 'W 4/29'] },
  { id: '4', number: '1184', driver: 'M. Reyes', status: 'OTR', days: ['M 4/27', 'T 4/28', 'W 4/29', 'T 4/30', 'F 5/1'] },
];

interface AgentFeed {
  id: string;
  type: 'alert' | 'info';
  title: string;
  body: string;
  action?: string;
}

const AGENT_FEED: AgentFeed[] = [
  {
    id: '1',
    type: 'info',
    title: 'DRIVER TRACKING',
    body: 'J. Morales (Truck #1213) still unloading in Chicago.',
    action: 'Acknowledge',
  },
  {
    id: '2',
    type: 'info',
    title: 'HOURS OF SERVICE',
    body: 'G. Sandhu (Truck #1042) running low on hours.',
    action: 'Acknowledge',
  },
];

export default function PlanScene() {
  const [trucks, setTrucks] = useState<Truck[]>(MOCK_TRUCKS);
  const [feed, setFeed] = useState<AgentFeed[]>(AGENT_FEED);
  const [agentInput, setAgentInput] = useState('');

  const handleAgentSend = () => {
    if (!agentInput.trim()) return;
    // Would send to Rigby AI here
    setAgentInput('');
  };

  return (
    <section className="scene active">
      <div style={{ display: 'flex', height: '100%', gap: '16px', padding: '20px 22px' }}>
        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header with meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: 700 }}>Your week, live.</h1>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Every truck, every dedicated lane, every assignment — pulled from PCS and Samsara in real time.
                The agent watches HOS, maintenance, and market signals as they hit, then re-plans the week with one click.
              </p>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--ink-3)', textAlign: 'right', minWidth: '240px', marginLeft: '20px' }}>
              <strong style={{ color: 'var(--ink)' }}>375 trucks</strong> · <strong style={{ color: 'var(--ink)' }}>580 drivers</strong> · 4 terminals<br />
              <span style={{ fontSize: '12px' }}>Week of <strong style={{ color: 'var(--ink)' }}>Apr 27, 2026</strong></span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <button className="btn-primary">View live data sources →</button>
            <button className="btn-dark">Make optimal assignments →</button>
          </div>

          {/* Status cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
            <div className="status-card" style={{ backgroundColor: 'var(--teal-soft)' }}>
              <div className="status-number">191</div>
              <div className="status-label">Trucks moving today</div>
            </div>
            <div className="status-card" style={{ backgroundColor: '#F0F4FF' }}>
              <div className="status-number">29</div>
              <div className="status-label">Empty · Load needed</div>
            </div>
            <div className="status-card" style={{ backgroundColor: 'var(--red-soft)' }}>
              <div className="status-number">2</div>
              <div className="status-label">Urgent action needed</div>
            </div>
            <div className="status-card" style={{ backgroundColor: 'var(--surface-alt)' }}>
              <div className="status-number">0</div>
              <div className="status-label">Plan updates needed</div>
            </div>
          </div>

          {/* Browser window */}
          <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Browser bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 16px',
              backgroundColor: 'var(--surface)',
              borderBottom: '1px solid var(--line)',
              fontSize: '12px',
            }}>
              {/* Traffic lights */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#FF6057' }}></div>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#FFBD2E' }}></div>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#28C940' }}></div>
              </div>
              {/* URL */}
              <div style={{ flex: 1, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono', fontSize: '11px' }}>
                goldenmile.truemile.ai/plan
              </div>
              {/* Status pill */}
              <div style={{
                padding: '4px 10px',
                backgroundColor: 'var(--teal-soft)',
                color: 'var(--teal-deep)',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: 600,
              }}>
                Synced · 2 sec ago
              </div>
            </div>

            {/* Grid content */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, overflow: 'auto' }}>
              {/* Grid header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '100px 120px 150px 100px 100px 100px 100px',
                gap: '1px',
                backgroundColor: 'var(--line)',
                padding: '12px 16px',
                borderBottom: '1px solid var(--line)',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
              }}>
                <div>Truck</div>
                <div>Driver</div>
                <div>Status</div>
                <div>Mon 4/27</div>
                <div>Tue 4/28</div>
                <div>Wed 4/29</div>
                <div>Thu 4/30</div>
              </div>

              {/* Grid rows */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {trucks.map((truck) => (
                  <div
                    key={truck.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 120px 150px 100px 100px 100px 100px',
                      gap: '1px',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--line-2)',
                      fontSize: '13px',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontFamily: 'JetBrains Mono' }}>#{truck.number}</div>
                    <div>{truck.driver}</div>
                    <div>
                      <span className="badge" style={{
                        backgroundColor: truck.status === 'OTR' ? 'var(--teal-soft)' : 'var(--amber-soft)',
                        color: truck.status === 'OTR' ? 'var(--teal-deep)' : 'var(--amber)',
                      }}>
                        {truck.status.toUpperCase()}
                      </span>
                    </div>
                    {truck.days.slice(0, 4).map((day, idx) => (
                      <div key={idx} style={{ fontSize: '12px', color: 'var(--ink-3)' }}>{day}</div>
                    ))}
                  </div>
                ))}
              </div>

              <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--ink-3)', borderTop: '1px solid var(--line)' }}>
                Showing 45 of 375 trucks · all terminals
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar - Agent */}
        <div style={{
          width: '320px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          borderLeft: '1px solid var(--line)',
          paddingLeft: '16px',
        }}>
          {/* Agent chat header */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-3)', marginBottom: '8px' }}>
              Tell the agent what changed
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="e.g. 'J. Dhaliwal called in sick'"
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAgentSend()}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              />
              <button
                onClick={handleAgentSend}
                className="btn-dark"
                style={{ padding: '8px 16px', fontSize: '12px' }}
              >
                Send
              </button>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {['J. Dhaliwal sick', 'A. Singh truck down', 'M. Reyes home Thu'].map((action) => (
              <button
                key={action}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'transparent',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: 'var(--ink-3)',
                  transition: 'all 0.18s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-alt)';
                  e.currentTarget.style.borderColor = 'var(--line)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {action}
              </button>
            ))}
          </div>

          {/* Agent feed */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '12px' }}>
              Agent feed
              <span style={{ marginLeft: '8px', color: 'var(--ink-3)' }}>20 pending</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {feed.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--surface-alt)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: '4px' }}>● {item.title}</div>
                  <div style={{ color: 'var(--ink-3)', marginBottom: '8px' }}>{item.body}</div>
                  {item.action && (
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--teal)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      {item.action}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
