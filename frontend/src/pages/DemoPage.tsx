export default function DemoPage() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        background: '#F4F2EE',
      }}
    >
      <iframe
        src="/demo.html"
        style={{
          display: 'block',
          width: '100vw',
          height: '100vh',
          border: 'none',
          margin: 0,
          padding: 0,
        }}
        title="Golden Mile Demo"
      />
    </div>
  );
}
