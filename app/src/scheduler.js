const cron = require('node-cron');
const { loadConfig, addHistory } = require('./config');
const { toBase64 } = require('./media');
const { generateCaption } = require('./caption');
const { postToInstagram } = require('./instagram');
const { postComment } = require('./instagram-reels');
const postModel = require('./models/post');
const accountModel = require('./models/account');
const queue = require('./queue');

const jobs = {};      // { accountId: { main, prep } }
let posting = false;  // mutex
let lastRun = null;
let lastErr = null;

// ── status ────────────────────────────────────────────────────────
function status() {
  const accounts = accountModel.list();
  return {
    posting,
    lastRun,
    lastErr,
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      enabled: !!a.enabled,
      cron: a.cron_schedule,
      hasJob: !!jobs[a.id],
    })),
  };
}

// ── start / stop / restart ────────────────────────────────────────
function start() {
  stop();
  const accounts = accountModel.list();
  let started = 0;

  for (const acct of accounts) {
    if (!acct.enabled) continue;
    if (!cron.validate(acct.cron_schedule)) {
      console.error('[sched] invalid cron for account', acct.name, ':', acct.cron_schedule);
      continue;
    }

    console.log('[sched] starting account', acct.name, ':', acct.cron_schedule);

    const mainJob = cron.schedule(acct.cron_schedule, () => {
      runOnce(acct.id).catch(e => console.error('[sched]', acct.name, e.message));
    });

    const prepJobInstance = cron.schedule('*/15 * * * *', () => {
      prepUpcoming(acct.id).catch(e => console.error('[sched-prep]', acct.name, e.message));
    });

    jobs[acct.id] = { main: mainJob, prep: prepJobInstance };
    started++;
  }

  return started > 0;
}

function stop() {
  for (const id of Object.keys(jobs)) {
    if (jobs[id].main) jobs[id].main.stop();
    if (jobs[id].prep) jobs[id].prep.stop();
    delete jobs[id];
  }
  console.log('[sched] all jobs stopped');
}

function restart() { stop(); return start(); }

// ── prep: generate captions for upcoming posts ────────────────────
async function prepUpcoming(accountId) {
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return;

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);

  const queued = postModel.list({ status: 'queued' });
  const due = queued.filter(p => {
    if (p.type !== 'photo') return false;
    if (!p.scheduled_at) return false;
    if (accountId && p.account_id !== accountId) return false;
    const schedTime = new Date(p.scheduled_at);
    return schedTime <= soon;
  });

  const team = require('./team');
  const teamList = team.loadTeam();

  for (const post of due) {
    if (post.caption && post.caption.trim()) continue;

    try {
      const filePath = post.file_path;
      if (!filePath || !require('fs').existsSync(filePath)) {
        console.log('[sched-prep] skipping, file not found:', post.file_name);
        continue;
      }

      console.log('[sched-prep] generating caption for:', post.file_name);
      const b64 = await toBase64(filePath);

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

// ── execute one post (picks next ready item for account) ─────────
async function runOnce(accountId) {
  if (posting) return { ok: false, error: 'Already posting' };
  posting = true;
  lastErr = null;

  try {
    const cfg = loadConfig();
    if (!cfg.geminiApiKey) throw new Error('Gemini API key missing');

    // Get account credentials
    const acct = accountId ? accountModel.get(accountId) : null;
    const acctConfig = acct ? {
      ...cfg,
      instagramToken: acct.ig_token,
      instagramAccountId: acct.ig_account_id,
      publicUrl: acct.public_url || cfg.publicUrl,
    } : cfg;

    if (!acctConfig.instagramToken) throw new Error('Instagram token missing' + (acct ? ' for ' + acct.name : ''));
    if (!acctConfig.instagramAccountId) throw new Error('Instagram account ID missing' + (acct ? ' for ' + acct.name : ''));

    // Get next ready photo post for this account
    let post = queue.getNextReady('instagram', accountId);

    // If no ready post, try to prep the next queued one on the fly
    if (!post) {
      const queued = postModel.list({ status: 'queued' });
      const nextPhoto = queued.find(p => {
        if (p.type !== 'photo' || !p.file_path) return false;
        return !accountId || p.account_id === accountId;
      });
      if (nextPhoto) {
        const fs = require('fs');
        if (fs.existsSync(nextPhoto.file_path)) {
          const b64 = await toBase64(nextPhoto.file_path);
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

    console.log('[post] posting:', post.file_name, '(post #' + post.id + ', account:', acct?.name || 'default', ')');

    postModel.update(post.id, { status: 'posting' });

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
      post = postModel.get(post.id);
    }

    // Post to IG using the account-specific config
    const ig = await postToInstagram(post.file_path, captionText, acctConfig, {
      altText: post.meta_tags || undefined,
    });

    if (post.first_comment) {
      try {
        await postComment(ig.mediaId, post.first_comment, acctConfig);
        console.log('[post] first comment posted');
      } catch (commentErr) {
        console.error('[post] first comment failed (non-critical):', commentErr.message);
      }
    }

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
      account_id: post.account_id,
    };
    addHistory(entry);
    lastRun = new Date().toISOString();
    return fin({ ok: true, ...entry });

  } catch (err) {
    lastErr = err.message;
    addHistory({ status: 'error', type: 'photo', error: err.message, account_id: accountId });
    console.error('[post] FAIL:', err.message);
    if (err.response?.data) console.error('[post] response:', JSON.stringify(err.response.data));
    return fin({ ok: false, error: err.message });
  }
}

function fin(result) { posting = false; return result; }

module.exports = { start, stop, restart, runOnce, status };
