const db = require('../db');
const fs = require('fs');
const path = require('path');

const TEAM_DIR = process.env.TEAM_DIR || '/data/team';

const stmts = {
  list: db.prepare('SELECT * FROM influencers ORDER BY created_at DESC'),
  get: db.prepare('SELECT * FROM influencers WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO influencers (id, name, personality, quirks, expressions, outfit, picture, room, game_tastes, fashion_style, boyfriend, intro_phrase, photos, created_at)
    VALUES (@id, @name, @personality, @quirks, @expressions, @outfit, @picture, @room, @game_tastes, @fashion_style, @boyfriend, @intro_phrase, @photos, @created_at)
  `),
  update: db.prepare(`
    UPDATE influencers SET
      name = @name, personality = @personality, quirks = @quirks,
      expressions = @expressions, outfit = @outfit, picture = @picture,
      room = @room, game_tastes = @game_tastes, fashion_style = @fashion_style,
      boyfriend = @boyfriend, intro_phrase = @intro_phrase, photos = @photos
    WHERE id = @id
  `),
  del: db.prepare('DELETE FROM influencers WHERE id = ?'),
  updatePhotos: db.prepare('UPDATE influencers SET photos = ? WHERE id = ?'),
};

function list() {
  return stmts.list.all().map(deserialize);
}

function get(id) {
  const row = stmts.get.get(id);
  return row ? deserialize(row) : null;
}

function add(data) {
  const id = 'inf_' + Date.now();
  const row = {
    id,
    name: data.name || 'Unnamed',
    personality: data.personality || '',
    quirks: data.quirks || '',
    expressions: data.expressions || '',
    outfit: data.outfit || '',
    picture: data.picture || '',
    room: data.room || '',
    game_tastes: data.game_tastes || '',
    fashion_style: data.fashion_style || '',
    boyfriend: data.boyfriend || '',
    intro_phrase: data.intro_phrase || '',
    photos: JSON.stringify(data.photos || []),
    created_at: new Date().toISOString(),
  };
  // Ensure photo directory exists
  const dir = getPhotoDir(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  stmts.insert.run(row);
  return deserialize({ ...row });
}

function update(id, data) {
  const existing = stmts.get.get(id);
  if (!existing) return null;
  const merged = {
    id,
    name: data.name ?? existing.name,
    personality: data.personality ?? existing.personality,
    quirks: data.quirks ?? existing.quirks,
    expressions: data.expressions ?? existing.expressions,
    outfit: data.outfit ?? existing.outfit,
    picture: data.picture ?? existing.picture,
    room: data.room ?? existing.room,
    game_tastes: data.game_tastes ?? existing.game_tastes,
    fashion_style: data.fashion_style ?? existing.fashion_style,
    boyfriend: data.boyfriend ?? existing.boyfriend,
    intro_phrase: data.intro_phrase ?? existing.intro_phrase,
    photos: data.photos ? JSON.stringify(data.photos) : existing.photos,
  };
  stmts.update.run(merged);
  return deserialize({ ...existing, ...merged });
}

function del(id) {
  const inf = stmts.get.get(id);
  if (!inf) return false;
  stmts.del.run(id);
  // Clean up photo directory
  const dir = getPhotoDir(id);
  if (fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true }); } catch (e) { console.error('[influencer] cleanup:', e.message); }
  }
  return true;
}

function addPhoto(id, filename) {
  const inf = stmts.get.get(id);
  if (!inf) return null;
  const photos = JSON.parse(inf.photos || '[]');
  photos.push(filename);
  stmts.updatePhotos.run(JSON.stringify(photos), id);
  return deserialize({ ...inf, photos: JSON.stringify(photos) });
}

function removePhoto(id, filename) {
  const inf = stmts.get.get(id);
  if (!inf) return null;
  const photos = JSON.parse(inf.photos || '[]').filter(p => p !== filename);
  stmts.updatePhotos.run(JSON.stringify(photos), id);
  // Delete file
  const fp = path.join(getPhotoDir(id), filename);
  if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  return deserialize({ ...inf, photos: JSON.stringify(photos) });
}

function getPhotoDir(id) {
  const dir = path.join(TEAM_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deserialize(row) {
  return {
    ...row,
    photos: typeof row.photos === 'string' ? JSON.parse(row.photos) : (row.photos || []),
  };
}

module.exports = { list, get, add, update, del, addPhoto, removePhoto, getPhotoDir };
