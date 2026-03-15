import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHistory } from '../api';

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getHistory()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (s) => (s ? new Date(s).toLocaleString() : '—');

  if (loading) return <div className="page page-loading">Loading history…</div>;
  if (error) return (
    <div className="page">
      <div className="page-error">
        <strong>Error</strong> {error}
      </div>
    </div>
  );

  return (
    <div className="page">
      <h1>History</h1>
      <p className="muted">{items?.length ?? 0} recent post{items?.length !== 1 ? 's' : ''}</p>
      <div className="history-list">
        {!items?.length ? (
          <div className="empty-state">
            <p>No history yet.</p>
            <p>Posted content will appear here.</p>
          </div>
        ) : (
          items.map((it, i) => (
            <div key={i} className="history-item">
              <div className="row">
                <span className="date">{formatDate(it.timestamp || it.date || it.posted_at)}</span>
                {it.media_id && <span className="muted">ID: {it.media_id}</span>}
              </div>
              {it.filename && <p>{it.filename}</p>}
              {it.caption && (
                <p className="caption" title={it.caption}>
                  {it.caption.slice(0, 80)}{it.caption.length > 80 ? '…' : ''}
                </p>
              )}
            </div>
          ))
        )}
      </div>
      <p className="nav-hint">
        <Link to="/">Dashboard</Link> · <Link to="/queue">Queue</Link> ·{' '}
        <Link to="/settings">Settings</Link>
      </p>
    </div>
  );
}
