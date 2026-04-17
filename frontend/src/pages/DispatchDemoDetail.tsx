import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDriverByName, BADGE_STYLES, RATE_CON_KEY, type Driver, type Load, type StatusColor, type RateConResult } from '../data/demoDrivers';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DispatchDemoDetail() {
  const { driverName } = useParams<{ driverName: string }>();
  const navigate = useNavigate();
  const baseDriver = getDriverByName(driverName ?? '');

  // Apply rate con override if it exists for this driver
  const rateConLoad = (() => {
    try {
      const stored = localStorage.getItem(RATE_CON_KEY);
      if (!stored) return null;
      const rc: RateConResult = JSON.parse(stored);
      if (rc.driverName.toLowerCase() !== (driverName ?? '').toLowerCase()) return null;
      return rc;
    } catch { return null; }
  })();

  const driver = baseDriver ? {
    ...baseDriver,
    ...(rateConLoad ? { status: 'Load Booked', statusColor: 'teal' as StatusColor } : {}),
  } as Driver : null;

  if (!driver) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <span style={S.backLink} onClick={() => navigate('/demo')}>&larr; Back</span>
        </div>
        <div style={{ padding: 40, color: '#6B7280', textAlign: 'center' }}>
          Driver &ldquo;{driverName}&rdquo; not found.
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logo}>True<span style={S.logoAccent}>Mile</span></span>
          <span style={S.headerLabel}>Dispatch Console</span>
        </div>
        <span style={S.headerRight}>April 7, 2026</span>
      </div>

      {/* Full-width body */}
      <div style={S.body}>
        <MainContent driver={driver} navigate={navigate} rateConLoad={rateConLoad} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content — date filter, metrics bar, cycle info, loads
// ---------------------------------------------------------------------------

