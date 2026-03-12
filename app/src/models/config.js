const db = require('../db');

const DEFAULT_CONFIG = {
  cronSchedule: '0 */6 * * *',
  captionPrompt:
    'Write a captivating Instagram caption for this photo. ' +
    'Be descriptive, emotional, and authentic. 1-3 sentences max. ' +
    'Do NOT include hashtags in the caption itself.',
  hashtagCount: 30,
  hashtagStyle: 'mixed',
  instagramToken: '',
  instagramAccountId: '',
  publicUrl: '',
  mediaFolder: '/data/incoming',
  postedFolder: '/data/posted',
  enabled: false,
  geminiApiKey: '',
  videoEnabled: false,
  videoCronSchedule: '0 12 * * *',
  videoIncomingFolder: '/data/incoming_video',
  videoPostedFolder: '/data/posted_video',
  videoInfluencerId: '',
  videoBackground: 'retro arcade with neon lights and vintage cabinets',
  videoDuration: 8,
  gameImagesFolder: '/data/game_images',
  videoCaptionPrompt: '',
};

const stmts = {
  get: db.prepare('SELECT value FROM config WHERE key = ?'),
  set: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
  all: db.prepare('SELECT key, value FROM config'),
};

function get(key) {
  const row = stmts.get.get(key);
  if (!row) return DEFAULT_CONFIG[key] ?? null;
  return deserialize(key, row.value);
}

function set(key, value) {
  stmts.set.run(key, serialize(value));
}

function getAll() {
  const rows = stmts.all.all();
  const obj = { ...DEFAULT_CONFIG };
  for (const { key, value } of rows) {
    obj[key] = deserialize(key, value);
  }
  return obj;
}

const setMultiple = db.transaction((partial) => {
  for (const [k, v] of Object.entries(partial)) {
    stmts.set.run(k, serialize(v));
  }
});

function serialize(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function deserialize(key, raw) {
  const def = DEFAULT_CONFIG[key];
  if (def === undefined) {
    // unknown key — try JSON parse
    try { return JSON.parse(raw); } catch { return raw; }
  }
  if (typeof def === 'boolean') return raw === 'true' || raw === true;
  if (typeof def === 'number') return Number(raw);
  return raw;
}

module.exports = { get, set, getAll, setMultiple, DEFAULT_CONFIG };
