import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
        <Route path="/" element={<RigbyPage />} />
        <Route path="/load-optimizer" element={<LoadOptimizer />} />
        <Route path="/dispatch-engine" element={<DispatchEngine />} />
        <Route path="/demo" element={<DispatchDemo />} />
        <Route path="/demo/:driverName" element={<DispatchDemoDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;