import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig, updateConfig } from '../api';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key, value) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateConfig(config);
      setConfig(updated.config);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-loading">Loading config...</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

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
      <div className="settings-form">
        {fields.map(({ key, label, type }) => (
          <div key={key} className="field">
            <label>{label}</label>
            {type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={!!config[key]}
                onChange={(e) => handleChange(key, e.target.checked)}
              />
            ) : (
              <input
                type={type}
                value={config[key] ?? ''}
                onChange={(e) =>
                  handleChange(key, type === 'number' ? Number(e.target.value) : e.target.value)
                }
              />
            )}
          </div>
        ))}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="nav-hint">
        <Link to="/">Dashboard</Link> · <Link to="/queue">Queue</Link> ·{' '}
        <Link to="/history">History</Link>
      </p>
    </div>
  );
}
