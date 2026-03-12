const db = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM history ORDER BY timestamp DESC LIMIT ?'),
  listByType: db.prepare('SELECT * FROM history WHERE type = ? ORDER BY timestamp DESC LIMIT ?'),
  insert: db.prepare(`
    INSERT INTO history (status, type, filename, caption, hashtags, error, media_id, influencer, prompt, post_id, metadata, timestamp)
    VALUES (@status, @type, @filename, @caption, @hashtags, @error, @media_id, @influencer, @prompt, @post_id, @metadata, @timestamp)
  `),
  count: db.prepare('SELECT COUNT(*) as c FROM history'),
};

function list(limit = 500) {
  return stmts.list.all(limit);
}

function listByType(type, limit = 500) {
  return stmts.listByType.all(type, limit);
}

function add(entry) {
  const row = {
    status: entry.status || 'unknown',
    type: entry.type || 'photo',
    filename: entry.filename || null,
    caption: entry.caption || null,
    hashtags: entry.hashtags || null,
    error: entry.error || null,
    media_id: entry.mediaId || entry.media_id || null,
    influencer: entry.influencer || null,
    prompt: entry.prompt || null,
    post_id: entry.post_id || null,
    metadata: JSON.stringify({
      size: entry.size,
      influencerId: entry.influencerId,
      ...(entry.metadata || {}),
    }),
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  const info = stmts.insert.run(row);
  return { id: info.lastInsertRowid, ...row };
}

function count() {
  return stmts.count.get().c;
}

module.exports = { list, listByType, add, count };
