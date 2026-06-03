import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DemoPage from './pages/DemoPage';
import RigbyPage from './pages/RigbyPage';
import LoadOptimizer from './pages/LoadOptimizer';
import DispatchEngine from './pages/DispatchEngine.tsx';
import DispatchDemo from './pages/DispatchDemo';
import DispatchDemoDetail from './pages/DispatchDemoDetail';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DemoPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo-legacy" element={<DispatchDemo />} />
        <Route path="/demo-legacy/:driverName" element={<DispatchDemoDetail />} />
        <Route path="/rigby" element={<RigbyPage />} />
        <Route path="/load-optimizer" element={<LoadOptimizer />} />
        <Route path="/dispatch-engine" element={<DispatchEngine />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;