import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getUnifiedQueue,
  postQueueItemNow,
  schedulePost,
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
    try {
      await postQueueItemNow(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPostingId(null);
    }
  };

  const handleReschedule = async (id, dateStr) => {
    try {
      await schedulePost(id, dateStr);
      await load();
    } catch (e) {
      setError(e.message);
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

  if (loading) return <div className="page-loading">Loading queue...</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  const formatDate = (s) => (s ? new Date(s).toLocaleString() : '—');

  return (
    <div className="page">
      <h1>Queue Timeline</h1>
      <p className="muted">{items.length} items</p>
      <div className="queue-list">
        {items.length === 0 ? (
          <p>Queue is empty. Add posts via <Link to="/legacy/">legacy UI</Link>.</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className={`queue-item ${it.status}`}>
              <div className="queue-thumb">
                {it.thumb ? (
                  <img src={it.thumb} alt="" />
                ) : (
                  <span className="placeholder">{it.type || '?'}</span>
                )}
              </div>
              <div className="queue-info">
                <div className="row">
                  <span className="badge">{it.status}</span>
                  <span className="type">{it.type || 'photo'}</span>
                </div>
                <p className="scheduled">{formatDate(it.scheduled_at)}</p>
                {it.caption && <p className="caption">{it.caption.slice(0, 80)}…</p>}
                {it.status !== 'posted' && (
                  <div className="actions">
                    {it.status !== 'posted' && (
                      <>
                        <button
                          className="btn btn-sm"
                          onClick={() => handlePostNow(it.id)}
                          disabled={postingId === it.id}
                        >
                          {postingId === it.id ? '…' : 'Post Now'}
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleDelete(it.id)}
                        >
                          Remove
                        </button>
                      </>
                    )}
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
