const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ensureDir } = require('./config');

const VEO_API = 'https://generativelanguage.googleapis.com/v1beta';

function retryAfterMs(err, fallbackMs) {
  const h = err?.response?.headers || {};
  const val = h['retry-after'] || h['Retry-After'];
  if (!val) return fallbackMs;
  const sec = Number(val);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  const dt = Date.parse(val);
  if (!Number.isNaN(dt)) return Math.max(1000, dt - Date.now());
  return fallbackMs;
}

async function requestWith429Retry(fn, label, opts = {}) {
  const maxRetries = opts.maxRetries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 10000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.response?.status !== 429 || attempt === maxRetries) throw err;
      const waitMs = retryAfterMs(err, baseDelayMs * Math.pow(2, attempt));
      console.warn(`[${label}] 429 rate-limited, retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(waitMs);
    }
  }
}

/**
 * Generate a video via Veo 3.1 predictLongRunning.
 *
 * @param {string} prompt - The text prompt
 * @param {object} config - App config with geminiApiKey etc.
 * @param {object} opts - Optional: { referencePhotos: ['/path/to/img1.jpg', ...], duration: number }
 *
 * Returns the local file path of the saved .mp4.
 */
async function generateVideo(prompt, config, opts = {}) {
  if (!config.geminiApiKey) throw new Error('Gemini API key not configured');

  const model = 'veo-3.1-generate-preview';
  const url = `${VEO_API}/models/${model}:predictLongRunning?key=${config.geminiApiKey}`;

  // Build the instance object
  const instance = { prompt };

  // Add reference images if provided (up to 3)
  const refPhotos = (opts.referencePhotos || []).slice(0, 3);
  if (refPhotos.length) {
    const referenceImages = [];
    for (const photoPath of refPhotos) {
      if (!fs.existsSync(photoPath)) {
        console.log('[veo] skipping missing ref photo:', photoPath);
        continue;
      }
      try {
        const buf = await sharp(photoPath)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        referenceImages.push({
          image: {
            bytesBase64Encoded: buf.toString('base64'),
            mimeType: 'image/jpeg',
          },
          referenceType: 'asset',
        });
        console.log('[veo] added reference image:', path.basename(photoPath));
      } catch (e) {
        console.log('[veo] failed to process ref photo:', photoPath, e.message);
      }
    }
    if (referenceImages.length) {
      instance.referenceImages = referenceImages;
      console.log('[veo] sending', referenceImages.length, 'reference image(s)');
    }
  }

  // Parameters — don't use personGeneration with reference images
  const parameters = {
    aspectRatio: '9:16',
    durationSeconds: opts.duration || 8,
  };
  if (!instance.referenceImages) {
    parameters.personGeneration = 'allow_all';
  }

  console.log('[veo] submitting job, prompt length:', prompt.length, '| refs:', refPhotos.length, '| duration:', parameters.durationSeconds + 's');

  // 1 ── submit long-running generation
  const { data: op } = await requestWith429Retry(
    () => axios.post(url, { instances: [instance], parameters }),
    'veo-submit',
    { maxRetries: 5, baseDelayMs: 12000 }
  );

  const opName = op.name;
  if (!opName) throw new Error('Veo did not return an operation name: ' + JSON.stringify(op));
  console.log('[veo] operation:', opName);

  // 2 ── poll until done
  const pollUrl = `${VEO_API}/${opName}?key=${config.geminiApiKey}`;
  let result = null;

  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const { data } = await requestWith429Retry(
      () => axios.get(pollUrl),
      'veo-poll',
      { maxRetries: 6, baseDelayMs: 8000 }
    );

    if (data.done) {
      if (data.error) throw new Error('Veo error: ' + JSON.stringify(data.error));
      result = data.response || data;
      break;
    }

    const pct = data.metadata?.percentComplete || '?';
    console.log(`[veo] polling… (${i + 1}) ${pct}%`);

    if (i === 119) throw new Error('Timed out waiting for Veo (10 min)');
  }

  // 3 ── extract video data
  // Response structure: result.generateVideoResponse.generatedSamples[0].video
  const samples =
    result?.generateVideoResponse?.generatedSamples ||
    result?.generatedSamples ||
    [];

  if (!samples.length) throw new Error('Veo returned no video samples: ' + JSON.stringify(result).slice(0, 300));

  const videoData = samples[0].video;
  if (!videoData) throw new Error('No video data in sample');

  // 4 ── download or decode video to file
  const videoFolder = config.videoIncomingFolder || '/data/incoming_video';
  ensureDir(videoFolder);
  const filename = `veo_${Date.now()}.mp4`;
  const filePath = path.join(videoFolder, filename);

  if (videoData.uri) {
    // Download from URI — append API key if needed
    let downloadUrl = videoData.uri;
    if (!downloadUrl.includes('key=')) {
      downloadUrl += (downloadUrl.includes('?') ? '&' : '?') + 'key=' + config.geminiApiKey;
    }
    console.log('[veo] downloading from URI...');
    const resp = await requestWith429Retry(
      () => axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: { 'x-goog-api-key': config.geminiApiKey },
      }),
      'veo-download',
      { maxRetries: 4, baseDelayMs: 10000 }
    );
    fs.writeFileSync(filePath, Buffer.from(resp.data));
  } else if (videoData.bytesBase64Encoded) {
    // Decode base64
    console.log('[veo] decoding base64 video...');
    fs.writeFileSync(filePath, Buffer.from(videoData.bytesBase64Encoded, 'base64'));
  } else {
    throw new Error('Unexpected video format: ' + Object.keys(videoData).join(', '));
  }

  const stat = fs.statSync(filePath);
  console.log('[veo] saved:', filePath, `(${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  return { filePath, filename, size: stat.size, videoUri: videoData.uri || null };
}

/**
 * Extend a Veo-generated video with a continuation prompt.
 *
 * videoUri must be a Veo file URI from a previous generation
 * (format: https://generativelanguage.googleapis.com/.../files/...:download?alt=media)
 *
 * Returns the merged video (original + 7s extension).
 */
async function extendVideo(prompt, videoUri, config, opts = {}) {
  if (!config.geminiApiKey) throw new Error('Gemini API key not configured');
  if (!videoUri || !videoUri.startsWith('http')) {
    throw new Error('extendVideo requires a Veo file URI, got: ' + (videoUri || 'null'));
  }

  const model = 'veo-3.1-generate-preview';
  const url = `${VEO_API}/models/${model}:predictLongRunning?key=${config.geminiApiKey}`;

  const instance = {
    prompt,
    video: { uri: videoUri },
  };

  const parameters = {
    aspectRatio: '9:16',
  };

  console.log('[veo-extend] submitting extension job, prompt length:', prompt.length);
  console.log('[veo-extend] source video URI:', videoUri.slice(0, 80) + '...');

  // 1 ── submit
  let op;
  try {
    const resp = await requestWith429Retry(
      () => axios.post(url, { instances: [instance], parameters }),
      'veo-extend-submit',
      { maxRetries: 5, baseDelayMs: 12000 }
    );
    op = resp.data;
  } catch (submitErr) {
    const errData = submitErr.response?.data;
    console.error('[veo-extend] submit error:', submitErr.response?.status, JSON.stringify(errData).slice(0, 500));
    throw new Error('Veo extend submit failed: ' + (errData?.error?.message || submitErr.message));
  }

  const opName = op.name;
  if (!opName) throw new Error('Veo extend did not return operation: ' + JSON.stringify(op));
  console.log('[veo-extend] operation:', opName);

  // 2 ── poll
  const pollUrl = `${VEO_API}/${opName}?key=${config.geminiApiKey}`;
  let result = null;

  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const { data } = await requestWith429Retry(
      () => axios.get(pollUrl),
      'veo-extend-poll',
      { maxRetries: 6, baseDelayMs: 8000 }
    );
    if (data.done) {
      if (data.error) throw new Error('Veo extend error: ' + JSON.stringify(data.error));
      result = data.response || data;
      break;
    }
    const pct = data.metadata?.percentComplete || '?';
    console.log(`[veo-extend] polling… (${i + 1}) ${pct}%`);
    if (i === 119) throw new Error('Timed out waiting for Veo extend (10 min)');
  }

  // 3 ── extract merged video
  const samples =
    result?.generateVideoResponse?.generatedSamples ||
    result?.generatedSamples ||
    [];

  if (!samples.length) throw new Error('Veo extend returned no samples: ' + JSON.stringify(result).slice(0, 300));

  const videoData = samples[0].video;
  if (!videoData) throw new Error('No video data in extend result');

  // 4 ── save
  const videoFolder = config.videoIncomingFolder || '/data/incoming_video';
  ensureDir(videoFolder);
  const filename = `veo_extended_${Date.now()}.mp4`;
  const filePath = path.join(videoFolder, filename);

  if (videoData.uri) {
    let downloadUrl = videoData.uri;
    if (!downloadUrl.includes('key=')) {
      downloadUrl += (downloadUrl.includes('?') ? '&' : '?') + 'key=' + config.geminiApiKey;
    }
    console.log('[veo-extend] downloading merged video from URI...');
    const resp = await requestWith429Retry(
      () => axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: { 'x-goog-api-key': config.geminiApiKey },
      }),
      'veo-extend-download',
      { maxRetries: 4, baseDelayMs: 10000 }
    );
    fs.writeFileSync(filePath, Buffer.from(resp.data));
  } else if (videoData.bytesBase64Encoded) {
    console.log('[veo-extend] decoding base64 merged video...');
    fs.writeFileSync(filePath, Buffer.from(videoData.bytesBase64Encoded, 'base64'));
  } else {
    throw new Error('Unexpected video format in extend: ' + Object.keys(videoData).join(', '));
  }

  const stat = fs.statSync(filePath);
  console.log('[veo-extend] saved merged:', filePath, `(${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  return { filePath, filename, size: stat.size, videoUri: videoData.uri };
}

/**
 * List queued videos (oldest first).
 */
function listVideoQueue(folder) {
  ensureDir(folder);
  const EXTS = new Set(['.mp4', '.mov', '.webm']);
  return fs
    .readdirSync(folder)
    .filter(f => EXTS.has(path.extname(f).toLowerCase()) && !f.startsWith('.'))
    .map(f => {
      const fp = path.join(folder, f);
      const st = fs.statSync(fp);
      return { name: f, path: fp, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

function nextVideoInQueue(folder) {
  const q = listVideoQueue(folder);
  return q.length ? q[0] : null;
}

function moveVideoToPosted(filePath, postedFolder) {
  ensureDir(postedFolder);
  const dest = path.join(postedFolder, `${Date.now()}_${path.basename(filePath)}`);
  try { fs.renameSync(filePath, dest); } catch(e) { if(e.code==="EXDEV"){fs.copyFileSync(filePath,dest);fs.unlinkSync(filePath);}else throw e; }
  return dest;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { generateVideo, extendVideo, listVideoQueue, nextVideoInQueue, moveVideoToPosted };
