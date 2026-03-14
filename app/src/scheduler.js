const cron = require('node-cron');
const { loadConfig, addHistory } = require('./config');
const { toBase64 } = require('./media');
const { generateCaption } = require('./caption');
const { postToInstagram } = require('./instagram');
const { postComment } = require('./instagram-reels');
const postModel = require('./models/post');
const queue = require('./queue');

let job = null;      // main posting cron
let prepJob = null;  // prep cron (generates captions ahead of time)
let posting = false; // mutex
let lastRun = null;
let lastErr = null;

// ── status ────────────────────────────────────────────────────────
function status() {
  const cfg = loadConfig();
  return {
    enabled: cfg.enabled,
    cron: cfg.cronSchedule,
    posting,
    lastRun,
    lastErr,
  };
}

// ── start / stop / restart ────────────────────────────────────────
function start() {
  stop();
  const cfg = loadConfig();
  if (!cfg.enabled) return false;
  if (!cron.validate(cfg.cronSchedule)) {
    lastErr = 'Invalid cron: ' + cfg.cronSchedule;
    return false;
  }
  console.log('[sched] starting:', cfg.cronSchedule);

  // Main posting cron — checks for posts where status='ready' AND scheduled_at <= now
  job = cron.schedule(cfg.cronSchedule, () => {
    runOnce().catch(e => console.error('[sched]', e.message));
  });

  // Prep cron — every 15 min, generates captions for items due within 30 min
  prepJob = cron.schedule('*/15 * * * *', () => {
    prepUpcoming().catch(e => console.error('[sched-prep]', e.message));
  });

  return true;
}

function stop() {
  if (job) { job.stop(); job = null; console.log('[sched] stopped'); }
  if (prepJob) { prepJob.stop(); prepJob = null; }
}

function restart() { stop(); return start(); }

// ── prep: generate captions for upcoming posts ────────────────────
async function prepUpcoming() {
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return;

  // Find queued photo posts due within the next 30 minutes
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);

  const queued = postModel.list({ status: 'queued' });
  const due = queued.filter(p => {
    if (p.type !== 'photo') return false;
    if (!p.scheduled_at) return false;
    const schedTime = new Date(p.scheduled_at);
    return schedTime <= soon;
  });

  // Load team for influencer context
  const team = require('./team');
  const teamList = team.loadTeam();

  for (const post of due) {
    if (post.caption && post.caption.trim()) continue; // already has caption

    try {
      const filePath = post.file_path;
      if (!filePath || !require('fs').existsSync(filePath)) {
        console.log('[sched-prep] skipping, file not found:', post.file_name);
        continue;
      }

      console.log('[sched-prep] generating caption for:', post.file_name);
      const b64 = await toBase64(filePath);

      // Find associated influencer for personality-matched captions
      const influencer = post.influencer_id
        ? teamList.find(i => i.id === post.influencer_id)
        : null;

      const cap = await generateCaption(b64, cfg, { influencer });

      postModel.update(post.id, {
        caption: cap.caption,
        hashtags: cap.hashtags,
        full_caption: cap.full,
        first_comment: cap.firstComment || post.first_comment || '',
        meta_tags: cap.metaTags || '',
        status: 'ready',
      });

      console.log('[sched-prep] ready:', post.file_name, '|', cap.caption.slice(0, 50),
        cap.firstComment ? '| first comment ready' : '');
    } catch (e) {
      console.error('[sched-prep] caption failed for', post.file_name, ':', e.message);
    }
  }
}

// ── execute one post (picks next ready item) ──────────────────────
async function runOnce() {
  if (posting) return { ok: false, error: 'Already posting' };
  posting = true;
  lastErr = null;

  try {
    const cfg = loadConfig();
    if (!cfg.geminiApiKey) throw new Error('Gemini API key missing');
    if (!cfg.instagramToken)  throw new Error('Instagram token missing');
    if (!cfg.instagramAccountId) throw new Error('Instagram account ID missing');

    // Get next ready photo post (scheduled_at <= now)
    let post = queue.getNextReady('instagram');

    // If no ready post, try to prep the next queued one on the fly
    if (!post) {
      const queued = postModel.list({ status: 'queued' });
      const nextPhoto = queued.find(p => p.type === 'photo' && p.file_path);
      if (nextPhoto) {
        // Generate caption on the fly
        const fs = require('fs');
        if (fs.existsSync(nextPhoto.file_path)) {
          const b64 = await toBase64(nextPhoto.file_path);
          // Find associated influencer
          const team = require('./team');
          const influencer = nextPhoto.influencer_id
            ? team.loadTeam().find(i => i.id === nextPhoto.influencer_id)
            : null;
          const cap = await generateCaption(b64, cfg, { influencer });
          postModel.update(nextPhoto.id, {
            caption: cap.caption,
            hashtags: cap.hashtags,
            full_caption: cap.full,
            first_comment: cap.firstComment || '',
            meta_tags: cap.metaTags || '',
            status: 'ready',
          });
          post = postModel.get(nextPhoto.id);
        }
      }
    }

    if (!post) return fin({ ok: false, error: 'Queue empty' });

    console.log('[post] posting:', post.file_name, '(post #' + post.id + ')');

    // Mark as posting
    postModel.update(post.id, { status: 'posting' });

    // Build caption — use stored or generate fresh
    let captionText = post.full_caption || `${post.caption || ''}\n\n${post.hashtags || ''}`.trim();
    if (!captionText) {
      const b64 = await toBase64(post.file_path);
      const team = require('./team');
      const influencer = post.influencer_id
        ? team.loadTeam().find(i => i.id === post.influencer_id)
        : null;
      const cap = await generateCaption(b64, cfg, { influencer });
      captionText = cap.full;
      postModel.update(post.id, {
        caption: cap.caption,
        hashtags: cap.hashtags,
        full_caption: cap.full,
        first_comment: cap.firstComment || post.first_comment || '',
        meta_tags: cap.metaTags || '',
      });
      // Reload post to get updated first_comment
      post = postModel.get(post.id);
    }

    // Post to IG (with alt text from meta_tags for discoverability)
    const ig = await postToInstagram(post.file_path, captionText, cfg, {
      altText: post.meta_tags || undefined,
    });

    // Post first comment if available
    if (post.first_comment) {
      try {
        await postComment(ig.mediaId, post.first_comment, cfg);
        console.log('[post] first comment posted');
      } catch (commentErr) {
        console.error('[post] first comment failed (non-critical):', commentErr.message);
      }
    }

    // Mark as posted
    postModel.update(post.id, {
      status: 'posted',
      ig_media_id: ig.mediaId,
      posted_at: new Date().toISOString(),
    });

    const entry = {
      status: 'success',
      type: 'photo',
      filename: post.file_name,
      caption: post.caption,
      hashtags: post.hashtags,
      mediaId: ig.mediaId,
      post_id: post.id,
    };
    addHistory(entry);
    lastRun = new Date().toISOString();
    return fin({ ok: true, ...entry });

  } catch (err) {
    lastErr = err.message;
    addHistory({ status: 'error', type: 'photo', error: err.message });
    console.error('[post] FAIL:', err.message);
    if (err.response?.data) console.error('[post] response:', JSON.stringify(err.response.data));
    return fin({ ok: false, error: err.message });
  }
}

function fin(result) { posting = false; return result; }

module.exports = { start, stop, restart, runOnce, status };
