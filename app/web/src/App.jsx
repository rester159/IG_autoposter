import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import { apiClient, getConfig } from './api';
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

function Icon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5.5 9.8V20h13V9.8" />
      </svg>
    );
  }
  if (name === 'team') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 18c.7-2.7 2.8-4.2 5.5-4.2S13.8 15.3 14.5 18" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M15.6 18c.5-1.7 1.9-2.8 3.8-2.8.4 0 .8 0 1.1.1" />
      </svg>
    );
  }
  if (name === 'analytics') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M4 20h16" />
        <rect x="6" y="11" width="2.8" height="7" rx="1" />
        <rect x="10.6" y="8" width="2.8" height="10" rx="1" />
        <rect x="15.2" y="5" width="2.8" height="13" rx="1" />
      </svg>
    );
  }
  if (name === 'history') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M4.5 12A7.5 7.5 0 1 0 7 6.3" />
        <path d="M4.5 4.5v3.8h3.8" />
        <path d="M12 8v4l2.8 1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a7.8 7.8 0 0 0-2-.9l-.4-2.6h-4l-.4 2.6c-.7.2-1.4.5-2 .9l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1c.6.4 1.3.7 2 .9l.4 2.6h4l.4-2.6c.7-.2 1.4-.5 2-.9l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}

function ActionIcon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.9', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'camera') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M4.5 8.5h15a1.5 1.5 0 0 1 1.5 1.5v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M9 8.5 10.2 6h3.6L15 8.5" />
        <circle cx="12" cy="14" r="3.1" />
      </svg>
    );
  }
  if (name === 'image') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
        <circle cx="9" cy="10" r="1.4" />
        <path d="m5.8 16.8 4.1-4.1 3.2 3.2 2-2 3.1 2.9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <rect x="3.5" y="4.8" width="17" height="14.4" rx="2.2" />
      <path d="M9.8 9.2 11.8 13l2.1-2.6 3.1 5.3" />
      <path d="M10 21h4" />
    </svg>
  );
}

function Nav({ className }) {
  const linkClass = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass}>
        <span className="nav-icon"><Icon name="home" /></span>
        <span className="nav-label">Home</span>
      </NavLink>
      <NavLink to="/team" className={linkClass}>
        <span className="nav-icon"><Icon name="team" /></span>
        <span className="nav-label">Team</span>
      </NavLink>
      <NavLink to="/analytics" className={linkClass}>
        <span className="nav-icon"><Icon name="analytics" /></span>
        <span className="nav-label">Analytics</span>
      </NavLink>
      <NavLink to="/history" className={linkClass}>
        <span className="nav-icon"><Icon name="history" /></span>
        <span className="nav-label">History</span>
      </NavLink>
      <NavLink to="/settings" className={linkClass}>
        <span className="nav-icon"><Icon name="settings" /></span>
        <span className="nav-label">Settings</span>
      </NavLink>
    </nav>
  );
}

function LegacyFrame({ note, tab }) {
  const src = tab ? `/legacy/?tab=${encodeURIComponent(tab)}` : '/legacy/';
  return (
    <div className="legacy-frame-shell">
      {note ? <div className="legacy-note">{note}</div> : null}
      <iframe
        className="legacy-frame"
        title="AuraPost"
        src={src}
      />
    </div>
  );
}

export default function App() {
  const [flags, setFlags] = useState({
    shell: true,
    dashboard: false,
    team: false,
    analytics: false,
    settings: false,
    history: false,
  });
  const [quickOpen, setQuickOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const addPhotoInputRef = useRef(null);
  const createPhotoPostInputRef = useRef(null);

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
          team: boolOverride('ui.react.team', asBool(cfg.uiReactTeamEnabled, false)),
          analytics: boolOverride('ui.react.analytics', asBool(cfg.uiReactAnalyticsEnabled, false)),
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
    : <LegacyFrame tab="dash" note="Home React parity toggle is off. Showing legacy app." />;
  const teamEl = flags.team
    ? <LegacyFrame note="Team React module is not migrated yet. Showing legacy app." tab="team" />
    : <LegacyFrame note="Team React parity toggle is off. Showing legacy app." tab="team" />;
  const analyticsEl = flags.analytics
    ? <LegacyFrame note="Analytics React module is not migrated yet. Showing legacy app." tab="analytics" />
    : <LegacyFrame note="Analytics React parity toggle is off. Showing legacy app." tab="analytics" />;
  const settingsEl = flags.settings
    ? <LegacyFrame note="Settings React module is not migrated yet. Showing legacy app." tab="cfg" />
    : <LegacyFrame note="Settings React parity toggle is off. Showing legacy app." tab="cfg" />;
  const historyEl = flags.history
    ? <LegacyFrame note="History React module is not migrated yet. Showing legacy app." tab="hist" />
    : <LegacyFrame note="History React parity toggle is off. Showing legacy app." tab="hist" />;

  const uploadFiles = async (files, endpoint) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('images', f));
      await apiClient.post(endpoint, fd);
      setQuickOpen(false);
      alert(endpoint === '/api/upload' ? 'Photo post(s) created.' : 'Photo(s) added.');
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleAddPhoto = () => {
    addPhotoInputRef.current?.click();
  };

  const handleCreatePhotoPost = () => {
    createPhotoPostInputRef.current?.click();
  };

  const handleCreateVideoPost = () => {
    setQuickOpen(false);
    window.location.assign('/legacy/?tab=dash&action=create-video');
  };

  if (!flags.shell) {
    return <LegacyFrame />;
  }

  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <button
              className="header-plus"
              onClick={() => setQuickOpen((v) => !v)}
              title="Create"
              aria-label="Create content"
              disabled={uploading}
            >
              +
            </button>
            <h1 className="brand">AuraPost</h1>
          </div>
          <Nav className="nav nav-header" />
        </header>
        <input
          ref={addPhotoInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            uploadFiles(e.target.files, '/api/game-images');
            e.target.value = '';
          }}
        />
        <input
          ref={createPhotoPostInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            uploadFiles(e.target.files, '/api/upload');
            e.target.value = '';
          }}
        />
        {quickOpen ? (
          <>
            <button className="quick-actions-overlay" onClick={() => setQuickOpen(false)} aria-label="Close actions" />
            <div className="quick-actions-sheet" role="dialog" aria-modal="true" aria-label="Quick actions">
              <button className="quick-action" onClick={handleAddPhoto} disabled={uploading}>
                <span className="quick-action-icon"><ActionIcon name="camera" /></span>
                <span>Add photo</span>
              </button>
              <button className="quick-action" onClick={handleCreatePhotoPost} disabled={uploading}>
                <span className="quick-action-icon"><ActionIcon name="image" /></span>
                <span>Create a photo post</span>
              </button>
              <button className="quick-action" onClick={handleCreateVideoPost} disabled={uploading}>
                <span className="quick-action-icon"><ActionIcon name="video" /></span>
                <span>Create a video post</span>
              </button>
            </div>
          </>
        ) : null}
        <main>
          <Routes>
            <Route path="/" element={dashboardEl} />
            <Route path="/team" element={teamEl} />
            <Route path="/analytics" element={analyticsEl} />
            <Route path="/settings" element={settingsEl} />
            <Route path="/history" element={historyEl} />
            <Route path="/queue" element={<Navigate to="/" replace />} />
            <Route path="*" element={<LegacyFrame />} />
          </Routes>
        </main>
        <Nav className="nav nav-bottom" />
      </div>
    </BrowserRouter>
  );
}
