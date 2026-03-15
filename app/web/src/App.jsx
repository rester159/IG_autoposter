import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import Settings from './pages/Settings';
import History from './pages/History';
import './App.css';

function Nav({ className }) {
  const linkClass = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
      <NavLink to="/queue" className={linkClass}>Queue</NavLink>
      <NavLink to="/settings" className={linkClass}>Settings</NavLink>
      <NavLink to="/history" className={linkClass}>History</NavLink>
      <a href="/legacy/" className="legacy-link">Legacy</a>
    </nav>
  );
}

function PortraitBlocker() {
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 768px)');
    const handler = () => setIsPortrait(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div
      className={`portrait-blocker portrait-only ${isPortrait ? 'visible' : ''}`}
      aria-hidden={!isPortrait}
    >
      <svg className="portrait-blocker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 16v-4M9 13l3 3 3-3" />
      </svg>
      <h2>Rotate to landscape</h2>
      <p>For the best experience, please rotate your device to landscape mode.</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PortraitBlocker />
      <div className="app">
        <header className="header">
          <h1 className="brand">AuraPost</h1>
          <Nav className="nav nav-header" />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>
        <nav className="nav nav-bottom" aria-label="Primary">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>Dashboard</NavLink>
          <NavLink to="/queue" className={({ isActive }) => (isActive ? 'active' : '')}>Queue</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>Settings</NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>History</NavLink>
        </nav>
      </div>
    </BrowserRouter>
  );
}
