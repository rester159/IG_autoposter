import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUnifiedQueue, status, postNow } from '../api';
import Queue from './Queue';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    const [st, q] = await Promise.all([status(), getUnifiedQueue()]);
    setData(st);
    setQueue(q);
  };

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handlePostNow = async () => {
    setPosting(true);
    setError(null);
    try {
      await postNow();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const queued = queue.filter((p) => p.status === 'queued').length;
  const ready = queue.filter((p) => p.status === 'ready').length;
  const posted = queue.filter((p) => p.status === 'posted').length;
  const lastPosted = queue
    .filter((p) => p.status === 'posted' && p.posted_at)
    .sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || ''))[0];

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
          <h3>Queued</h3>
          <p className="big">{queued}</p>
          <p className="muted">waiting generation/post</p>
        </div>
        <div className="card">
          <h3>Ready</h3>
          <p className="big">{ready}</p>
          <p className="muted">
            can post immediately
          </p>
        </div>
        <div className="card">
          <h3>Posted</h3>
          <p className="big">{posted}</p>
          <p className="muted">last: {lastPosted?.posted_at ? new Date(lastPosted.posted_at).toLocaleString() : '—'}</p>
        </div>
        <div className="card">
          <h3>Scheduler</h3>
          <p className="big">{data?.scheduler?.enabled ? 'Enabled' : 'Disabled'}</p>
          <p className="muted">cron: {data?.scheduler?.cron || '—'}</p>
        </div>
        <div className="card">
          <h3>Configured</h3>
          <p className="big">{data?.configured ? 'Yes' : 'No'}</p>
          <p className="muted">instagram + gemini</p>
        </div>
      </div>
      {(queued + ready) > 0 && (
        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handlePostNow}
            disabled={posting}
          >
            {posting ? 'Posting…' : 'Post Next Now'}
          </button>
          <button className="btn btn-outline" onClick={() => load().catch((e) => setError(e.message))}>
            Refresh
          </button>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>Timeline</h3>
        <Queue embedded />
      </div>
      <p className="nav-hint">
        <Link to="/settings">Settings</Link> · <Link to="/history">History</Link>
      </p>
    </div>
  );
}
