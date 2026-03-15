import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import Settings from './pages/Settings';
import History from './pages/History';
import './App.css';

function Nav() {
  return (
    <nav className="nav">
      <NavLink to="/" end>Dashboard</NavLink>
      <NavLink to="/queue">Queue</NavLink>
      <NavLink to="/settings">Settings</NavLink>
      <NavLink to="/history">History</NavLink>
      <a href="/legacy/" className="legacy-link">Legacy UI</a>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <h1 className="brand">AuraPost</h1>
          <Nav />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
