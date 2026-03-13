const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');
const axios = require('axios');
const { loadConfig, saveConfig, loadHistory, ensureDir } = require('./config');
const { listQueue, thumbnail, toBase64, nextInQueue } = require('./media');
const { generateCaption } = require('./caption');
const { verifyToken } = require('./instagram');
const sched = require('./scheduler');
const team = require('./team');
const videoSched = require('./video-scheduler');
const { listVideoQueue, nextVideoInQueue } = require('./video');
const queue = require('./queue');
const postModel = require('./models/post');
const gameModel = require('./models/game');
const analytics = require('./models/analytics');
const { syncAllInsights } = require('./instagram-insights');
const { scoreQueue, getTopRecommended } = require('./ml-scoring');
const { enrichGame } = require('./rawg');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// ── static dashboard ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── serve incoming images (IG graph API fetches from here) ────────
app.get('/media/incoming/:file', (req, res) => {
  const cfg = loadConfig();
  const fp = path.join(cfg.mediaFolder, req.params.file);
  if (!fp.startsWith(path.resolve(cfg.mediaFolder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.sendStatus(404);
  res.sendFile(fp);
});

// ── multer upload ─────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const cfg = loadConfig();
      ensureDir(cfg.mediaFolder);
      cb(null, cfg.mediaFolder);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `${base}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, /\.(jpe?g|png|webp|heic|heif)$/i.test(file.originalname));
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ═══════════════════════  API ROUTES  ═══════════════════════════════

// dashboard summary
app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  const q = listQueue(cfg.mediaFolder);
  res.json({
    queue: q.length,
    scheduler: sched.status(),
    configured: !!(cfg.instagramToken && cfg.instagramAccountId && cfg.geminiApiKey),
  });
});

// full queue with thumbnails
app.get('/api/queue', async (_req, res) => {
  const cfg = loadConfig();
  const files = listQueue(cfg.mediaFolder);
  const out = [];
  for (const f of files) {
    out.push({ ...f, thumb: await thumbnail(f.path) });
  }
  res.json(out);
});

// upload photos from the web UI — also creates posts in unified queue
// Auto-extracts game metadata via Gemini in background
app.post('/api/upload', upload.array('images', 50), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const cfg = loadConfig();
  const posts = [];
  for (const f of req.files) {
    const post = queue.addPhotoPost({
      file_path: f.path,
      file_name: f.filename,
    });
    posts.push({ filename: f.filename, postId: post.id, scheduled_at: post.scheduled_at });

    // Auto-extract game metadata in background
    if (cfg.geminiApiKey) {
      const gameModel = require('./models/game');
      const postModel = require('./models/post');
      const { extractGameMetadata } = require('./game-metadata');

      // Create a game record for this image
      const game = gameModel.add({ image_filename: f.filename });
      console.log('[upload] created game record #' + game.id + ' for:', f.filename);

      // Link post to game immediately (before extraction)
      postModel.update(post.id, { game_id: game.id });

      // Extract metadata in background (non-blocking)
      extractGameMetadata(game.id, f.path, cfg.geminiApiKey)
        .then(result => {
          console.log('[upload] extracted game metadata:', result.game?.title || '(no title)',
            '| console:', result.game?.console || '-',
            '| post #' + post.id);
        })
        .catch(e => console.error('[upload] game extraction failed for', f.filename, ':', e.message));
    }
  }
  res.json({ ok: true, count: req.files.length, files: req.files.map(f => f.filename), posts });
});

// remove a queued image
app.delete('/api/queue/:name', (req, res) => {
  const cfg = loadConfig();
  const fp = path.join(cfg.mediaFolder, req.params.name);
  if (!fp.startsWith(path.resolve(cfg.mediaFolder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// post history
app.get('/api/history', (_req, res) => res.json(loadHistory()));

// get config (secrets masked)
app.get('/api/config', (_req, res) => {
  const c = loadConfig();
  res.json({
    ...c,
    instagramToken: mask(c.instagramToken),
    geminiApiKey: mask(c.geminiApiKey),
    rawgApiKey: mask(c.rawgApiKey),
  });
});

// update config
app.put('/api/config', (req, res) => {
  const body = req.body;
  // don't clobber secrets with masked placeholders
  if (body.instagramToken?.startsWith('••')) delete body.instagramToken;
  if (body.geminiApiKey?.startsWith('••')) delete body.geminiApiKey;
  if (body.rawgApiKey?.startsWith('••')) delete body.rawgApiKey;

  const cfg = saveConfig(body);

  // restart schedulers if toggled
  if (cfg.enabled) sched.restart(); else sched.stop();
  if (cfg.videoEnabled) videoSched.restart(); else videoSched.stop();

  res.json({
    ok: true,
    config: {
      ...cfg,
      instagramToken: mask(cfg.instagramToken),
      geminiApiKey: mask(cfg.geminiApiKey),
      rawgApiKey: mask(cfg.rawgApiKey),
    },
  });
});

// manual post
app.post('/api/post-now', async (_req, res) => {
  try {
    res.json(await sched.runOnce());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// preview caption for the next queued image (does NOT post)
app.post('/api/preview', async (_req, res) => {
  try {
    const cfg = loadConfig();
    const file = nextInQueue(cfg.mediaFolder);
    if (!file) return res.status(404).json({ error: 'Queue empty' });
    const b64 = await toBase64(file.path);
    const cap = await generateCaption(b64, cfg);
    res.json({ file: file.name, ...cap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// verify IG token
app.post('/api/verify-ig', async (_req, res) => {
  const cfg = loadConfig();
  res.json(await verifyToken(cfg.instagramToken));
});

// ═══════════════════════  UNIFIED QUEUE API  ══════════════════════

// Timeline view: all posts ordered by schedule
app.get('/api/unified-queue', async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    const cfg = loadConfig();
    let posts = queue.getQueue(filters);

    // If model-driven mode, sort by ml_score desc for queued/ready items
    if (cfg.modelDriven === true || cfg.modelDriven === 'true') {
      posts.sort((a, b) => {
        // Posted items stay at the end sorted by posted_at
        if (a.status === 'posted' && b.status !== 'posted') return 1;
        if (b.status === 'posted' && a.status !== 'posted') return -1;
        if (a.status === 'posted' && b.status === 'posted') return 0;
        // Sort by ml_score desc (null scores go last)
        const sa = a.ml_score ?? -1;
        const sb = b.ml_score ?? -1;
        return sb - sa;
      });
    }

    // Enrich with thumbnails for photos
    const enriched = [];
    for (const p of posts) {
      const item = { ...p };
      if (p.type === 'photo' && p.file_path && fs.existsSync(p.file_path)) {
        try { item.thumb = await thumbnail(p.file_path); } catch {}
      }
      enriched.push(item);
    }
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single post
app.get('/api/unified-queue/:id', (req, res) => {
  const post = postModel.get(Number(req.params.id));
  post ? res.json(post) : res.status(404).json({ error: 'Not found' });
});

// Reorder queue items
app.put('/api/unified-queue/reorder', (req, res) => {
  try {
    queue.reorder(req.body.items || []);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Schedule a post
app.put('/api/unified-queue/:id/schedule', (req, res) => {
  const post = queue.schedulePost(Number(req.params.id), req.body.scheduled_at);
  post ? res.json({ ok: true, ...post }) : res.status(404).json({ error: 'Not found' });
});

// Edit caption/hashtags on a post
app.put('/api/unified-queue/:id/caption', (req, res) => {
  const updates = {};
  if (req.body.caption !== undefined) updates.caption = req.body.caption;
  if (req.body.hashtags !== undefined) updates.hashtags = req.body.hashtags;
  if (req.body.first_comment !== undefined) updates.first_comment = req.body.first_comment;
  updates.full_caption = `${req.body.caption || ''}\n\n${req.body.hashtags || ''}`.trim();
  const post = postModel.update(Number(req.params.id), updates);
  post ? res.json({ ok: true, ...post }) : res.status(404).json({ error: 'Not found' });
});

// Post a specific item immediately
app.post('/api/unified-queue/:id/post-now', async (req, res) => {
  const id = Number(req.params.id);
  const post = postModel.get(id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  try {
    // Mark as ready so the scheduler picks it up
    postModel.update(id, { status: 'ready', scheduled_at: new Date().toISOString() });
    // Trigger the appropriate scheduler
    if (post.type === 'video') {
      const result = await videoSched.postNextVideo();
      res.json(result);
    } else {
      const result = await sched.runOnce();
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete a post from the queue
app.delete('/api/unified-queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const post = postModel.get(id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  // Don't allow deleting posted items
  if (post.status === 'posted') return res.status(400).json({ error: 'Cannot delete posted items' });

  postModel.del(id);
  res.json({ ok: true });
});

// ═══════════════════════  ANALYTICS ROUTES  ══════════════════════

app.get('/api/analytics/summary', (_req, res) => {
  try { res.json(analytics.summary()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-game', (_req, res) => {
  try { res.json(analytics.statsByGame()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-genre', (_req, res) => {
  try { res.json(analytics.statsByGenre()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-console', (_req, res) => {
  try { res.json(analytics.statsByConsole()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-influencer', (_req, res) => {
  try { res.json(analytics.statsByInfluencer()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-platform', (_req, res) => {
  try { res.json(analytics.statsByPlatform()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/by-format', (_req, res) => {
  try { res.json(analytics.statsByFormat()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/analytics/post/:id', (req, res) => {
  const post = analytics.postDetail(Number(req.params.id));
  post ? res.json(post) : res.status(404).json({ error: 'Not found' });
});

// ── Instagram Insights ───────────────────────────────────────────
app.get('/api/analytics/insights-summary', (_req, res) => {
  try { res.json(analytics.insightsSummary()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/analytics/posts-metrics', (_req, res) => {
  try { res.json(analytics.postsWithMetrics()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/insights/sync', async (_req, res) => {
  try {
    const result = await syncAllInsights();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ML Scoring ───────────────────────────────────────────────────
app.post('/api/ml/score-queue', async (_req, res) => {
  try {
    const result = await scoreQueue();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/ml/recommendation', (_req, res) => {
  try {
    const top = getTopRecommended();
    res.json({ ok: true, post: top || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Team routes ───────────────────────────────────────────
const teamUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = team.getPhotoDir(_req.params.id);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'photo_' + Date.now() + ext);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, /\.(jpe?g|png|webp)$/i.test(file.originalname));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/api/team', (_req, res) => res.json(team.loadTeam()));

app.get('/api/team/:id', (req, res) => {
  const inf = team.getInfluencer(req.params.id);
  inf ? res.json(inf) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/team', (req, res) => res.json(team.addInfluencer(req.body)));

app.put('/api/team/:id', (req, res) => {
  const inf = team.updateInfluencer(req.params.id, req.body);
  inf ? res.json(inf) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/team/:id', (req, res) => {
  res.json({ ok: team.deleteInfluencer(req.params.id) });
});

app.post('/api/team/:id/photos', teamUpload.array('photos', 10), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });
  req.files.forEach(f => team.addPhoto(req.params.id, f.filename));
  res.json({ ok: true, files: req.files.map(f => f.filename) });
});

app.delete('/api/team/:id/photos/:filename', (req, res) => {
  const inf = team.removePhoto(req.params.id, req.params.filename);
  inf ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

app.get('/api/team/:id/photos/:filename', (req, res) => {
  const fp = path.join(team.getPhotoDir(req.params.id), req.params.filename);
  if (!fs.existsSync(fp)) return res.sendStatus(404);
  res.sendFile(fp);
});

// ── Team AI Suggest ──────────────────────────────────────────────
app.post('/api/team/:id/suggest-field', async (req, res) => {
  const { field } = req.body;
  if (!field) return res.status(400).json({ error: 'field is required' });

  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Gemini API key not configured' });

  const inf = team.getInfluencer(req.params.id);
  if (!inf) return res.status(404).json({ error: 'Influencer not found' });

  const currentValue = inf[field] || '';
  const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
  const geminiUrl = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${cfg.geminiApiKey}`;

  const contextBlock = `Influencer profile:
Name: ${inf.name}
Personality: ${inf.personality || '(empty)'}
Quirks: ${inf.quirks || '(empty)'}
Expressions: ${inf.expressions || '(empty)'}
Outfit: ${inf.outfit || '(empty)'}
Intro Phrase: ${inf.intro_phrase || '(empty)'}
Game Tastes: ${inf.game_tastes || '(empty)'}
Fashion Style: ${inf.fashion_style || '(empty)'}
Boyfriend: ${inf.boyfriend || '(empty)'}`;

  let prompt;
  if (!currentValue) {
    prompt = `${contextBlock}

The field "${field}" is currently empty. Generate 3 creative, distinct suggestions for this field.
This influencer reviews retro and indie games on Instagram. Suggestions should be vivid, specific, and fun.
Return ONLY a JSON array of 3 strings. No explanation, no markdown.`;
  } else {
    prompt = `${contextBlock}

The field "${field}" currently has: "${currentValue}"
Expand this into 3 richer, more detailed versions that keep the original spirit but add more personality and specificity.
Return ONLY a JSON array of 3 strings. No explanation, no markdown.`;
  }

  try {
    const r = await axios.post(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
    });
    const text = r.data.candidates[0].content.parts[0].text.trim();
    // Parse JSON array from response (handle markdown code blocks)
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const suggestions = JSON.parse(cleaned);
    res.json({ ok: true, suggestions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── serve video files (IG Graph API fetches from here) ────────────
app.get('/media/incoming_video/:file', (req, res) => {
  const cfg = loadConfig();
  const folder = cfg.videoIncomingFolder || '/data/incoming_video';
  const fp = path.join(folder, req.params.file);
  if (!fp.startsWith(path.resolve(folder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.sendStatus(404);
  res.sendFile(fp);
});

// ── serve game images ─────────────────────────────────────────────
app.get('/media/game_images/:file', (req, res) => {
  const cfg = loadConfig();
  const folder = cfg.gameImagesFolder || '/data/game_images';
  const fp = path.join(folder, req.params.file);
  if (!fp.startsWith(path.resolve(folder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.sendStatus(404);
  res.sendFile(fp);
});

// ── game images upload ────────────────────────────────────────────
const gameUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const cfg = loadConfig();
      const folder = cfg.gameImagesFolder || '/data/game_images';
      ensureDir(folder);
      cb(null, folder);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `${base}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, /\.(jpe?g|png|webp)$/i.test(file.originalname));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ═══════════════════════  VIDEO API ROUTES  ═════════════════════════

// video status
app.get('/api/video/status', (_req, res) => {
  const cfg = loadConfig();
  const folder = cfg.videoIncomingFolder || '/data/incoming_video';
  const q = listVideoQueue(folder);
  res.json({
    queue: q.length,
    scheduler: videoSched.status(),
    configured: !!(cfg.geminiApiKey && cfg.instagramToken),
  });
});

// video queue
app.get('/api/video/queue', (_req, res) => {
  const cfg = loadConfig();
  const folder = cfg.videoIncomingFolder || '/data/incoming_video';
  const files = listVideoQueue(folder);
  res.json(files.map(f => ({
    ...f,
    url: '/media/incoming_video/' + encodeURIComponent(f.name),
    sizeMB: (f.size / 1024 / 1024).toFixed(1),
  })));
});

// delete a queued video
app.delete('/api/video/queue/:name', (req, res) => {
  const cfg = loadConfig();
  const folder = cfg.videoIncomingFolder || '/data/incoming_video';
  const fp = path.join(folder, req.params.name);
  if (!fp.startsWith(path.resolve(folder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// generate a video (script → Veo) — does NOT post
app.post('/api/video/generate', async (req, res) => {
  try {
    const result = await videoSched.generateOne({
      influencerId: req.body.influencerId,
      background: req.body.background,
      topic: req.body.topic,
      style: req.body.style,
      gameImage: req.body.gameImage,
      gameId: req.body.gameId ? Number(req.body.gameId) : undefined,
      customPrompt: req.body.customPrompt,
      outfit: req.body.outfit,
      duration: req.body.duration ? Number(req.body.duration) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// preview script only (Gemini writes prompt, but no Veo generation)
app.post('/api/video/preview-script', async (req, res) => {
  try {
    const cfg = loadConfig();
    if (!cfg.geminiApiKey) return res.status(400).json({ ok: false, error: 'Gemini API key not configured' });

    const teamMod = require('./team');
    const { generateVideoScript } = require('./video-script');
    const teamList = teamMod.loadTeam();

    // pick influencer
    let influencer;
    if (req.body.influencerId) influencer = teamList.find(i => i.id === req.body.influencerId);
    if (!influencer && teamList.length) influencer = teamList[0];
    if (!influencer) return res.status(400).json({ ok: false, error: 'No influencers configured' });

    // pick game image + metadata
    let gameImagePath = null;
    let gameRecord = null;
    if (req.body.gameId) {
      gameRecord = gameModel.get(Number(req.body.gameId));
      if (gameRecord) {
        const gameFolder = cfg.gameImagesFolder || '/data/game_images';
        const gp = path.join(gameFolder, gameRecord.image_filename);
        if (fs.existsSync(gp)) gameImagePath = gp;
      }
    } else if (req.body.gameImage) {
      const gameFolder = cfg.gameImagesFolder || '/data/game_images';
      const gp = path.join(gameFolder, req.body.gameImage);
      if (fs.existsSync(gp)) gameImagePath = gp;
      gameRecord = gameModel.getByImage(req.body.gameImage);
    }

    const script = await generateVideoScript(cfg, influencer, gameImagePath, {
      background: req.body.background || cfg.videoBackground,
      duration: cfg.videoDuration || 8,
      topic: req.body.topic,
      style: req.body.style,
      outfit: req.body.outfit,
      game: gameRecord || {},
    });

    res.json({
      ok: true, script: script.full,
      part1: script.part1, part2: script.part2, part3: script.part3,
      score: script.score, firstComment: script.firstComment,
      influencer: influencer.name,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// post next queued video as Reel
app.post('/api/video/post-now', async (_req, res) => {
  try {
    res.json(await videoSched.postNextVideo());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// game images: list
app.get('/api/game-images', (_req, res) => {
  const cfg = loadConfig();
  const folder = cfg.gameImagesFolder || '/data/game_images';
  ensureDir(folder);
  const EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
  const files = fs.readdirSync(folder)
    .filter(f => EXTS.includes(path.extname(f).toLowerCase()) && !f.startsWith('.'))
    .map(f => {
      const fp = path.join(folder, f);
      const st = fs.statSync(fp);
      return { name: f, path: fp, size: st.size, mtime: st.mtime, url: '/media/game_images/' + encodeURIComponent(f) };
    })
    .sort((a, b) => a.mtime - b.mtime);
  res.json(files);
});

// game images: upload (also creates a games DB record per image + auto-extract)
app.post('/api/game-images', gameUpload.array('images', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const cfg = loadConfig();
  const created = [];
  for (const f of req.files) {
    const game = gameModel.add({ image_filename: f.filename });
    created.push({ filename: f.filename, gameId: game.id });

    // Auto-extract metadata in background (non-blocking)
    if (cfg.geminiApiKey) {
      const { extractGameMetadata } = require('./game-metadata');
      extractGameMetadata(game.id, f.path, cfg.geminiApiKey)
        .then(() => console.log('[upload] auto-extracted metadata for:', f.filename))
        .catch(e => console.error('[upload] auto-extract failed for', f.filename, ':', e.message));
    }
  }
  res.json({ ok: true, count: req.files.length, files: created });
});

// game images: delete
app.delete('/api/game-images/:name', (req, res) => {
  const cfg = loadConfig();
  const folder = cfg.gameImagesFolder || '/data/game_images';
  const fp = path.join(folder, req.params.name);
  if (!fp.startsWith(path.resolve(folder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// ═══════════════════════  GENRE API ROUTES  ═══════════════════════

const genreModel = require('./models/genre');

app.get('/api/genres', (_req, res) => res.json(genreModel.list()));

app.post('/api/genres', (req, res) => {
  try {
    const genre = genreModel.add(req.body.name);
    res.json(genre);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/genres/:id', (req, res) => {
  try {
    const genre = genreModel.update(Number(req.params.id), req.body.name);
    genre ? res.json(genre) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/genres/:id', (req, res) => {
  try {
    res.json({ ok: genreModel.del(Number(req.params.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════  GAME API ROUTES  ════════════════════════

app.get('/api/games', (_req, res) => res.json(gameModel.list()));

app.get('/api/games/:id', (req, res) => {
  const game = gameModel.get(Number(req.params.id));
  game ? res.json(game) : res.status(404).json({ error: 'Not found' });
});

app.put('/api/games/:id', (req, res) => {
  const game = gameModel.update(Number(req.params.id), req.body);
  game ? res.json(game) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/games/:id', (req, res) => {
  res.json({ ok: gameModel.del(Number(req.params.id)) });
});

// ═══════════════════════  GAME EXTRACTION  ════════════════════════

app.post('/api/games/:id/extract', async (req, res) => {
  const id = Number(req.params.id);
  const game = gameModel.get(id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Gemini API key not configured' });

  const gameFolder = cfg.gameImagesFolder || '/data/game_images';
  const imagePath = path.join(gameFolder, game.image_filename);
  if (!fs.existsSync(imagePath)) return res.status(400).json({ error: 'Image file not found' });

  try {
    const { extractGameMetadata } = require('./game-metadata');
    const result = await extractGameMetadata(id, imagePath, cfg.geminiApiKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════  RAWG ENRICHMENT  ════════════════════════

app.post('/api/games/:id/enrich', async (req, res) => {
  const id = Number(req.params.id);
  const game = gameModel.get(id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const cfg = loadConfig();
  if (!cfg.rawgApiKey) return res.status(400).json({ error: 'RAWG API key not configured' });
  if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Gemini API key not configured (needed for box art verification)' });

  try {
    const result = await enrichGame(id, cfg.rawgApiKey, cfg.geminiApiKey, cfg);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

function mask(s) { return s ? '••••' + s.slice(-6) : ''; }

// ── boot ──────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  IG Auto-Poster  →  http://localhost:${PORT}\n`);
  const cfg = loadConfig();
  ensureDir(cfg.mediaFolder);
  ensureDir(cfg.postedFolder);
  ensureDir(cfg.videoIncomingFolder || '/data/incoming_video');
  ensureDir(cfg.videoPostedFolder || '/data/posted_video');
  ensureDir(cfg.gameImagesFolder || '/data/game_images');
  if (cfg.enabled) sched.start();
  if (cfg.videoEnabled) videoSched.start();

  // Insights sync cron: every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[cron] syncing Instagram insights...');
    try {
      const result = await syncAllInsights();
      console.log('[cron] insights synced:', result.synced, 'posts');
    } catch (e) {
      console.error('[cron] insights sync failed:', e.message);
    }
  });
});
