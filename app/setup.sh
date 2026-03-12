#!/bin/bash
DIR="/mnt/user/appdata/ig-autoposter/app"

cat > "$DIR/package.json" << 'EOF'
{
  "name": "ig-autoposter",
  "version": "1.0.0",
  "description": "Self-hosted Instagram auto-poster with AI captions",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.1",
    "axios": "^1.7.9",
    "express": "^4.21.1",
    "multer": "^1.4.5-lts.1",
    "node-cron": "^3.0.3",
    "sharp": "^0.33.2"
  }
}
EOF

cat > "$DIR/Dockerfile" << 'EOF'
FROM node:20-alpine
RUN apk add --no-cache vips-dev
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /data/incoming /data/posted /app/data
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/status || exit 1
CMD ["node", "src/server.js"]
EOF

cat > "$DIR/docker-compose.yml" << 'EOF'
version: "3.8"
services:
  ig-autoposter:
    build: .
    container_name: ig-autoposter
    restart: unless-stopped
    ports:
      - "3099:3000"
    volumes:
      - /mnt/user/appdata/ig-autoposter/incoming:/data/incoming
      - /mnt/user/appdata/ig-autoposter/posted:/data/posted
      - /mnt/user/appdata/ig-autoposter/data:/app/data
EOF

cat > "$DIR/.dockerignore" << 'EOF'
node_modules
data
.git
*.md
EOF

