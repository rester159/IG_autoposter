const db = require('../db');

const stmts = {
  list: db.prepare(`
    SELECT p.*, i.name as influencer_name, g.title as game_title
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    ORDER BY COALESCE(p.scheduled_at, p.created_at) ASC
  `),
  listByStatus: db.prepare(`
    SELECT p.*, i.name as influencer_name, g.title as game_title
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    WHERE p.status = ?
    ORDER BY p.sort_order ASC, COALESCE(p.scheduled_at, p.created_at) ASC
  `),
  get: db.prepare(`
    SELECT p.*, i.name as influencer_name, g.title as game_title
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    WHERE p.id = ?
  `),
  insert: db.prepare(`
    INSERT INTO posts (type, format, status, platform, file_path, file_name, thumbnail, caption, hashtags, full_caption, first_comment, meta_tags, influencer_id, game_id, veo_prompt, veo_uri, score, scheduled_at, sort_order)
    VALUES (@type, @format, @status, @platform, @file_path, @file_name, @thumbnail, @caption, @hashtags, @full_caption, @first_comment, @meta_tags, @influencer_id, @game_id, @veo_prompt, @veo_uri, @score, @scheduled_at, @sort_order)
  `),
  update: db.prepare(`
    UPDATE posts SET
      status = COALESCE(@status, status),
      caption = COALESCE(@caption, caption),
      hashtags = COALESCE(@hashtags, hashtags),
      full_caption = COALESCE(@full_caption, full_caption),
      first_comment = COALESCE(@first_comment, first_comment),
      meta_tags = COALESCE(@meta_tags, meta_tags),
      ig_media_id = COALESCE(@ig_media_id, ig_media_id),
      scheduled_at = COALESCE(@scheduled_at, scheduled_at),
      sort_order = COALESCE(@sort_order, sort_order),
      posted_at = COALESCE(@posted_at, posted_at),
      error = @error,
      veo_prompt = COALESCE(@veo_prompt, veo_prompt),
      veo_uri = COALESCE(@veo_uri, veo_uri),
      score = COALESCE(@score, score)
    WHERE id = @id
  `),
  del: db.prepare('DELETE FROM posts WHERE id = ?'),
  nextReady: db.prepare(`
    SELECT p.*, i.name as influencer_name, g.title as game_title
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    WHERE p.status = 'ready' AND p.platform = ? AND p.scheduled_at <= datetime('now')
    ORDER BY p.scheduled_at ASC
    LIMIT 1
  `),
  reorder: db.prepare('UPDATE posts SET sort_order = ? WHERE id = ?'),
  maxSort: db.prepare('SELECT MAX(sort_order) as m FROM posts WHERE status IN (\'queued\',\'ready\')'),
};

function list(filters = {}) {
  if (filters.status) return stmts.listByStatus.all(filters.status);
  return stmts.list.all();
}

function get(id) {
  return stmts.get.get(id) || null;
}

function add(data) {
  const maxSort = stmts.maxSort.get().m || 0;
  const row = {
    type: data.type || 'photo',
    format: data.format || (data.type === 'video' ? 'reel' : 'photo'),
    status: data.status || 'queued',
    platform: data.platform || 'instagram',
    file_path: data.file_path || null,
    file_name: data.file_name || null,
    thumbnail: data.thumbnail || null,
    caption: data.caption || '',
    hashtags: data.hashtags || '',
    full_caption: data.full_caption || '',
    first_comment: data.first_comment || '',
    meta_tags: data.meta_tags || '',
    influencer_id: data.influencer_id || null,
    game_id: data.game_id || null,
    veo_prompt: data.veo_prompt || '',
    veo_uri: data.veo_uri || '',
    score: data.score || null,
    scheduled_at: data.scheduled_at || null,
    sort_order: data.sort_order ?? (maxSort + 1),
  };
  const info = stmts.insert.run(row);
  return { id: info.lastInsertRowid, ...row };
}

function update(id, data) {
  stmts.update.run({
    id,
    status: data.status || null,
    caption: data.caption || null,
    hashtags: data.hashtags || null,
    full_caption: data.full_caption || null,
    first_comment: data.first_comment || null,
    meta_tags: data.meta_tags || null,
    ig_media_id: data.ig_media_id || null,
    scheduled_at: data.scheduled_at || null,
    sort_order: data.sort_order ?? null,
    posted_at: data.posted_at || null,
    error: data.error !== undefined ? data.error : null,
    veo_prompt: data.veo_prompt || null,
    veo_uri: data.veo_uri || null,
    score: data.score ?? null,
  });
  return get(id);
}

function del(id) {
  return stmts.del.run(id).changes > 0;
}

function nextReady(platform = 'instagram') {
  return stmts.nextReady.get(platform) || null;
}

const reorder = db.transaction((items) => {
  for (const { id, sort_order } of items) {
    stmts.reorder.run(sort_order, id);
  }
});

module.exports = { list, get, add, update, del, nextReady, reorder };
