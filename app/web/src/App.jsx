import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import { getConfig } from './api';
import './App.css';

function asBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return Boolean(v);
}

function boolOverride(key, fallback) {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return asBool(raw, fallback);
}

function Nav({ className }) {
  const linkClass = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass}>
        <span className="nav-icon" aria-hidden="true">🏠</span>
        <span className="nav-label">Home</span>
      </NavLink>
      <NavLink to="/queue" className={linkClass}>
        <span className="nav-icon" aria-hidden="true">🗂️</span>
        <span className="nav-label">Queue</span>
      </NavLink>
      <NavLink to="/settings" className={linkClass}>
        <span className="nav-icon" aria-hidden="true">⚙️</span>
        <span className="nav-label">Settings</span>
      </NavLink>
      <NavLink to="/history" className={linkClass}>
        <span className="nav-icon" aria-hidden="true">🕘</span>
        <span className="nav-label">History</span>
      </NavLink>
      <a href="/legacy/" className="legacy-link">Legacy</a>
    </nav>
  );
}

function LegacyFrame({ note }) {
  return (
    <div className="legacy-frame-shell">
      {note ? <div className="legacy-note">{note}</div> : null}
      <iframe
        className="legacy-frame"
        title="AuraPost"
        src="/legacy/"
      />
    </div>
  );
}

export default function App() {
  const [flags, setFlags] = useState({
    shell: true,
    dashboard: false,
    queue: false,
    settings: false,
    history: false,
  });

  useEffect(() => {
    // Best-effort orientation lock on supported mobile browsers/PWA contexts.
    if (window.screen?.orientation?.lock) {
      window.screen.orientation.lock('portrait').catch(() => {});
    }

    getConfig()
      .then((cfg) => {
        setFlags({
          shell: boolOverride('ui.react.shell', asBool(cfg.uiReactShellEnabled, true)),
          dashboard: boolOverride('ui.react.dashboard', asBool(cfg.uiReactDashboardEnabled, false)),
          queue: boolOverride('ui.react.queue', asBool(cfg.uiReactQueueEnabled, false)),
          settings: boolOverride('ui.react.settings', asBool(cfg.uiReactSettingsEnabled, false)),
          history: boolOverride('ui.react.history', asBool(cfg.uiReactHistoryEnabled, false)),
        });
      })
      .catch(() => {
        // Fail safe: keep legacy fallback behavior if config fetch fails.
      });
  }, []);

  const dashboardEl = flags.dashboard
    ? <Dashboard />
    : <LegacyFrame note="Dashboard React parity toggle is off. Showing legacy app." />;
  const queueEl = flags.queue
    ? <Queue />
    : <LegacyFrame note="Queue React parity toggle is off. Showing legacy app." />;
  const settingsEl = flags.settings
    ? <LegacyFrame note="Settings React module is not migrated yet. Showing legacy app." />
    : <LegacyFrame note="Settings React parity toggle is off. Showing legacy app." />;
  const historyEl = flags.history
    ? <LegacyFrame note="History React module is not migrated yet. Showing legacy app." />
    : <LegacyFrame note="History React parity toggle is off. Showing legacy app." />;

  if (!flags.shell) {
    return <LegacyFrame />;
  }

  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <h1 className="brand">AuraPost</h1>
          <Nav className="nav nav-header" />
        </header>
        <main>
          <Routes>
            <Route path="/" element={dashboardEl} />
            <Route path="/queue" element={queueEl} />
            <Route path="/settings" element={settingsEl} />
            <Route path="/history" element={historyEl} />
            <Route path="*" element={<LegacyFrame />} />
          </Routes>
        </main>
        <Nav className="nav nav-bottom" />
      </div>
    </BrowserRouter>
  );
}
