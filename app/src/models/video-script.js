const db = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM video_scripts ORDER BY title ASC'),
  get: db.prepare('SELECT * FROM video_scripts WHERE id = ?'),
  insert: db.prepare('INSERT INTO video_scripts (title, content) VALUES (?, ?)'),
  update: db.prepare('UPDATE video_scripts SET title = ?, content = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM video_scripts WHERE id = ?'),
};

function list() { return stmts.list.all(); }
function get(id) { return stmts.get.get(id) || null; }
function add(title, content) {
  const info = stmts.insert.run(title, content || '');
  return get(info.lastInsertRowid);
}
function update(id, title, content) {
  stmts.update.run(title, content || '', id);
  return get(id);
}
function del(id) { return stmts.del.run(id).changes > 0; }

module.exports = { list, get, add, update, del };
