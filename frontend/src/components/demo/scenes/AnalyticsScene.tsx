export default function AnalyticsScene() {
  const metrics = [
    { label: 'Gross Revenue', value: '$487,232', change: '+12%', color: 'var(--teal)' },
    { label: 'Operating Cost', value: '$298,145', change: '+3%', color: 'var(--ink-3)' },
    { label: 'Gross Profit', value: '$189,087', change: '+24%', color: 'var(--teal-deep)' },
    { label: 'Avg RPM', value: '$2.47', change: '+0.15', color: 'var(--amber)' },
  ];

  const drivers = [
    { name: 'G. Sandhu', miles: 12450, loads: 28, rpm: 2.63, profit: '$32,748' },
    { name: 'J. Dhaliwal', miles: 11820, loads: 26, rpm: 2.41, profit: '$28,522' },
    { name: 'A. Singh', miles: 10890, loads: 24, rpm: 2.72, profit: '$29,638' },
    { name: 'M. Reyes', miles: 9540, loads: 21, rpm: 2.35, profit: '$22,449' },
  ];

  return (
    <section className="scene active" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700 }}>This month, by the numbers.</h1>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--ink-3)' }}>
          Golden Mile's April performance across all trucks, routes, and drivers.
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            padding: '20px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginBottom: '8px', fontWeight: 500 }}>
              {m.label}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
              {m.value}
            </div>
            <div style={{ fontSize: '12px', color: m.color, fontWeight: 600 }}>
              {m.change} vs Mar
            </div>
          </div>
        ))}
      </div>

      {/* Driver Performance Table */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '150px 120px 100px 100px 150px',
          gap: '1px',
          backgroundColor: 'var(--line)',
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}>
          <div>Driver</div>
          <div>Miles</div>
          <div>Loads</div>
          <div>Avg RPM</div>
          <div>Gross Profit</div>
        </div>

        {drivers.map((driver) => (
          <div key={driver.name} style={{
            display: 'grid',
            gridTemplateColumns: '150px 120px 100px 100px 150px',
            gap: '1px',
            padding: '12px 16px',
            borderBottom: '1px solid var(--line-2)',
            fontSize: '13px',
            alignItems: 'center',
          }}>
            <div style={{ fontWeight: 600 }}>{driver.name}</div>
            <div style={{ fontFamily: 'JetBrains Mono', color: 'var(--ink-3)' }}>{driver.miles.toLocaleString()}</div>
            <div style={{ fontFamily: 'JetBrains Mono', color: 'var(--ink-3)' }}>{driver.loads}</div>
            <div style={{
              fontWeight: 600,
              color: driver.rpm >= 2.5 ? 'var(--teal-deep)' : 'var(--amber)',
            }}>
              ${driver.rpm.toFixed(2)}
            </div>
            <div style={{ fontWeight: 600, color: 'var(--teal)' }}>{driver.profit}</div>
          </div>
        ))}

        <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--ink-3)', borderTop: '1px solid var(--line)' }}>
          Top 4 drivers · April 1-30
        </div>
      </div>

      {/* Charts placeholder */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        <div style={{
          padding: '32px 24px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          textAlign: 'center',
          color: 'var(--ink-3)',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            margin: '0 auto 8px',
            backgroundColor: 'var(--teal-soft)',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--teal)',
          }}>↑</div>
          <div style={{ fontSize: '14px', fontWeight: 500 }}>Revenue Trend</div>
        </div>
        <div style={{
          padding: '32px 24px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          textAlign: 'center',
          color: 'var(--ink-3)',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            margin: '0 auto 8px',
            backgroundColor: 'var(--amber-soft)',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--amber)',
          }}>$</div>
          <div style={{ fontSize: '14px', fontWeight: 500 }}>Profitability</div>
        </div>
      </div>
    </section>
  );
}
