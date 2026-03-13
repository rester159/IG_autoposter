const db = require('../db');

/**
 * Analytics — aggregate queries over the posts table.
 */

// ── Summary stats ──────────────────────────────────────
function summary() {
  const total = db.prepare('SELECT COUNT(*) as n FROM posts').get().n;
  const posted = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'posted'").get().n;
  const failed = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'failed'").get().n;
  const queued = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status IN ('queued','ready')").get().n;
  const photos = db.prepare("SELECT COUNT(*) as n FROM posts WHERE type = 'photo'").get().n;
  const videos = db.prepare("SELECT COUNT(*) as n FROM posts WHERE type = 'video'").get().n;

  const perDay = db.prepare(`
    SELECT date(posted_at) as day, COUNT(*) as n
    FROM posts WHERE status = 'posted' AND posted_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day DESC
  `).all();

  const avgScore = db.prepare('SELECT AVG(score) as avg FROM posts WHERE score IS NOT NULL').get().avg;

  return {
    total, posted, failed, queued, photos, videos,
    successRate: total > 0 ? Math.round((posted / total) * 100) : 0,
    avgScore: avgScore ? Math.round(avgScore * 10) / 10 : null,
    postsPerDay: perDay,
  };
}

// ── By Game ────────────────────────────────────────────
function statsByGame() {
  return db.prepare(`
    SELECT g.id, g.title, g.console, g.image_filename,
           COUNT(p.id) as post_count,
           SUM(CASE WHEN p.status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           AVG(p.score) as avg_score,
           MAX(p.posted_at) as last_posted
    FROM posts p
    JOIN games g ON p.game_id = g.id
    GROUP BY g.id
    ORDER BY post_count DESC
  `).all().map(r => ({ ...r, avg_score: r.avg_score ? Math.round(r.avg_score * 10) / 10 : null }));
}

// ── By Genre ───────────────────────────────────────────
function statsByGenre() {
  return db.prepare(`
    SELECT gen.id, gen.name,
           COUNT(p.id) as post_count,
           SUM(CASE WHEN p.status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           AVG(p.score) as avg_score
    FROM posts p
    JOIN games g ON p.game_id = g.id
    JOIN genres gen ON g.genre_id = gen.id
    GROUP BY gen.id
    ORDER BY post_count DESC
  `).all().map(r => ({ ...r, avg_score: r.avg_score ? Math.round(r.avg_score * 10) / 10 : null }));
}

// ── By Console ─────────────────────────────────────────
function statsByConsole() {
  return db.prepare(`
    SELECT g.console,
           COUNT(p.id) as post_count,
           SUM(CASE WHEN p.status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           AVG(p.score) as avg_score
    FROM posts p
    JOIN games g ON p.game_id = g.id
    WHERE g.console IS NOT NULL AND g.console != ''
    GROUP BY g.console
    ORDER BY post_count DESC
  `).all().map(r => ({ ...r, avg_score: r.avg_score ? Math.round(r.avg_score * 10) / 10 : null }));
}

// ── By Influencer ──────────────────────────────────────
function statsByInfluencer() {
  return db.prepare(`
    SELECT i.id, i.name,
           COUNT(p.id) as post_count,
           SUM(CASE WHEN p.status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           SUM(CASE WHEN p.type = 'photo' THEN 1 ELSE 0 END) as photo_count,
           SUM(CASE WHEN p.type = 'video' THEN 1 ELSE 0 END) as video_count,
           AVG(p.score) as avg_score,
           MAX(p.posted_at) as last_posted
    FROM posts p
    JOIN influencers i ON p.influencer_id = i.id
    GROUP BY i.id
    ORDER BY post_count DESC
  `).all().map(r => ({ ...r, avg_score: r.avg_score ? Math.round(r.avg_score * 10) / 10 : null }));
}

// ── By Platform ────────────────────────────────────────
function statsByPlatform() {
  return db.prepare(`
    SELECT platform,
           COUNT(*) as post_count,
           SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END) as photo_count,
           SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END) as video_count
    FROM posts
    GROUP BY platform
    ORDER BY post_count DESC
  `).all();
}

// ── By Format (photo/video/reel) ───────────────────────
function statsByFormat() {
  return db.prepare(`
    SELECT type, format,
           COUNT(*) as post_count,
           SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted_count,
           AVG(score) as avg_score
    FROM posts
    GROUP BY type, format
    ORDER BY post_count DESC
  `).all().map(r => ({ ...r, avg_score: r.avg_score ? Math.round(r.avg_score * 10) / 10 : null }));
}

// ── Single post detail ─────────────────────────────────
function postDetail(id) {
  return db.prepare(`
    SELECT p.*, i.name as influencer_name, g.title as game_title,
           g.console as game_console, gen.name as genre_name
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    LEFT JOIN genres gen ON g.genre_id = gen.id
    WHERE p.id = ?
  `).get(id) || null;
}

// ── Instagram Insights summary ─────────────────────────
function insightsSummary() {
  return db.prepare(`
    SELECT
      SUM(ig_likes) as total_likes,
      SUM(ig_comments_count) as total_comments,
      SUM(ig_shares) as total_shares,
      SUM(ig_reach) as total_reach,
      SUM(ig_impressions) as total_impressions,
      SUM(ig_saves) as total_saves,
      AVG(ig_likes) as avg_likes,
      AVG(ig_reach) as avg_reach,
      COUNT(CASE WHEN insights_fetched_at IS NOT NULL THEN 1 END) as synced_count
    FROM posts WHERE status = 'posted'
  `).get();
}

// ── Per-post metrics with all joins ────────────────────
function postsWithMetrics() {
  return db.prepare(`
    SELECT p.id, p.type, p.format, p.caption, p.score, p.ig_media_id,
           p.ig_likes, p.ig_comments_count, p.ig_shares, p.ig_reach,
           p.ig_impressions, p.ig_saves, p.ml_score, p.ml_recommendation,
           p.posted_at, p.scheduled_at,
           i.name as influencer_name,
           g.title as game_title, g.console as game_console,
           gen.name as genre_name
    FROM posts p
    LEFT JOIN influencers i ON p.influencer_id = i.id
    LEFT JOIN games g ON p.game_id = g.id
    LEFT JOIN genres gen ON g.genre_id = gen.id
    WHERE p.status = 'posted'
    ORDER BY p.posted_at DESC
  `).all();
}

module.exports = {
  summary,
  statsByGame,
  statsByGenre,
  statsByConsole,
  statsByInfluencer,
  statsByPlatform,
  statsByFormat,
  postDetail,
  insightsSummary,
  postsWithMetrics,
};
