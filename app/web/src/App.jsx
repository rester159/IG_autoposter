import { useEffect } from 'react';
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
      <NavLink to="/" end className={linkClass}>Home</NavLink>
      <NavLink to="/queue" className={linkClass}>Queue</NavLink>
      <NavLink to="/settings" className={linkClass}>Settings</NavLink>
      <NavLink to="/history" className={linkClass}>History</NavLink>
      <a href="/legacy/" className="legacy-link">Legacy</a>
    </nav>
  );
}

export default function App() {
  useEffect(() => {
    // Best-effort orientation lock on supported mobile browsers/PWA contexts.
    if (window.screen?.orientation?.lock) {
      window.screen.orientation.lock('portrait').catch(() => {});
    }
  }, []);

  return (
    <BrowserRouter>
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
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="nav-icon" aria-hidden="true">🏠</span>
            <span className="nav-label">Home</span>
          </NavLink>
          <NavLink to="/queue" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="nav-icon" aria-hidden="true">🗂️</span>
            <span className="nav-label">Queue</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="nav-icon" aria-hidden="true">⚙️</span>
            <span className="nav-label">Settings</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="nav-icon" aria-hidden="true">🕘</span>
            <span className="nav-label">History</span>
          </NavLink>
        </nav>
      </div>
    </BrowserRouter>
  );
}
