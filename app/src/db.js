const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'autoposter.db');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL DEFAULT 'Default',
    ig_token            TEXT DEFAULT '',
    ig_account_id       TEXT DEFAULT '',
    public_url          TEXT DEFAULT '',
    photo_frequency     TEXT DEFAULT '1d',
    video_frequency     TEXT DEFAULT '1d',
    cron_schedule       TEXT DEFAULT '0 */6 * * *',
    video_cron_schedule TEXT DEFAULT '0 12 * * *',
    enabled             INTEGER DEFAULT 0,
    video_enabled       INTEGER DEFAULT 0,
    color               TEXT DEFAULT '#a78bfa',
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS influencers (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT 'Unnamed',
    personality    TEXT DEFAULT '',
    quirks         TEXT DEFAULT '',
    expressions    TEXT DEFAULT '',
    outfit         TEXT DEFAULT '',
    picture        TEXT DEFAULT '',
    room           TEXT DEFAULT '',
    game_tastes    TEXT DEFAULT '',
    fashion_style  TEXT DEFAULT '',
    boyfriend      TEXT DEFAULT '',
    intro_phrase   TEXT DEFAULT '',
    photos         TEXT DEFAULT '[]',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS genres (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS games (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_filename  TEXT NOT NULL,
    title           TEXT DEFAULT '',
    console         TEXT DEFAULT '',
    genre_id        INTEGER REFERENCES genres(id) ON DELETE SET NULL,
    studio          TEXT DEFAULT '',
    year            TEXT DEFAULT '',
    lead_artist     TEXT DEFAULT '',
    lead_creative   TEXT DEFAULT '',
    lead_musician   TEXT DEFAULT '',
    ai_extracted    INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL CHECK(type IN ('photo','video')),
    format          TEXT DEFAULT 'reel',
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK(status IN ('queued','generating','ready','posting','posted','failed')),
    platform        TEXT DEFAULT 'instagram',
    file_path       TEXT,
    file_name       TEXT,
    thumbnail       TEXT,
    caption         TEXT DEFAULT '',
    hashtags        TEXT DEFAULT '',
    full_caption    TEXT DEFAULT '',
    first_comment   TEXT DEFAULT '',
    meta_tags       TEXT DEFAULT '',
    influencer_id   TEXT REFERENCES influencers(id) ON DELETE SET NULL,
    game_id         INTEGER REFERENCES games(id) ON DELETE SET NULL,
    veo_prompt      TEXT DEFAULT '',
    veo_uri         TEXT DEFAULT '',
    score           INTEGER,
    ig_media_id     TEXT,
    scheduled_at    TEXT,
    sort_order      INTEGER DEFAULT 0,
    posted_at       TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    status      TEXT NOT NULL,
    type        TEXT DEFAULT 'photo',
    filename    TEXT,
    caption     TEXT,
    hashtags    TEXT,
    error       TEXT,
    media_id    TEXT,
    influencer  TEXT,
    prompt      TEXT,
    post_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    metadata    TEXT DEFAULT '{}',
    timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON posts(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_posts_sort ON posts(status, sort_order);
  CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_games_image ON games(image_filename);

  CREATE TABLE IF NOT EXISTS video_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Schema migrations (idempotent) ──────────────────────────────
const migrations = [
  'ALTER TABLE posts ADD COLUMN ig_likes INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN ig_comments_count INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN ig_shares INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN ig_reach INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN ig_impressions INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN ig_saves INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN insights_fetched_at TEXT',
  'ALTER TABLE posts ADD COLUMN ml_score REAL',
  'ALTER TABLE posts ADD COLUMN ml_recommendation TEXT',
  'ALTER TABLE posts ADD COLUMN ml_scored_at TEXT',
  'ALTER TABLE posts ADD COLUMN metacritic_score INTEGER',
  'ALTER TABLE posts ADD COLUMN metacritic_url TEXT',
  'ALTER TABLE games ADD COLUMN metacritic_score INTEGER',
  'ALTER TABLE games ADD COLUMN metacritic_url TEXT',
  'ALTER TABLE games ADD COLUMN box_art_url TEXT',
  'ALTER TABLE games ADD COLUMN rawg_id INTEGER',
  'ALTER TABLE influencers ADD COLUMN accent TEXT DEFAULT \'\'',
  'ALTER TABLE posts ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
  'ALTER TABLE history ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) {
    if (!e.message.includes('duplicate column')) console.error('[db] migration:', e.message);
  }
}

// ── Seed genres ──────────────────────────────────────────────────

const SEED_GENRES = [
  ['RPG', 'rpg'],
  ['Turn-Based RPG', 'turn-based-rpg'],
  ['Action RPG', 'action-rpg'],
  ['Platformer', 'platformer'],
  ['FPS', 'fps'],
  ['Third-Person Shooter', 'third-person-shooter'],
  ['Fighting', 'fighting'],
  ['Racing', 'racing'],
  ['Puzzle', 'puzzle'],
  ['Adventure', 'adventure'],
  ['Survival Horror', 'survival-horror'],
  ['Strategy', 'strategy'],
  ['Sports', 'sports'],
  ['Simulation', 'simulation'],
  ['Rhythm', 'rhythm'],
  ['Visual Novel', 'visual-novel'],
  ['Beat-em-up', 'beat-em-up'],
  ['Shoot-em-up', 'shoot-em-up'],
  ['Roguelike', 'roguelike'],
  ['Metroidvania', 'metroidvania'],
];

const insertGenre = db.prepare('INSERT OR IGNORE INTO genres (name, slug) VALUES (?, ?)');
const seedTx = db.transaction(() => {
  for (const [name, slug] of SEED_GENRES) insertGenre.run(name, slug);
});
seedTx();

// ── Migrate from JSON files ──────────────────────────────────────

function migrateFromJSON() {
  const configPath = path.join(DATA_DIR, 'config.json');
  const historyPath = path.join(DATA_DIR, 'history.json');
  const teamPath = path.join(DATA_DIR, '..', 'team', 'influencers.json');
  // Also check inside /data/team for Docker paths
  const teamPathAlt = '/data/team/influencers.json';

  // Migrate config
  const configCount = db.prepare('SELECT COUNT(*) as c FROM config').get().c;
  if (configCount === 0 && fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
      const tx = db.transaction(() => {
        for (const [k, v] of Object.entries(cfg)) {
          insert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
      });
      tx();
      console.log('[db] migrated config.json →', Object.keys(cfg).length, 'keys');
    } catch (e) {
      console.error('[db] config migration error:', e.message);
    }
  }

  // Migrate history
  const histCount = db.prepare('SELECT COUNT(*) as c FROM history').get().c;
  if (histCount === 0 && fs.existsSync(historyPath)) {
    try {
      const hist = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      const insert = db.prepare(`
        INSERT INTO history (status, type, filename, caption, hashtags, error, media_id, influencer, prompt, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const h of hist) {
          insert.run(
            h.status || 'unknown',
            h.type || 'photo',
            h.filename || null,
            h.caption || null,
            h.hashtags || null,
            h.error || null,
            h.mediaId || null,
            h.influencer || null,
            h.prompt || null,
            JSON.stringify({ size: h.size, influencerId: h.influencerId }),
            h.timestamp || new Date().toISOString(),
          );
        }
      });
      tx();
      console.log('[db] migrated history.json →', hist.length, 'entries');
    } catch (e) {
      console.error('[db] history migration error:', e.message);
    }
  }

  // Migrate influencers
  const infCount = db.prepare('SELECT COUNT(*) as c FROM influencers').get().c;
  const teamFile = fs.existsSync(teamPath) ? teamPath : fs.existsSync(teamPathAlt) ? teamPathAlt : null;
  if (infCount === 0 && teamFile) {
    try {
      const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
      const insert = db.prepare(`
        INSERT OR IGNORE INTO influencers (id, name, personality, quirks, expressions, outfit, photos, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const inf of team) {
          insert.run(
            inf.id,
            inf.name || 'Unnamed',
            inf.personality || '',
            inf.quirks || '',
            inf.expressions || '',
            inf.outfit || '',
            JSON.stringify(inf.photos || []),
            inf.createdAt || new Date().toISOString(),
          );
        }
      });
      tx();
      console.log('[db] migrated influencers.json →', team.length, 'influencers');
    } catch (e) {
      console.error('[db] influencer migration error:', e.message);
    }
  }
}

migrateFromJSON();

// ── Migrate single-account config into accounts table ────────────
function migrateToAccounts() {
  const count = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
  if (count > 0) return; // already has accounts

  // Check if there's a configured account in global config
  const getVal = (key) => {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : '';
  };
  const token = getVal('instagramToken');
  const accountId = getVal('instagramAccountId');

  if (token || accountId) {
    db.prepare(`
      INSERT INTO accounts (name, ig_token, ig_account_id, public_url,
        photo_frequency, video_frequency, cron_schedule, video_cron_schedule,
        enabled, video_enabled, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Default',
      token,
      accountId,
      getVal('publicUrl') || '',
      getVal('photoFrequency') || '1d',
      getVal('videoFrequency') || '1d',
      getVal('cronSchedule') || '0 */6 * * *',
      getVal('videoCronSchedule') || '0 12 * * *',
      getVal('enabled') === 'true' ? 1 : 0,
      getVal('videoEnabled') === 'true' ? 1 : 0,
      '#a78bfa'
    );
    // Link existing posts to this account
    db.prepare('UPDATE posts SET account_id = 1 WHERE account_id IS NULL').run();
    db.prepare('UPDATE history SET account_id = 1 WHERE account_id IS NULL').run();
    console.log('[db] migrated single account config → accounts table');
  }
}
migrateToAccounts();

module.exports = db;
