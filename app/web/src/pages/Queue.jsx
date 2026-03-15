import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  changeQueueInfluencer,
  getQueueItem,
  getTeam,
  getUnifiedQueue,
  regenerateQueueField,
  reorderUnifiedQueue,
  schedulePost,
  postQueueItemNow,
  updateQueueCaption,
  deleteQueueItem,
} from '../api';

export default function Queue({ embedded = false }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [postingId, setPostingId] = useState(null);
  const [workingId, setWorkingId] = useState(null);
  const [team, setTeam] = useState([]);

  const load = (status = filter) =>
    getUnifiedQueue(status === 'all' ? undefined : status)
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load(filter);
  }, [filter]);

  const ensureTeam = async () => {
    if (team.length) return team;
    const t = await getTeam();
    setTeam(t);
    return t;
  };

  const handlePostNow = async (id) => {
    setPostingId(id);
    setError(null);
    try {
      await postQueueItemNow(id);
      await load(filter);
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
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSchedule = async (id) => {
    const input = prompt('Schedule (YYYY-MM-DD HH:MM). Leave blank to clear schedule:', '');
    if (input === null) return;
    let scheduledAt = '';
    if (input.trim()) {
      const d = new Date(input.trim());
      if (Number.isNaN(d.getTime())) {
        setError('Invalid date format');
        return;
      }
      scheduledAt = d.toISOString();
    }
    setWorkingId(id);
    setError(null);
    try {
      await schedulePost(id, scheduledAt);
      await load(filter);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleEditCaption = async (id) => {
    setWorkingId(id);
    setError(null);
    try {
      const post = await getQueueItem(id);
      const caption = prompt('Edit caption:', post.caption || '');
      if (caption === null) return;
      const hashtags = prompt('Edit hashtags:', post.hashtags || '');
      if (hashtags === null) return;
      await updateQueueCaption(id, { caption, hashtags });
      await load(filter);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleRegenerate = async (id, field) => {
    setWorkingId(id);
    setError(null);
    try {
      await regenerateQueueField(id, field);
      await load(filter);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleChangeInfluencer = async (id) => {
    setWorkingId(id);
    setError(null);
    try {
      const people = await ensureTeam();
      if (!people.length) {
        setError('No influencers configured');
        return;
      }
      const message = people
        .map((p, i) => `${i + 1}. ${p.name}`)
        .join('\n');
      const pick = prompt(`Choose influencer number:\n${message}`, '1');
      if (pick === null) return;
      const idx = Number(pick) - 1;
      if (idx < 0 || idx >= people.length || Number.isNaN(idx)) {
        setError('Invalid influencer selection');
        return;
      }
      await changeQueueInfluencer(id, people[idx].id);
      await load(filter);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleMove = async (idx, direction) => {
    const target = idx + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const temp = next[idx];
    next[idx] = next[target];
    next[target] = temp;
    setItems(next);
    try {
      await reorderUnifiedQueue(next.map((item, i) => ({ id: item.id, sort_order: i })));
    } catch (e) {
      setError(e.message);
      await load(filter);
    }
  };

  const formatDate = (s) => (s ? new Date(s).toLocaleString() : '—');

  if (loading) {
    return embedded
      ? <div className="page-loading">Loading timeline…</div>
      : <div className="page page-loading">Loading queue…</div>;
  }

  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && <h1>Queue</h1>}
      <p className="muted">
        {items.length} item{items.length !== 1 ? 's' : ''}
      </p>
      <div className="actions" style={{ marginBottom: 12 }}>
        {['all', 'queued', 'ready', 'posted'].map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
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
                      disabled={postingId === it.id || workingId === it.id}
                    >
                      {postingId === it.id ? '…' : 'Post Now'}
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => handleSchedule(it.id)} disabled={workingId === it.id}>
                      Schedule
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => handleEditCaption(it.id)} disabled={workingId === it.id}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => handleRegenerate(it.id, 'caption')} disabled={workingId === it.id}>
                      Regen Caption
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => handleRegenerate(it.id, 'hashtags')} disabled={workingId === it.id}>
                      Regen Tags
                    </button>
                    {it.type === 'video' && (
                      <button className="btn btn-sm btn-outline" onClick={() => handleChangeInfluencer(it.id)} disabled={workingId === it.id}>
                        Influencer
                      </button>
                    )}
                    <button className="btn btn-sm btn-outline" onClick={() => handleMove(items.findIndex((x) => x.id === it.id), -1)} disabled={workingId === it.id}>
                      ↑
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => handleMove(items.findIndex((x) => x.id === it.id), 1)} disabled={workingId === it.id}>
                      ↓
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(it.id)}
                      disabled={workingId === it.id}
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
      {!embedded && (
        <p className="nav-hint">
          <Link to="/">Dashboard</Link> · <Link to="/settings">Settings</Link> ·{' '}
          <Link to="/history">History</Link>
        </p>
      )}
    </div>
  );
}