cat > "$DIR/src/config.js" << 'EOF'
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const DEFAULT_CONFIG = {
  cronSchedule: '0 */6 * * *',
  captionPrompt: 'Write a captivating Instagram caption for this photo. Be descriptive, emotional, and authentic. 1-3 sentences max. Do NOT include hashtags in the caption itself.',
  hashtagCount: 30,
  hashtagStyle: 'mixed',
  instagramToken: '',
  instagramAccountId: '',
  anthropicApiKey: '',
  publicUrl: '',
  mediaFolder: '/data/incoming',
  postedFolder: '/data/posted',
  enabled: false,
};
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function loadConfig() {
  ensureDir(DATA_DIR);
  try { if (fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch (err) { console.error('[config] read error:', err.message); }
  return { ...DEFAULT_CONFIG };
}
function saveConfig(partial) {
  ensureDir(DATA_DIR);
  const merged = { ...loadConfig(), ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
function loadHistory() {
  ensureDir(DATA_DIR);
  try { if (fs.existsSync(HISTORY_PATH)) return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
  catch (err) { console.error('[config] history error:', err.message); }
  return [];
}
function addHistory(entry) {
  const list = loadHistory();
  list.unshift({ ...entry, timestamp: new Date().toISOString() });
  const trimmed = list.slice(0, 500);
  ensureDir(DATA_DIR);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}
module.exports = { loadConfig, saveConfig, loadHistory, addHistory, DEFAULT_CONFIG, ensureDir };
EOF

cat > "$DIR/src/media.js" << 'EOF'
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ensureDir } = require('./config');
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
function listQueue(folder) {
  ensureDir(folder);
  return fs.readdirSync(folder)
    .filter(f => IMG_EXTS.has(path.extname(f).toLowerCase()) && !f.startsWith('.'))
    .map(f => { const fp = path.join(folder, f); const st = fs.statSync(fp); return { name: f, path: fp, size: st.size, mtime: st.mtime }; })
    .sort((a, b) => a.mtime - b.mtime);
}
function nextInQueue(folder) { const q = listQueue(folder); return q.length ? q[0] : null; }
function moveToPosted(filePath, postedFolder) {
  ensureDir(postedFolder);
  const dest = path.join(postedFolder, Date.now() + '_' + path.basename(filePath));
  fs.renameSync(filePath, dest);
  return dest;
}
async function thumbnail(filePath) {
  try { const buf = await sharp(filePath).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer(); return 'data:image/jpeg;base64,' + buf.toString('base64'); }
  catch { return null; }
}
async function toBase64(filePath) {
  const buf = await sharp(filePath).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return buf.toString('base64');
}
module.exports = { listQueue, nextInQueue, moveToPosted, thumbnail, toBase64 };
EOF

cat > "$DIR/src/caption.js" << 'EOF'
const Anthropic = require('@anthropic-ai/sdk');
async function generateCaption(imageBase64, config) {
  if (!config.anthropicApiKey) throw new Error('Anthropic API key not configured');
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const hashtagGuide = {
    viral: 'Use trending, high-volume hashtags that maximise reach.',
    niche: 'Use specific, micro-community hashtags (10k-500k posts).',
    mixed: 'Mix ~40% viral tags, ~30% mid-range, ~30% niche tags.',
  }[config.hashtagStyle] || '';
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: config.captionPrompt + '\n\nThen on a NEW line generate exactly ' + config.hashtagCount + ' hashtags.\n' + hashtagGuide + '\n\nRespond in EXACTLY this format:\nCAPTION: <caption>\nHASHTAGS: #tag1 #tag2 ...' },
      ],
    }],
  });
  return parse(res.content[0].text);
}
function parse(text) {
  const cm = text.match(/CAPTION:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
  const hm = text.match(/HASHTAGS:\s*([\s\S]*)/i);
  const caption = cm ? cm[1].trim() : text.trim();
  const hashtags = hm ? hm[1].trim() : '';
  return { caption, hashtags, full: (caption + '\n\n' + hashtags).trim() };
}
module.exports = { generateCaption };
EOF

cat > "$DIR/src/instagram.js" << 'EOF'
const axios = require('axios');
const path = require('path');
const API = 'https://graph.facebook.com/v21.0';
async function postToInstagram(filePath, caption, config) {
  if (!config.instagramToken) throw new Error('Instagram token not configured');
  if (!config.instagramAccountId) throw new Error('Instagram account ID not configured');
  if (!config.publicUrl) throw new Error('publicUrl not set');
  const imageUrl = config.publicUrl.replace(/\/+$/, '') + '/media/incoming/' + encodeURIComponent(path.basename(filePath));
  console.log('[ig] creating container for', imageUrl);
  const { data: ctr } = await axios.post(API + '/' + config.instagramAccountId + '/media', {
    image_url: imageUrl, caption, access_token: config.instagramToken,
  });
  const containerId = ctr.id;
  console.log('[ig] container', containerId);
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const { data } = await axios.get(API + '/' + containerId, { params: { fields: 'status_code', access_token: config.instagramToken } });
    console.log('[ig] status', data.status_code, '(' + (i+1) + ')');
    if (data.status_code === 'FINISHED') break;
    if (data.status_code === 'ERROR') throw new Error('Instagram rejected the image');
    if (i === 29) throw new Error('Timed out waiting for Instagram');
  }
  const { data: pub } = await axios.post(API + '/' + config.instagramAccountId + '/media_publish', { creation_id: containerId, access_token: config.instagramToken });
  console.log('[ig] published', pub.id);
  return { mediaId: pub.id, containerId };
}
async function verifyToken(token) {
  try { const { data } = await axios.get(API + '/me', { params: { fields: 'id,name', access_token: token } }); return { valid: true, info: data }; }
  catch (err) { return { valid: false, error: err.response?.data?.error?.message || err.message }; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { postToInstagram, verifyToken };
EOF

cat > "$DIR/src/scheduler.js" << 'EOF'
const cron = require('node-cron');
const { loadConfig, addHistory } = require('./config');
const { nextInQueue, moveToPosted, toBase64 } = require('./media');
const { generateCaption } = require('./caption');
const { postToInstagram } = require('./instagram');
let job = null, posting = false, lastRun = null, lastErr = null;
function status() { const cfg = loadConfig(); return { enabled: cfg.enabled, cron: cfg.cronSchedule, posting, lastRun, lastErr }; }
function start() {
  stop(); const cfg = loadConfig();
  if (!cfg.enabled) return false;
  if (!cron.validate(cfg.cronSchedule)) { lastErr = 'Invalid cron: ' + cfg.cronSchedule; return false; }
  console.log('[sched] starting:', cfg.cronSchedule);
  job = cron.schedule(cfg.cronSchedule, () => { runOnce().catch(e => console.error('[sched]', e.message)); });
  return true;
}
function stop() { if (job) { job.stop(); job = null; console.log('[sched] stopped'); } }
function restart() { stop(); return start(); }
async function runOnce() {
  if (posting) return { ok: false, error: 'Already posting' };
  posting = true; lastErr = null;
  try {
    const cfg = loadConfig();
    if (!cfg.anthropicApiKey) throw new Error('Anthropic API key missing');
    if (!cfg.instagramToken) throw new Error('Instagram token missing');
    if (!cfg.instagramAccountId) throw new Error('Instagram account ID missing');
    const file = nextInQueue(cfg.mediaFolder);
    if (!file) return fin({ ok: false, error: 'Queue empty' });
    console.log('[post] file:', file.name);
    const b64 = await toBase64(file.path);
    const cap = await generateCaption(b64, cfg);
    console.log('[post] caption:', cap.caption.slice(0, 60) + '...');
    const ig = await postToInstagram(file.path, cap.full, cfg);
    moveToPosted(file.path, cfg.postedFolder);
    const entry = { status: 'success', filename: file.name, caption: cap.caption, hashtags: cap.hashtags, mediaId: ig.mediaId };
    addHistory(entry); lastRun = new Date().toISOString();
    return fin({ ok: true, ...entry });
  } catch (err) {
    lastErr = err.message; addHistory({ status: 'error', error: err.message });
    console.error('[post] FAIL:', err.message);
    return fin({ ok: false, error: err.message });
  }
}
function fin(result) { posting = false; return result; }
module.exports = { start, stop, restart, runOnce, status };
EOF

cat > "$DIR/src/server.js" << 'EOF'
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { loadConfig, saveConfig, loadHistory, ensureDir } = require('./config');
const { listQueue, thumbnail, toBase64, nextInQueue } = require('./media');
const { generateCaption } = require('./caption');
const { verifyToken } = require('./instagram');
const sched = require('./scheduler');
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/media/incoming/:file', (req, res) => {
  const cfg = loadConfig();
  const fp = path.join(cfg.mediaFolder, req.params.file);
  if (!fp.startsWith(path.resolve(cfg.mediaFolder))) return res.sendStatus(403);
  if (!fs.existsSync(fp)) return res.sendStatus(404);
  res.sendFile(fp);
});
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { const cfg = loadConfig(); ensureDir(cfg.mediaFolder); cb(null, cfg.mediaFolder); },
    filename: (_req, file, cb) => { const ext = path.extname(file.originalname); const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_'); cb(null, base + '_' + Date.now() + ext); },
  }),
  fileFilter: (_req, file, cb) => { cb(null, /\.(jpe?g|png|webp|heic|heif)$/i.test(file.originalname)); },
  limits: { fileSize: 50 * 1024 * 1024 },
});
app.get('/api/status', (_req, res) => { const cfg = loadConfig(); const q = listQueue(cfg.mediaFolder); res.json({ queue: q.length, scheduler: sched.status(), configured: !!(cfg.instagramToken && cfg.instagramAccountId && cfg.anthropicApiKey) }); });
app.get('/api/queue', async (_req, res) => { const cfg = loadConfig(); const files = listQueue(cfg.mediaFolder); const out = []; for (const f of files) { out.push({ ...f, thumb: await thumbnail(f.path) }); } res.json(out); });
app.post('/api/upload', upload.array('images', 50), (req, res) => { if (!req.files?.length) return res.status(400).json({ error: 'No files' }); res.json({ ok: true, count: req.files.length, files: req.files.map(f => f.filename) }); });
app.delete('/api/queue/:name', (req, res) => { const cfg = loadConfig(); const fp = path.join(cfg.mediaFolder, req.params.name); if (!fp.startsWith(path.resolve(cfg.mediaFolder))) return res.sendStatus(403); if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' }); fs.unlinkSync(fp); res.json({ ok: true }); });
app.get('/api/history', (_req, res) => res.json(loadHistory()));
app.get('/api/config', (_req, res) => { const c = loadConfig(); res.json({ ...c, instagramToken: mask(c.instagramToken), anthropicApiKey: mask(c.anthropicApiKey) }); });
app.put('/api/config', (req, res) => { const body = req.body; if (body.instagramToken?.startsWith('••')) delete body.instagramToken; if (body.anthropicApiKey?.startsWith('••')) delete body.anthropicApiKey; const cfg = saveConfig(body); if (cfg.enabled) sched.restart(); else sched.stop(); res.json({ ok: true, config: { ...cfg, instagramToken: mask(cfg.instagramToken), anthropicApiKey: mask(cfg.anthropicApiKey) } }); });
app.post('/api/post-now', async (_req, res) => { try { res.json(await sched.runOnce()); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });
app.post('/api/preview', async (_req, res) => { try { const cfg = loadConfig(); const file = nextInQueue(cfg.mediaFolder); if (!file) return res.status(404).json({ error: 'Queue empty' }); const b64 = await toBase64(file.path); const cap = await generateCaption(b64, cfg); res.json({ file: file.name, ...cap }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/verify-ig', async (_req, res) => { const cfg = loadConfig(); res.json(await verifyToken(cfg.instagramToken)); });
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
function mask(s) { return s ? '••••' + s.slice(-6) : ''; }
app.listen(PORT, '0.0.0.0', () => { console.log('\n  IG Auto-Poster  ->  http://localhost:' + PORT + '\n'); const cfg = loadConfig(); ensureDir(cfg.mediaFolder); ensureDir(cfg.postedFolder); if (cfg.enabled) sched.start(); });
EOF

echo "All source files created!"
