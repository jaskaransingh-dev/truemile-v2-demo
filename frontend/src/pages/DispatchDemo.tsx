import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DRIVERS, DEMO_STATS, BADGE_STYLES, DEMO_RATE_CON, RATE_CON_KEY,
  type Driver, type StatusColor, type RateConResult,
} from '../data/demoDrivers';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DispatchDemo() {
  const navigate = useNavigate();

  // Mutable driver overrides from rate con processing
  const [driverOverrides, setDriverOverrides] = useState<Record<number, Partial<Driver>>>(() => {
    try {
      const stored = localStorage.getItem(RATE_CON_KEY);
      if (stored) {
        const rc: RateConResult = JSON.parse(stored);
        return { [rc.driverId]: {
          status: 'Load Booked', statusColor: 'teal' as StatusColor,
          emptyLocation: rc.delivery, emptyTime: 'Apr 9 \u00b7 7:00 AM',
        }};
      }
    } catch { /* empty */ }
    return {};
  });

  const [toast, setToast] = useState<string | null>(null);
  const [chatDriver, setChatDriver] = useState<Driver | null>(null);

  const handleRateConConfirm = useCallback((rc: RateConResult) => {
    localStorage.setItem(RATE_CON_KEY, JSON.stringify(rc));
    setDriverOverrides((prev) => ({
      ...prev,
      [rc.driverId]: {
        status: 'Load Booked', statusColor: 'teal' as StatusColor,
        emptyLocation: rc.delivery,
        emptyTime: 'Apr 9 \u00b7 7:00 AM',
      },
    }));
    setToast('Rate con processed \u00b7 Max updated \u00b7 Text sent to driver');
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Poll backend for Gmail-received rate cons
  const lastSeenTimestamp = useRef(0);
  const rateConCardRef = useRef<RateConUploadHandle>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3000/api/demo/ratecon/latest');
        const data = await res.json();
        if (data.available && data.timestamp > lastSeenTimestamp.current) {
          lastSeenTimestamp.current = data.timestamp;
          setToast('Rate con received from Gmail');
          setTimeout(() => setToast(null), 3000);
          rateConCardRef.current?.triggerAuto();
        }
      } catch { /* backend not running, silent */ }
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const displayDrivers = DRIVERS.map((d) => driverOverrides[d.id] ? { ...d, ...driverOverrides[d.id] } as Driver : d);

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logo}>True<span style={S.logoAccent}>Mile</span></span>
          <span style={S.headerLabel}>Dispatch Console</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={S.headerRight}>April 7, 2026</span>
          {Object.keys(driverOverrides).length > 0 && (
            <button style={{ background: 'transparent', border: '1px solid #4A1515', borderRadius: 4, color: '#F87171', fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}
              onClick={() => { localStorage.removeItem(RATE_CON_KEY); window.location.reload(); }}
            >Reset Demo</button>
          )}
        </div>
      </div>

      <div style={S.content}>
        <div style={S.statsRow}>
          {DEMO_STATS.map((s) => (
            <div key={s.label} style={S.statCard}>
              <div style={S.statLabel}>{s.label}</div>
              <div style={S.statValue}>{s.value}</div>
            </div>
          ))}
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Driver</th>
              <th style={S.th}>ID</th>
              <th style={S.th}>Equipment Type</th>
              <th style={S.th}>Current Location</th>
              <th style={S.th}>Empty Location</th>
              <th style={S.th}>Empty Time</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayDrivers.map((d, i) => (
              <DriverRow key={d.id} driver={d} rowIndex={i} navigate={navigate} onContact={setChatDriver} />
            ))}
          </tbody>
        </table>

        {/* Rate Confirmation Upload */}
        <RateConUpload ref={rateConCardRef} onConfirm={handleRateConConfirm} />
      </div>

      {toast && <div style={S.toast}>{toast}</div>}
      {chatDriver && <ChatPanel driver={chatDriver} onClose={() => setChatDriver(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver row
// ---------------------------------------------------------------------------

function DriverRow({ driver: d, rowIndex, navigate, onContact }: {
  driver: Driver; rowIndex: number; navigate: ReturnType<typeof useNavigate>; onContact: (d: Driver) => void;
}) {
  const rowBg = rowIndex % 2 === 0 ? '#0D0F12' : '#111419';
  return (
    <tr
      style={{ background: rowBg, cursor: 'pointer', transition: 'background 0.1s' }}
      onClick={() => navigate(`/demo/${d.name.toLowerCase()}`)}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#161B22')}
      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
    >
      <td style={S.td}><span style={S.driverName}>{d.name}</span></td>
      <td style={S.td}>{d.id}</td>
      <td style={S.td}>{d.equipmentType}</td>
      <td style={S.td}>{d.currentLocation}</td>
      <td style={S.td}>{d.emptyLocation}</td>
      <td style={S.td}>{d.emptyTime}</td>
      <td style={S.td}><span style={badgeSt(d.statusColor)}>{d.status}</span></td>
      <td style={S.td}>
        <div style={S.actionCell}>
          <HoverBtn label="Find Next Load" base={S.btnGreen} hoverBg="#1D9E75" rest="#1D9E75"
            onClick={(e) => { e.stopPropagation(); window.open(datSearchUrl(d.currentLocation), '_blank'); }} />
          <HoverBtn label="Contact Now" base={S.btnGray} hoverBg="#6B7280" rest="#6B7280"
            onClick={(e) => { e.stopPropagation(); onContact(d); }} />
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Rate Confirmation Upload
// ---------------------------------------------------------------------------

type UploadState = 'idle' | 'selected' | 'parsing' | 'done';

export interface RateConUploadHandle {
  triggerAuto: () => void;
}

const RateConUpload = forwardRef<RateConUploadHandle, { onConfirm: (rc: RateConResult) => void }>(
  function RateConUpload({ onConfirm }, ref) {
  const [state, setState] = useState<UploadState>('idle');
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expose triggerAuto so the Gmail poller can kick off the flow automatically
  useImperativeHandle(ref, () => ({
    triggerAuto() {
      setFileName('ratecon.pdf (from Gmail)');
      setState('parsing');
      setTimeout(() => setState('done'), 1500);
    },
  }));

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) return;
    setFileName(file.name);
    setState('selected');
  };

  const handleProcess = () => {
    setState('parsing');
    setTimeout(() => setState('done'), 1500);
  };

  const handleConfirm = () => {
    onConfirm(DEMO_RATE_CON);
    setState('idle');
    setFileName('');
  };

  const rc = DEMO_RATE_CON;
  const fields = [
    { label: 'Driver',   value: `${rc.driverName} (${rc.driverId})` },
    { label: 'Load #',   value: rc.loadId },
    { label: 'Pickup',   value: `${rc.pickup} \u00b7 ${rc.pickupTime}` },
    { label: 'Delivery', value: `${rc.delivery} \u00b7 ${rc.deliveryTime}` },
    { label: 'Rate',     value: `$${rc.rate.toLocaleString()}` },
    { label: 'Miles',    value: rc.miles.toLocaleString() },
  ];

  return (
    <div style={S.rcSection}>
      <div style={S.sectionTitle}>Rate Confirmation Upload</div>

      {/* Drop zone */}
      {state === 'idle' && (
        <div
          style={{ ...S.dropZone, ...(dragOver ? S.dropZoneActive : {}) }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>&#128196;</div>
          <div style={{ color: '#FFF', fontWeight: 500 }}>Upload Rate Confirmation</div>
          <div style={{ color: '#6B7280', fontSize: 11, marginTop: 4 }}>PDF will be parsed and driver record updated automatically</div>
          <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>
      )}

      {/* File selected */}
      {state === 'selected' && (
        <div style={S.selectedRow}>
          <span style={{ color: '#FFF' }}>&#128196; {fileName}</span>
          <button style={S.processBtn} onClick={handleProcess}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#16825F'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1D9E75'; }}
          >Process</button>
        </div>
      )}

      {/* Parsing */}
      {state === 'parsing' && (
        <div style={S.parsingRow}>
          <div style={S.spinner} />
          <span style={{ color: '#6B7280' }}>Parsing rate confirmation...</span>
        </div>
      )}

      {/* Done — show extracted fields */}
      {state === 'done' && (
        <div>
          <div style={S.fieldsGrid}>
            {fields.map((f) => (
              <div key={f.label}>
                <div style={S.fieldLabel}>{f.label}</div>
                <div style={S.fieldValue}>{f.value}</div>
              </div>
            ))}
          </div>
          <button style={S.confirmBtn} onClick={handleConfirm}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#16825F'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1D9E75'; }}
          >Confirm &amp; Update Driver</button>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function datSearchUrl(location: string): string {
  return `https://one.dat.com/search-loads?origin=${encodeURIComponent(location)}`;
}

function badgeSt(color: StatusColor): React.CSSProperties {
  return {
    display: 'inline-block', padding: '3px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600,
    background: BADGE_STYLES[color].bg, color: BADGE_STYLES[color].text,
  };
}

export function HoverBtn({ label, base, hoverBg, rest, onClick }: {
  label: string; base: React.CSSProperties; hoverBg: string; rest: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button style={base} onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; e.currentTarget.style.color = '#FFF'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = rest; }}
    >{label}</button>
  );
}

// ---------------------------------------------------------------------------
// Chat Panel
// ---------------------------------------------------------------------------

interface ChatMsg {
  sender: string;
  text: string;
  time: string;
  isDispatcher: boolean;
}

function getChatSeed(d: Driver): { initial: ChatMsg; reply: ChatMsg } {
  const city = d.currentLocation.split(',')[0];
  if (d.statusColor === 'red') {
    return {
      initial: {
        sender: 'Dispatch', time: '10:52 PM', isDispatcher: true,
        text: `Hey ${d.name} \u2014 you're tracking about 1 hour behind schedule. Are you on track for on-time delivery, or should I contact the broker?`,
      },
      reply: {
        sender: d.name, time: '10:53 PM', isDispatcher: false,
        text: `Hey \u2014 yeah hit some traffic outside of ${city}. Should be back on track within the hour, delivery still looks good.`,
      },
    };
  }
  return {
    initial: {
      sender: 'Dispatch', time: '10:52 PM', isDispatcher: true,
      text: `Hey ${d.name} \u2014 just checking in, how's the run going?`,
    },
    reply: {
      sender: d.name, time: '10:53 PM', isDispatcher: false,
      text: 'All good, on track. Should deliver on time.',
    },
  };
}

function ChatPanel({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset messages when driver changes
  useEffect(() => {
    const seed = getChatSeed(driver);
    setMessages([seed.initial]);
    setMinimized(false);
    const timer = setTimeout(() => {
      setMessages((prev) => [...prev, seed.reply]);
    }, 2500);
    return () => clearTimeout(timer);
  }, [driver]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { sender: 'Dispatch', text, time: 'Now', isDispatcher: true }]);
    setInput('');
  };

  const C = chatStyles;

  return (
    <div style={C.panel}>
      {/* Header */}
      <div style={C.header} onClick={() => setMinimized((m) => !m)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={C.onlineDot} />
          <span style={{ color: '#FFF', fontWeight: 500, fontSize: 13 }}>{driver.name}</span>
          <span style={{ color: '#6B7280', fontSize: 12 }}>Driver #{driver.id}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={C.headerBtn} onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m); }}>
            {minimized ? '+' : '\u2013'}
          </button>
          <button style={C.headerBtn} onClick={(e) => { e.stopPropagation(); onClose(); }}>&times;</button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Body */}
          <div ref={bodyRef} style={C.body}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.isDispatcher ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div style={{ maxWidth: '80%' }}>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 2, textAlign: m.isDispatcher ? 'right' : 'left' }}>
                    {m.sender} &middot; {m.time}
                  </div>
                  <div style={{
                    ...C.bubble,
                    background: m.isDispatcher ? '#1D4D2E' : '#2D3035',
                    borderRadius: m.isDispatcher ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                  }}>
                    {m.text}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Input bar */}
          <div style={C.inputBar}>
            <input
              style={C.input}
              placeholder={`Message ${driver.name}...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            />
            <button style={C.sendBtn} onClick={handleSend}>&rarr;</button>
          </div>
        </>
      )}
    </div>
  );
}

const chatStyles = {
  panel: {
    position: 'fixed' as const, bottom: 0, right: 24,
    width: 360, borderRadius: '12px 12px 0 0',
    background: '#1A1D21', border: '1px solid #2D3035', borderBottom: 'none',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.4)', zIndex: 1000,
    display: 'flex', flexDirection: 'column' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,
  header: {
    height: 48, padding: '0 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid #2D3035', cursor: 'pointer', flexShrink: 0,
  } as React.CSSProperties,
  onlineDot: {
    width: 8, height: 8, borderRadius: '50%', background: '#1D9E75', flexShrink: 0,
  } as React.CSSProperties,
  headerBtn: {
    background: 'none', border: 'none', color: '#6B7280', fontSize: 16,
    cursor: 'pointer', padding: '0 4px', lineHeight: 1,
  } as React.CSSProperties,
  body: {
    height: 320, overflowY: 'auto' as const, padding: 16,
  } as React.CSSProperties,
  bubble: {
    padding: '8px 12px', fontSize: 13, color: '#E5E7EB', lineHeight: 1.45,
  } as React.CSSProperties,
  inputBar: {
    height: 48, borderTop: '1px solid #2D3035', display: 'flex', alignItems: 'center',
    padding: '0 10px', gap: 8, flexShrink: 0,
  } as React.CSSProperties,
  input: {
    flex: 1, background: '#111214', border: 'none', borderRadius: 6,
    color: '#FFF', fontSize: 13, padding: '8px 10px', outline: 'none',
  } as React.CSSProperties,
  sendBtn: {
    background: '#1D9E75', border: 'none', borderRadius: 6,
    color: '#FFF', fontSize: 15, fontWeight: 700, width: 34, height: 34,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  page: {
    width: '100vw', height: '100vh', overflow: 'auto',
    background: '#0D0F12', color: '#E5E7EB',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13, margin: 0, padding: 0,
  } as React.CSSProperties,

  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 52, padding: '0 24px', borderBottom: '1px solid #1E2128', background: '#0D0F12',
  } as React.CSSProperties,

  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 } as React.CSSProperties,
  logo: { fontSize: 16, fontWeight: 700, color: '#FFFFFF', letterSpacing: -0.3 } as React.CSSProperties,
  logoAccent: { color: '#1D9E75' } as React.CSSProperties,
  headerLabel: { fontSize: 13, color: '#6B7280', borderLeft: '1px solid #1E2128', paddingLeft: 10 } as React.CSSProperties,
  headerRight: { fontSize: 12, color: '#6B7280' } as React.CSSProperties,
  content: { padding: '20px 24px' } as React.CSSProperties,
  statsRow: { display: 'flex', gap: 12, marginBottom: 20 } as React.CSSProperties,
  statCard: { flex: 1, maxWidth: 240, background: '#111419', border: '1px solid #1E2128', borderRadius: 6, padding: '14px 16px' } as React.CSSProperties,
  statLabel: { fontSize: 11, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 } as React.CSSProperties,
  statValue: { fontSize: 20, fontWeight: 600, color: '#FFFFFF' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const } as React.CSSProperties,
  th: { fontSize: 11, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: 500, textAlign: 'left' as const, padding: '10px 14px', borderBottom: '1px solid #1E2128' } as React.CSSProperties,
  td: { padding: '12px 14px', fontSize: 13, color: '#E5E7EB', borderBottom: '1px solid #1E2128' } as React.CSSProperties,
  driverName: { fontSize: 14, fontWeight: 500, color: '#FFFFFF' } as React.CSSProperties,
  actionCell: { display: 'flex', gap: 8 } as React.CSSProperties,
  btnGreen: { background: 'transparent', border: '1px solid #1D9E75', borderRadius: 4, color: '#1D9E75', fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', transition: 'all 0.15s' } as React.CSSProperties,
  btnGray: { background: 'transparent', border: '1px solid #6B7280', borderRadius: 4, color: '#6B7280', fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', transition: 'all 0.15s' } as React.CSSProperties,

  // Rate Con section
  sectionTitle: { fontSize: 14, fontWeight: 600, color: '#FFF', marginBottom: 12 } as React.CSSProperties,
  rcSection: { marginTop: 32 } as React.CSSProperties,

  dropZone: {
    border: '2px dashed #1E2128', borderRadius: 8, padding: '32px 0',
    textAlign: 'center' as const, cursor: 'pointer', transition: 'border-color 0.15s',
  } as React.CSSProperties,
  dropZoneActive: { borderColor: '#1D9E75' } as React.CSSProperties,

  selectedRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#111419', border: '1px solid #1E2128', borderRadius: 8, padding: '12px 16px',
  } as React.CSSProperties,

  processBtn: {
    background: '#1D9E75', border: 'none', borderRadius: 4,
    color: '#FFF', fontSize: 12, fontWeight: 600, padding: '6px 16px',
    cursor: 'pointer', transition: 'background 0.15s',
  } as React.CSSProperties,

  parsingRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#111419', border: '1px solid #1E2128', borderRadius: 8, padding: '16px',
  } as React.CSSProperties,

  spinner: {
    width: 16, height: 16, border: '2px solid #1E2128', borderTop: '2px solid #1D9E75',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  } as React.CSSProperties,

  fieldsGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
    background: '#111419', border: '1px solid #1E2128', borderRadius: 8, padding: '16px 20px',
  } as React.CSSProperties,
  fieldLabel: { fontSize: 10, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 2 } as React.CSSProperties,
  fieldValue: { fontSize: 13, color: '#FFF', fontWeight: 500 } as React.CSSProperties,

  confirmBtn: {
    width: '100%', marginTop: 12, padding: '10px 0',
    background: '#1D9E75', border: 'none', borderRadius: 6,
    color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
  } as React.CSSProperties,

  toast: {
    position: 'fixed' as const, bottom: 24, right: 24,
    background: '#1D4D2E', color: '#4ADE80', padding: '10px 20px', borderRadius: 8,
    fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 9999,
  } as React.CSSProperties,
};

// Inject spinner keyframe once
if (typeof document !== 'undefined' && !document.getElementById('tm-spin-style')) {
  const style = document.createElement('style');
  style.id = 'tm-spin-style';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
