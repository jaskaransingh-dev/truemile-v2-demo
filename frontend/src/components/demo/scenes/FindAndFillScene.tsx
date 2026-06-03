export default function FindAndFillScene() {
  const mockLoads = [
    { id: 1, origin: 'KC, MO', dest: 'Memphis, TN', rate: 3200, miles: 1050, rpm: 3.05, fit: 95 },
    { id: 2, origin: 'Kansas City, KS', dest: 'Nashville, TN', rate: 2900, miles: 980, rpm: 2.96, fit: 88 },
    { id: 3, origin: 'Raytown, MO', dest: 'Little Rock, AR', rate: 2100, miles: 850, rpm: 2.47, fit: 72 },
    { id: 4, origin: 'Independence, MO', dest: 'Birmingham, AL', rate: 3500, miles: 1200, rpm: 2.92, fit: 65 },
  ];

  return (
    <section className="scene active" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700 }}>When there's a gap, the agent fills it.</h1>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--ink-3)', lineHeight: 1.5 }}>
          TrueMile sees the open mile in real time, scans DAT, and ranks loads by RPM, fit to the driver's schedule, and home time.
        </p>
      </div>

      {/* Driver Itinerary */}
      <div style={{
        display: 'flex',
        gap: '20px',
        padding: '16px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
        alignItems: 'center',
      }}>
        <div style={{ minWidth: '150px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>J. Dhaliwal</div>
          <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>Truck #1108 · 35h HOS · home OKC</div>
        </div>

        <div style={{ flex: 1, display: 'flex', gap: '12px', alignItems: 'center', fontSize: '13px' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Boise, ID</div>
            <div style={{ color: 'var(--ink-3)', fontSize: '11px' }}>Picked up Fri</div>
          </div>
          <div style={{ color: 'var(--ink-3)' }}>→</div>
          <div style={{ padding: '8px 12px', backgroundColor: 'var(--teal-soft)', borderRadius: '6px', border: '1px solid rgba(14,131,120,0.3)' }}>
            <div style={{ fontWeight: 600, color: 'var(--teal-deep)' }}>KC, MO</div>
            <div style={{ color: 'var(--teal-deep)', fontSize: '11px' }}>Empty here · need load</div>
          </div>
          <div style={{ color: 'var(--ink-3)' }}>→</div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>OKC home</div>
            <div style={{ color: 'var(--ink-3)', fontSize: '11px' }}>by Sun May 4</div>
          </div>
        </div>
      </div>

      {/* Agent reasoning */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: 'var(--amber-soft)',
        border: '1px solid rgba(197,138,31,0.2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '13px',
        color: 'var(--ink)',
        lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--amber)' }}>● Agent reasoning</strong>
        <div style={{ marginTop: '4px', color: 'var(--ink-3)' }}>
          Looking for a load originating in KC, delivering by Fri afternoon, within 200 mi of OKC. Prefer ≥$2.80 RPM.
        </div>
      </div>

      {/* Load board */}
      <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '100px 120px 120px 100px 100px 80px 100px 80px',
          gap: '1px',
          backgroundColor: 'var(--line)',
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}>
          <div>Origin</div>
          <div>Dest</div>
          <div>Broker</div>
          <div>Rate</div>
          <div>Miles</div>
          <div>RPM</div>
          <div>Fit</div>
          <div>Action</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {mockLoads.map((load) => (
            <div
              key={load.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '100px 120px 120px 100px 100px 80px 100px 80px',
                gap: '1px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--line-2)',
                fontSize: '13px',
                alignItems: 'center',
              }}
            >
              <div style={{ fontWeight: 500 }}>{load.origin}</div>
              <div>{load.dest}</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>DAT Freight</div>
              <div style={{ fontWeight: 600 }}>${load.rate.toLocaleString()}</div>
              <div style={{ fontFamily: 'JetBrains Mono' }}>{load.miles.toLocaleString()}</div>
              <div style={{
                fontWeight: 600,
                color: load.rpm >= 2.8 ? 'var(--teal-deep)' : load.rpm >= 2.5 ? 'var(--amber)' : 'var(--red)',
              }}>
                ${load.rpm.toFixed(2)}
              </div>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: load.fit >= 85 ? 'var(--teal-deep)' : 'var(--amber)',
              }}>
                {load.fit}%
              </div>
              <button style={{
                padding: '4px 8px',
                backgroundColor: 'var(--teal)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}>
                Propose
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--ink-3)', borderTop: '1px solid var(--line)' }}>
          4 loads ranked by fit, RPM, and home time
        </div>
      </div>
    </section>
  );
}
