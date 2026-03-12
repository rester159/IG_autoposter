const db = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM genres ORDER BY name ASC'),
  get: db.prepare('SELECT * FROM genres WHERE id = ?'),
  getBySlug: db.prepare('SELECT * FROM genres WHERE slug = ?'),
  insert: db.prepare('INSERT INTO genres (name, slug) VALUES (?, ?)'),
  update: db.prepare('UPDATE genres SET name = ?, slug = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM genres WHERE id = ?'),
  inUse: db.prepare('SELECT COUNT(*) as c FROM games WHERE genre_id = ?'),
};

function list() {
  return stmts.list.all();
}

function get(id) {
  return stmts.get.get(id) || null;
}

function getBySlug(slug) {
  return stmts.getBySlug.get(slug) || null;
}

function add(name) {
  const slug = slugify(name);
  try {
    const info = stmts.insert.run(name, slug);
    return { id: info.lastInsertRowid, name, slug };
  } catch (e) {
    if (e.message.includes('UNIQUE')) throw new Error(`Genre "${name}" already exists`);
    throw e;
  }
}

function update(id, name) {
  const slug = slugify(name);
  const existing = stmts.get.get(id);
  if (!existing) return null;
  try {
    stmts.update.run(name, slug, id);
    return { id, name, slug };
  } catch (e) {
    if (e.message.includes('UNIQUE')) throw new Error(`Genre "${name}" already exists`);
    throw e;
  }
}

function del(id) {
  const count = stmts.inUse.get(id).c;
  if (count > 0) throw new Error(`Cannot delete: ${count} game(s) use this genre`);
  return stmts.del.run(id).changes > 0;
}

/** List genre names for AI prompts */
function nameList() {
  return stmts.list.all().map(g => g.name);
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = { list, get, getBySlug, add, update, del, nameList };
