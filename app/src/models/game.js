const db = require('../db');

const stmts = {
  list: db.prepare(`
    SELECT g.*, ge.name as genre_name, ge.slug as genre_slug
    FROM games g LEFT JOIN genres ge ON g.genre_id = ge.id
    ORDER BY g.created_at DESC
  `),
  get: db.prepare(`
    SELECT g.*, ge.name as genre_name, ge.slug as genre_slug
    FROM games g LEFT JOIN genres ge ON g.genre_id = ge.id
    WHERE g.id = ?
  `),
  getByImage: db.prepare('SELECT * FROM games WHERE image_filename = ?'),
  insert: db.prepare(`
    INSERT INTO games (image_filename, title, console, genre_id, studio, year, lead_artist, lead_creative, lead_musician, ai_extracted)
    VALUES (@image_filename, @title, @console, @genre_id, @studio, @year, @lead_artist, @lead_creative, @lead_musician, @ai_extracted)
  `),
  update: db.prepare(`
    UPDATE games SET
      title = @title, console = @console, genre_id = @genre_id,
      studio = @studio, year = @year,
      lead_artist = @lead_artist, lead_creative = @lead_creative,
      lead_musician = @lead_musician, ai_extracted = @ai_extracted
    WHERE id = @id
  `),
  del: db.prepare('DELETE FROM games WHERE id = ?'),
};

function list() {
  return stmts.list.all();
}

function get(id) {
  return stmts.get.get(id) || null;
}

function getByImage(filename) {
  return stmts.getByImage.get(filename) || null;
}

function add(data) {
  const row = {
    image_filename: data.image_filename,
    title: data.title || '',
    console: data.console || '',
    genre_id: data.genre_id || null,
    studio: data.studio || '',
    year: data.year || '',
    lead_artist: data.lead_artist || '',
    lead_creative: data.lead_creative || '',
    lead_musician: data.lead_musician || '',
    ai_extracted: data.ai_extracted || 0,
  };
  const info = stmts.insert.run(row);
  return { id: info.lastInsertRowid, ...row };
}

function update(id, data) {
  const existing = stmts.get.get(id);
  if (!existing) return null;
  const merged = {
    id,
    title: data.title ?? existing.title,
    console: data.console ?? existing.console,
    genre_id: data.genre_id !== undefined ? data.genre_id : existing.genre_id,
    studio: data.studio ?? existing.studio,
    year: data.year ?? existing.year,
    lead_artist: data.lead_artist ?? existing.lead_artist,
    lead_creative: data.lead_creative ?? existing.lead_creative,
    lead_musician: data.lead_musician ?? existing.lead_musician,
    ai_extracted: data.ai_extracted !== undefined ? data.ai_extracted : existing.ai_extracted,
  };
  stmts.update.run(merged);
  return get(id);
}

function del(id) {
  return stmts.del.run(id).changes > 0;
}

module.exports = { list, get, getByImage, add, update, del };
