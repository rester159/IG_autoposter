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

  if (loading) return <div className="page-loading">Loading...</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="cards">
        <div className="card">
          <h3>Queue</h3>
          <p className="big">{data?.queue ?? 0}</p>
          <p className="muted">items waiting</p>
        </div>
        <div className="card">
          <h3>Scheduler</h3>
          <p className="big">{data?.scheduler?.enabled ? 'Enabled' : 'Disabled'}</p>
          <p className="muted">Last run: {data?.scheduler?.lastRun ? new Date(data.scheduler.lastRun).toLocaleString() : '—'}</p>
        </div>
        <div className="card">
          <h3>Configured</h3>
          <p className="big">{data?.configured ? 'Yes' : 'No'}</p>
          <p className="muted">IG + Gemini</p>
        </div>
      </div>
      {data?.queue > 0 && (
        <button
          className="btn btn-primary"
          onClick={handlePostNow}
          disabled={posting}
        >
          {posting ? 'Posting…' : 'Post Next Now'}
        </button>
      )}
      <p className="nav-hint">
        <Link to="/queue">View Queue</Link> · <Link to="/settings">Settings</Link> ·{' '}
        <Link to="/history">History</Link>
      </p>
    </div>
  );
}