function MainContent({ driver, navigate, rateConLoad }: { driver: Driver; navigate: ReturnType<typeof useNavigate>; rateConLoad: RateConResult | null }) {
  const c = driver.cycle;
  const [dateFilter, setDateFilter] = useState<string>(c?.selectedMonth ?? 'Mar 2026');
  const filters = ['YTD', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026'];

  const metrics = c ? [
    { label: 'Revenue Tracking', value: `$${c.revenue.toLocaleString()}` },
    { label: 'Average RPM',      value: `$${c.avgRPM.toFixed(2)}` },
    { label: 'Miles Driven',     value: c.milesDriven.toLocaleString() },
    { label: 'Utilization %',    value: `${c.utilization}%` },
    { label: 'Fuel %',           value: `${c.fuelPct}%` },
    { label: 'CPM',              value: `$${c.cpm.toFixed(2)}` },
  ] : [];

  const cycleInfo = c ? [
    { label: 'Latest Cycle Details', value: c.cycleStarted },
    { label: 'Home City',            value: c.homeCity },
    { label: 'Home By Date',         value: c.homeByDate },
  ] : [];

  return (
    <div style={S.main}>
      {/* Back link */}
      <div style={{ ...S.backLink, marginBottom: 16 }} onClick={() => navigate('/demo')}>&larr; All Drivers</div>

      {/* Row 1: Date filter + Find Next Load */}
      <div style={S.topRow}>
        <div style={S.filterRow}>
          {filters.map((f) => (
            <button key={f}
              style={{ ...S.filterBtn, ...(dateFilter === f ? S.filterBtnActive : {}) }}
              onClick={() => setDateFilter(f)}
            >{f}</button>
          ))}
        </div>
        <button style={S.findBtnSmall}
          onClick={() => window.open(`https://one.dat.com/search-loads?origin=${encodeURIComponent(driver.currentLocation)}`, '_blank')}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1D9E75'; e.currentTarget.style.color = '#FFF'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1D9E75'; }}
        >Find Next Load</button>
      </div>

      {/* Row 2: Revenue metrics — 6 cards */}
      {c && (
        <div style={S.metricsBar}>
          {metrics.map((m) => (
            <div key={m.label} style={S.metricCard}>
              <div style={S.metricCardLabel}>{m.label}</div>
              <div style={S.metricCardValue}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Row 3: Cycle info — 3 fields */}
      {c && (
        <div style={S.cycleInfoBar}>
          {cycleInfo.map((m) => (
            <div key={m.label} style={S.cycleInfoItem}>
              <span style={S.cycleInfoLabel}>{m.label}</span>
              <span style={S.cycleInfoValue}>{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Load table */}
      <LoadTable driver={driver} rateConLoad={rateConLoad} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Load Table
// ---------------------------------------------------------------------------

function LoadTable({ driver, rateConLoad }: { driver: Driver; rateConLoad: RateConResult | null }) {
  const [loads, setLoads] = useState<Load[]>(() => {
    const base = driver.cycle?.loads ?? [];
    if (!rateConLoad) return base;
    const rcLoad: Load = {
      loadId: rateConLoad.loadId,
      pickup: rateConLoad.pickup,
      pickupTime: rateConLoad.pickupTime,
      deadhead: 0,
      dropoff: rateConLoad.delivery,
      dropoffTime: rateConLoad.deliveryTime,
      rate: rateConLoad.rate,
      miles: rateConLoad.miles,
      rpm: Math.round((rateConLoad.rate / rateConLoad.miles) * 100) / 100,
    };
    return [...base, rcLoad];
  });
  const [toast, setToast] = useState<string | null>(null);

  const handleBookLoad = () => {
    const newLoad: Load = {
      loadId: 'NEW-' + Date.now().toString(36).toUpperCase(),
      pickup: 'Atlanta, GA',
      pickupTime: '10:00 AM · Apr 8',
      deadhead: 12,
      dropoff: 'Jacksonville, FL',
      dropoffTime: '6:00 PM · Apr 8',
      rate: 1850,
      miles: 346,
      rpm: 5.35,
    };
    setLoads((prev) => [...prev, newLoad]);
    setToast(`Text sent to ${driver.name}`);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div style={{ position: 'relative' as const }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={S.sectionTitle}>Load Level Details</div>
        <button style={S.bookBtn}
          onClick={handleBookLoad}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1D9E75'; e.currentTarget.style.color = '#FFF'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1D9E75'; }}
        >+ Book Load</button>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Load Number</th>
            <th style={S.th}>Pick Up Location / Time</th>
            <th style={S.th}>Deadhead</th>
            <th style={S.th}>Drop Off Location / Time</th>
            <th style={S.th}>Total Rate</th>
            <th style={S.th}>Loaded Miles</th>
            <th style={S.th}>RPM</th>
          </tr>
        </thead>
        <tbody>
          {loads.map((l, i) => {
            const isNew = l.loadId.startsWith('NEW-') || (rateConLoad && l.loadId === rateConLoad.loadId);
            const rowBg = isNew ? '#0F2A1A' : i % 2 === 0 ? '#0D0F12' : '#111419';
            return (
              <tr key={l.loadId} style={{ background: rowBg }}>
                <td style={S.td}>
                  <span style={{ color: '#FFF', fontWeight: 500 }}>#{l.loadId}</span>
                  {isNew && <span style={{ marginLeft: 6, fontSize: 10, color: '#4ADE80', fontWeight: 600 }}>NEW</span>}
                </td>
                <td style={S.td}>
                  <div style={{ color: '#FFF' }}>{l.pickup}</div>
                  <div style={{ color: '#6B7280', fontSize: 11 }}>{l.pickupTime}</div>
                </td>
                <td style={S.td}>{l.deadhead} mi</td>
                <td style={S.td}>
                  <div style={{ color: '#FFF' }}>{l.dropoff}</div>
                  <div style={{ color: '#6B7280', fontSize: 11 }}>{l.dropoffTime}</div>
                </td>
                <td style={S.td}>${l.rate.toLocaleString()}</td>
                <td style={S.td}>{l.miles.toLocaleString()}</td>
                <td style={{ ...S.td, color: l.rpm >= 3.5 ? '#4ADE80' : l.rpm >= 3.0 ? '#E5E7EB' : '#FAC775' }}>
                  ${l.rpm.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  page: {
    width: '100vw', height: '100vh', overflow: 'hidden',
    background: '#0D0F12', color: '#E5E7EB',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13, display: 'flex', flexDirection: 'column' as const,
  } as React.CSSProperties,

  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 52, padding: '0 24px', borderBottom: '1px solid #1E2128',
    background: '#0D0F12', flexShrink: 0,
  } as React.CSSProperties,

  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 } as React.CSSProperties,
  logo: { fontSize: 16, fontWeight: 700, color: '#FFF', letterSpacing: -0.3 } as React.CSSProperties,
  logoAccent: { color: '#1D9E75' } as React.CSSProperties,
  headerLabel: { fontSize: 13, color: '#6B7280', borderLeft: '1px solid #1E2128', paddingLeft: 10 } as React.CSSProperties,
  headerRight: { fontSize: 12, color: '#6B7280' } as React.CSSProperties,

  body: { display: 'flex', flex: 1, overflow: 'hidden' } as React.CSSProperties,

  backLink: { fontSize: 12, color: '#6B7280', cursor: 'pointer', userSelect: 'none' as const } as React.CSSProperties,

  // Main content
  main: { flex: 1, overflow: 'auto', padding: '20px 24px' } as React.CSSProperties,

  topRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  } as React.CSSProperties,

  filterRow: { display: 'flex', gap: 4 } as React.CSSProperties,

  filterBtn: {
    background: 'transparent', border: '1px solid #1E2128', borderRadius: 4,
    color: '#6B7280', fontSize: 11, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.1s',
  } as React.CSSProperties,

  filterBtnActive: { background: '#1E2128', color: '#FFF', borderColor: '#334155' } as React.CSSProperties,

  findBtnSmall: {
    background: 'transparent', border: '1px solid #1D9E75', borderRadius: 4,
    color: '#1D9E75', fontSize: 12, fontWeight: 600, padding: '5px 14px',
    cursor: 'pointer', transition: 'all 0.15s',
  } as React.CSSProperties,

  // Metrics bar — 6 cards
  metricsBar: { display: 'flex', gap: 10, marginBottom: 16 } as React.CSSProperties,

  metricCard: {
    flex: 1, background: '#111419', border: '1px solid #1E2128', borderRadius: 6, padding: '12px 14px',
  } as React.CSSProperties,

  metricCardLabel: {
    fontSize: 10, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4,
  } as React.CSSProperties,

  metricCardValue: { fontSize: 18, fontWeight: 600, color: '#FFF' } as React.CSSProperties,

  // Cycle info bar — 3 fields
  cycleInfoBar: {
    display: 'flex', gap: 10, marginBottom: 20, padding: '10px 14px',
    background: '#111419', border: '1px solid #1E2128', borderRadius: 6,
  } as React.CSSProperties,

  cycleInfoItem: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 2 } as React.CSSProperties,
  cycleInfoLabel: { fontSize: 10, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5 } as React.CSSProperties,
  cycleInfoValue: { fontSize: 13, color: '#FFF', fontWeight: 500 } as React.CSSProperties,

  sectionTitle: { fontSize: 14, fontWeight: 600, color: '#FFF', marginBottom: 12 } as React.CSSProperties,

  // Load table
  table: { width: '100%', borderCollapse: 'collapse' as const } as React.CSSProperties,

  th: {
    fontSize: 11, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5,
    fontWeight: 500, textAlign: 'left' as const, padding: '10px 14px', borderBottom: '1px solid #1E2128',
  } as React.CSSProperties,

  td: { padding: '10px 14px', fontSize: 13, color: '#E5E7EB', borderBottom: '1px solid #1E2128' } as React.CSSProperties,

  bookBtn: {
    background: 'transparent', border: '1px solid #1D9E75', borderRadius: 4,
    color: '#1D9E75', fontSize: 12, fontWeight: 600, padding: '5px 14px',
    cursor: 'pointer', transition: 'all 0.15s',
  } as React.CSSProperties,

  toast: {
    position: 'fixed' as const, bottom: 24, right: 24,
    background: '#1D4D2E', color: '#4ADE80', padding: '10px 20px', borderRadius: 8,
    fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 9999,
  } as React.CSSProperties,
};
