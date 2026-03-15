import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig, updateConfig } from '../api';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key, value) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateConfig(config);
      setConfig(updated.config);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page page-loading">Loading config…</div>;
  if (error && !config) return (
    <div className="page">
      <div className="page-error">
        <strong>Error</strong> {error}
      </div>
    </div>
  );

  const fields = [
    { key: 'enabled', label: 'Photo scheduler enabled', type: 'checkbox' },
    { key: 'videoEnabled', label: 'Video scheduler enabled', type: 'checkbox' },
    { key: 'cronSchedule', label: 'Photo cron', type: 'text' },
    { key: 'videoCronSchedule', label: 'Video cron', type: 'text' },
    { key: 'mediaFolder', label: 'Media folder', type: 'text' },
    { key: 'publicUrl', label: 'Public URL', type: 'text' },
    { key: 'hashtagCount', label: 'Hashtag count', type: 'number' },
  ];

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">Read/update configuration. Secrets are masked.</p>
      {error && (
        <div className="page-error">
          <strong>Error</strong> {error}
        </div>
      )}
      <div className="settings-form">
        {config && fields.map(({ key, label, type }) => (
          <div key={key} className="field">
            <label htmlFor={`field-${key}`}>{label}</label>
            {type === 'checkbox' ? (
              <input
                id={`field-${key}`}
                type="checkbox"
                checked={!!config[key]}
                onChange={(e) => handleChange(key, e.target.checked)}
              />
            ) : (
              <input
                id={`field-${key}`}
                type={type}
                value={config[key] ?? ''}
                onChange={(e) =>
                  handleChange(key, type === 'number' ? Number(e.target.value) : e.target.value)
                }
              />
            )}
          </div>
        ))}
        <div className="action-row">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
      <p className="nav-hint">
        <Link to="/">Dashboard</Link> · <Link to="/queue">Queue</Link> ·{' '}
        <Link to="/history">History</Link>
      </p>
    </div>
  );
}
