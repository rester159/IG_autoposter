import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { status, postNow } from '../api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    status()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handlePostNow = async () => {
    setPosting(true);
    setError(null);
    try {
      await postNow();
      const fresh = await status();
      setData(fresh);
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <div className="page page-loading">Loading…</div>;
  if (error) return (
    <div className="page">
      <div className="page-error">
        <strong>Error</strong>
        {error}
      </div>
    </div>
  );

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="muted">Overview of your posting status</p>
      <div className="cards">
        <div className="card">
          <h3>Queue</h3>
          <p className="big">{data?.queue ?? 0}</p>
          <p className="muted">items waiting</p>
        </div>
        <div className="card">
          <h3>Scheduler</h3>
          <p className="big">{data?.scheduler?.enabled ? 'Enabled' : 'Disabled'}</p>
          <p className="muted">
            Last run: {data?.scheduler?.lastRun ? new Date(data.scheduler.lastRun).toLocaleString() : '—'}
          </p>
        </div>
        <div className="card">
          <h3>Configured</h3>
          <p className="big">{data?.configured ? 'Yes' : 'No'}</p>
          <p className="muted">IG + Gemini</p>
        </div>
      </div>
      {data?.queue > 0 && (
        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handlePostNow}
            disabled={posting}
          >
            {posting ? 'Posting…' : 'Post Next Now'}
          </button>
          <Link to="/queue" className="btn btn-outline">View Queue</Link>
        </div>
      )}
      <p className="nav-hint">
        <Link to="/queue">Queue</Link> · <Link to="/settings">Settings</Link> ·{' '}
        <Link to="/history">History</Link>
      </p>
    </div>
  );
}
