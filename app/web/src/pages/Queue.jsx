import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getUnifiedQueue,
  postQueueItemNow,
  deleteQueueItem,
} from '../api';

export default function Queue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [postingId, setPostingId] = useState(null);

  const load = () =>
    getUnifiedQueue()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handlePostNow = async (id) => {
    setPostingId(id);
    setError(null);
    try {
      await postQueueItemNow(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPostingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this item?')) return;
    try {
      await deleteQueueItem(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const formatDate = (s) => (s ? new Date(s).toLocaleString() : '—');

  if (loading) return <div className="page page-loading">Loading queue…</div>;

  return (
    <div className="page">
      <h1>Queue</h1>
      <p className="muted">{items.length} item{items.length !== 1 ? 's' : ''}</p>
      {error && (
        <div className="page-error">
          <strong>Error</strong> {error}
        </div>
      )}
      <div className="queue-list">
        {items.length === 0 ? (
          <div className="empty-state">
            <p>Queue is empty.</p>
            <p>
              Add posts via the <a href="/legacy/">legacy UI</a>.
            </p>
          </div>
        ) : (
          items.map((it) => (
            <div key={it.id} className={`queue-item queue-item--${it.status || 'pending'}`}>
              <div className="queue-thumb">
                {it.thumb ? (
                  <img src={it.thumb} alt="" />
                ) : (
                  <span className="placeholder">{it.type || '?'}</span>
                )}
              </div>
              <div className="queue-info">
                <div className="row">
                  <span className={`badge status-${it.status || 'pending'}`}>
                    {it.status || 'pending'}
                  </span>
                  <span className="type">{it.type || 'photo'}</span>
                </div>
                <p className="scheduled">{formatDate(it.scheduled_at)}</p>
                {it.caption && (
                  <p className="caption" title={it.caption}>{it.caption.slice(0, 60)}{it.caption.length > 60 ? '…' : ''}</p>
                )}
                {it.status !== 'posted' && (
                  <div className="actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handlePostNow(it.id)}
                      disabled={postingId === it.id}
                    >
                      {postingId === it.id ? '…' : 'Post Now'}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(it.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <p className="nav-hint">
        <Link to="/">Dashboard</Link> · <Link to="/settings">Settings</Link> ·{' '}
        <Link to="/history">History</Link>
      </p>
    </div>
  );
}
