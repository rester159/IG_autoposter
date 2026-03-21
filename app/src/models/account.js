const db = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM accounts ORDER BY id'),
  get: db.prepare('SELECT * FROM accounts WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO accounts (name, ig_token, ig_account_id, public_url,
      photo_frequency, video_frequency, cron_schedule, video_cron_schedule,
      enabled, video_enabled, color)
    VALUES (@name, @ig_token, @ig_account_id, @public_url,
      @photo_frequency, @video_frequency, @cron_schedule, @video_cron_schedule,
      @enabled, @video_enabled, @color)
  `),
  update: db.prepare(`
    UPDATE accounts SET
      name = COALESCE(@name, name),
      ig_token = COALESCE(@ig_token, ig_token),
      ig_account_id = COALESCE(@ig_account_id, ig_account_id),
      public_url = COALESCE(@public_url, public_url),
      photo_frequency = COALESCE(@photo_frequency, photo_frequency),
      video_frequency = COALESCE(@video_frequency, video_frequency),
      cron_schedule = COALESCE(@cron_schedule, cron_schedule),
      video_cron_schedule = COALESCE(@video_cron_schedule, video_cron_schedule),
      enabled = COALESCE(@enabled, enabled),
      video_enabled = COALESCE(@video_enabled, video_enabled),
      color = COALESCE(@color, color)
    WHERE id = @id
  `),
  del: db.prepare('DELETE FROM accounts WHERE id = ?'),
};

function list() {
  return stmts.list.all();
}

function get(id) {
  return stmts.get.get(id) || null;
}

function add(data) {
  const row = {
    name: data.name || 'New Account',
    ig_token: data.ig_token || '',
    ig_account_id: data.ig_account_id || '',
    public_url: data.public_url || '',
    photo_frequency: data.photo_frequency || '1d',
    video_frequency: data.video_frequency || '1d',
    cron_schedule: data.cron_schedule || '0 */6 * * *',
    video_cron_schedule: data.video_cron_schedule || '0 12 * * *',
    enabled: data.enabled ? 1 : 0,
    video_enabled: data.video_enabled ? 1 : 0,
    color: data.color || '#a78bfa',
  };
  const info = stmts.insert.run(row);
  return get(info.lastInsertRowid);
}

function update(id, data) {
  const row = {
    id,
    name: data.name !== undefined ? data.name : null,
    ig_token: data.ig_token !== undefined ? data.ig_token : null,
    ig_account_id: data.ig_account_id !== undefined ? data.ig_account_id : null,
    public_url: data.public_url !== undefined ? data.public_url : null,
    photo_frequency: data.photo_frequency !== undefined ? data.photo_frequency : null,
    video_frequency: data.video_frequency !== undefined ? data.video_frequency : null,
    cron_schedule: data.cron_schedule !== undefined ? data.cron_schedule : null,
    video_cron_schedule: data.video_cron_schedule !== undefined ? data.video_cron_schedule : null,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : null,
    video_enabled: data.video_enabled !== undefined ? (data.video_enabled ? 1 : 0) : null,
    color: data.color !== undefined ? data.color : null,
  };
  stmts.update.run(row);
  return get(id);
}

function del(id) {
  stmts.del.run(id);
}

function mask(val) {
  if (!val || val.length < 8) return val ? '••••' : '';
  return '••' + val.slice(-4);
}

function listMasked() {
  return list().map(a => ({
    ...a,
    ig_token: mask(a.ig_token),
  }));
}

function getMasked(id) {
  const a = get(id);
  if (!a) return null;
  return { ...a, ig_token: mask(a.ig_token) };
}

module.exports = { list, get, add, update, del, listMasked, getMasked };
