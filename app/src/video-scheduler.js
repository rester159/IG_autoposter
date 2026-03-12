const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { loadConfig, addHistory } = require('./config');
const { generateVideo, extendVideo, nextVideoInQueue, moveVideoToPosted, listVideoQueue } = require('./video');
const { generateVideoScript } = require('./video-script');
const { postReel, postComment } = require('./instagram-reels');
const { generateCaption } = require('./caption');
const { overlayScore } = require('./ffmpeg-overlay');
const team = require('./team');
const gameModel = require('./models/game');
const { extractGameMetadata } = require('./game-metadata');

let job = null;
let posting = false;
let lastRun = null;
let lastErr = null;
let generating = false;  // track Veo generation separately

// ── status ────────────────────────────────────────────────────────
function status() {
  const cfg = loadConfig();
  return {
    enabled: cfg.videoEnabled || false,
    cron: cfg.videoCronSchedule || '0 12 * * *',
    posting,
    generating,
    lastRun,
    lastErr,
  };
}

// ── start / stop / restart ────────────────────────────────────────
function start() {
  stop();
  const cfg = loadConfig();
  if (!cfg.videoEnabled) return false;
  const schedule = cfg.videoCronSchedule || '0 12 * * *';
  if (!cron.validate(schedule)) {
    lastErr = 'Invalid video cron: ' + schedule;
    return false;
  }
  console.log('[video-sched] starting:', schedule);
  job = cron.schedule(schedule, () => {
    postNextVideo().catch(e => console.error('[video-sched]', e.message));
  });
  return true;
}

function stop() {
  if (job) { job.stop(); job = null; console.log('[video-sched] stopped'); }
}

function restart() { stop(); return start(); }

// ── generate a video (script → Veo) without posting ───────────────
async function generateOne(opts = {}) {
  if (generating) return { ok: false, error: 'Already generating' };
  generating = true;

  try {
    const cfg = loadConfig();
    if (!cfg.geminiApiKey) throw new Error('Gemini API key missing');

    // Pick an influencer
    const teamList = team.loadTeam();
    let influencer;
    if (opts.influencerId) {
      influencer = teamList.find(i => i.id === opts.influencerId);
      if (!influencer) throw new Error('Influencer not found: ' + opts.influencerId);
    } else if (cfg.videoInfluencerId) {
      influencer = teamList.find(i => i.id === cfg.videoInfluencerId);
    }
    if (!influencer && teamList.length) {
      // Random pick
      influencer = teamList[Math.floor(Math.random() * teamList.length)];
    }
    if (!influencer) throw new Error('No influencers configured — add one in the Team tab');

    // Pick a game image and resolve game metadata
    const gameFolder = cfg.gameImagesFolder || '/data/game_images';
    let gameImagePath = opts.gameImagePath || null;
    let gameRecord = null;

    if (opts.gameId) {
      // Specific game selected
      gameRecord = gameModel.get(opts.gameId);
      if (gameRecord) {
        gameImagePath = path.join(gameFolder, gameRecord.image_filename);
        if (!fs.existsSync(gameImagePath)) gameImagePath = null;
      }
    } else if (!gameImagePath && opts.gameImage) {
      // gameImage is a filename from the dropdown
      const gp = path.join(gameFolder, opts.gameImage);
      if (fs.existsSync(gp)) {
        gameImagePath = gp;
        gameRecord = gameModel.getByImage(opts.gameImage);
      }
    }
    if (!gameImagePath) {
      // Pick random game image
      const { ensureDir } = require('./config');
      ensureDir(gameFolder);
      const images = fs.readdirSync(gameFolder)
        .filter(f => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith('.'))
        .sort();
      if (images.length) {
        const pick = images[Math.floor(Math.random() * images.length)];
        gameImagePath = path.join(gameFolder, pick);
        gameRecord = gameModel.getByImage(pick);
      }
    }

    // Auto-extract game metadata if not yet done
    if (gameRecord && !gameRecord.ai_extracted && gameImagePath) {
      console.log('[video] auto-extracting game metadata for:', gameRecord.image_filename);
      try {
        const result = await extractGameMetadata(gameRecord.id, gameImagePath, cfg.geminiApiKey);
        gameRecord = result.game;
      } catch (e) {
        console.error('[video] metadata extraction failed:', e.message);
      }
    }

    console.log('[video] influencer:', influencer.name,
      '| game:', gameRecord?.title || '(no metadata)',
      '| image:', gameImagePath || 'none');

    // 1 — Get the Veo prompt(s) + score + first comment
    let part1Prompt, part2Prompt, part3Prompt, score = null, firstComment = '';
    if (opts.customPrompt) {
      // Custom prompt: use as single part, no extension
      part1Prompt = opts.customPrompt;
      part2Prompt = null;
      part3Prompt = null;
      console.log('[video] using custom prompt (single part)');
    } else {
      const script = await generateVideoScript(cfg, influencer, gameImagePath, {
        background: opts.background || cfg.videoBackground,
        duration: cfg.videoDuration || 8,
        topic: opts.topic,
        style: opts.style,
        outfit: opts.outfit,
        game: gameRecord || {},
      });
      part1Prompt = script.part1;
      part2Prompt = script.part2;
      part3Prompt = script.part3;
      score = script.score;
      firstComment = script.firstComment || '';
    }

    // 2 — Collect reference photos (2 influencer + 1 room + 1 game)
    const referencePhotos = [];
    if (influencer.photos && influencer.photos.length) {
      const photoDir = path.join('/data/team', influencer.id);
      for (const p of influencer.photos.slice(0, 2)) {
        const fp = path.join(photoDir, p);
        if (fs.existsSync(fp)) referencePhotos.push(fp);
      }
    }
    // Add room as reference for background consistency
    if (influencer.room) {
      const roomPath = path.join('/data/team', influencer.id, influencer.room);
      if (fs.existsSync(roomPath)) referencePhotos.push(roomPath);
    }
    if (gameImagePath && fs.existsSync(gameImagePath)) {
      referencePhotos.push(gameImagePath);
    }
    console.log('[video] reference photos:', referencePhotos.length, '(influencer + room + game)');

    // 3 — Generate Part 1: INTRO (8 seconds)
    console.log('[video] generating part 1 (intro)...');
    const video1 = await generateVideo(part1Prompt, cfg, { referencePhotos });

    // 4 — Extend with Part 2: BULK REVIEW (adds 8 seconds → 16s total)
    let finalVideo = video1;
    let currentUri = video1.videoUri;

    if (part2Prompt && currentUri) {
      console.log('[video] waiting 3 min before part 2 (rate limit cooldown)...');
      await new Promise(r => setTimeout(r, 180000));
      console.log('[video] extending with part 2 (bulk review)...');
      try {
        const video2 = await extendVideo(part2Prompt, currentUri, cfg);
        // Remove part 1 file, we have the merged version
        try { fs.unlinkSync(video1.filePath); } catch (e) {}
        finalVideo = video2;
        currentUri = video2.videoUri;
        console.log('[video] 16-second video ready');
      } catch (extErr) {
        console.error('[video] part 2 extension failed:', extErr.message);
        currentUri = null; // stop chaining
      }
    } else if (part2Prompt && !currentUri) {
      console.log('[video] no Veo URI from part 1, skipping extensions');
    }

    // 5 — Extend with Part 3: SCORE + FINAL TAKE (adds 8 seconds → 24s total)
    if (part3Prompt && currentUri && finalVideo !== video1) {
      console.log('[video] waiting 3 min before part 3 (rate limit cooldown)...');
      await new Promise(r => setTimeout(r, 180000));
      console.log('[video] extending with part 3 (score + final take)...');
      try {
        const prevFile = finalVideo.filePath;
        const video3 = await extendVideo(part3Prompt, currentUri, cfg);
        // Remove the 16s intermediate file
        try { fs.unlinkSync(prevFile); } catch (e) {}
        finalVideo = video3;
        console.log('[video] ~24-second video ready');
      } catch (extErr) {
        console.error('[video] part 3 extension failed, using 16s version:', extErr.message);
      }
    }

    // 6 — ffmpeg score overlay (if score available)
    if (score && finalVideo.filePath && fs.existsSync(finalVideo.filePath)) {
      console.log('[video] applying ffmpeg score overlay:', score + '/10');
      try {
        await overlayScore(finalVideo.filePath, score);
        console.log('[video] score overlay applied');
      } catch (e) {
        console.error('[video] score overlay failed (video still usable):', e.message);
      }
    }

    // 7 — Generate a caption for the reel
    let caption = { caption: '', hashtags: '', full: '' };
    try {
      const axios = require('axios');
      const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
      const geminiUrl = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${cfg.geminiApiKey}`;

      const gameTitle = gameRecord?.title || 'a retro game';
      const gameConsole = gameRecord?.console || '';

      const res = await axios.post(geminiUrl, {
        contents: [{
          parts: [{
            text: `Write a captivating Instagram Reels caption for a video of ${influencer.name} ` +
              `(personality: ${influencer.personality || 'energetic gamer'}) reviewing ${gameTitle}` +
              `${gameConsole ? ' for ' + gameConsole : ''}. ` +
              `Score: ${score || 'not given'}. ` +
              `Be fun, authentic, and brief (1-2 sentences). Then add ${cfg.hashtagCount || 20} relevant hashtags.\n\n` +
              `Format:\nCAPTION: <caption>\nHASHTAGS: #tag1 #tag2 ...`,
          }],
        }],
      });
      const text = res.data.candidates[0].content.parts[0].text;
      const cm = text.match(/CAPTION:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
      const hm = text.match(/HASHTAGS:\s*([\s\S]*)/i);
      caption.caption = cm ? cm[1].trim() : text.trim();
      caption.hashtags = hm ? hm[1].trim() : '';
      caption.full = `${caption.caption}\n\n${caption.hashtags}`.trim();
    } catch (e) {
      console.log('[video] caption generation failed, using default:', e.message);
      caption.full = `${influencer.name} reviews ${gameRecord?.title || 'a classic'}! 🎮🔥`;
    }

    // 8 — Create a post in the unified queue
    const queue = require('./queue');
    const postRow = queue.addVideoPost({
      file_path: finalVideo.filePath,
      file_name: finalVideo.filename,
      caption: caption.caption,
      hashtags: caption.hashtags,
      full_caption: caption.full,
      first_comment: firstComment,
      influencer_id: influencer.id,
      game_id: gameRecord?.id || null,
      veo_prompt: part1Prompt.slice(0, 500),
      score: score || null,
      status: 'ready',  // video is generated and ready to post
    });
    console.log('[video] created post #' + postRow.id + ' in unified queue');

    const entry = {
      status: 'generated',
      type: 'video',
      filename: finalVideo.filename,
      influencer: influencer.name,
      influencerId: influencer.id,
      prompt: part1Prompt.slice(0, 200),
      caption: caption.caption,
      hashtags: caption.hashtags,
      size: finalVideo.size,
      post_id: postRow.id,
      metadata: {
        score,
        firstComment,
        gameId: gameRecord?.id || null,
        gameTitle: gameRecord?.title || null,
      },
    };
    addHistory(entry);

    return {
      ok: true,
      ...entry,
      fullCaption: caption.full,
      score,
      firstComment,
      postId: postRow.id,
    };

  } catch (err) {
    lastErr = err.message;
    addHistory({ status: 'error', type: 'video', error: err.message });
    console.error('[video] GENERATE FAIL:', err.message);
    return { ok: false, error: err.message };
  } finally {
    generating = false;
  }
}

// ── post the next queued video as a Reel ──────────────────────────
async function postNextVideo() {
  if (posting) return { ok: false, error: 'Already posting video' };
  posting = true;
  lastErr = null;

  try {
    const cfg = loadConfig();
    if (!cfg.instagramToken) throw new Error('Instagram token missing');
    if (!cfg.instagramAccountId) throw new Error('Instagram account ID missing');

    // Try unified queue first (posts table)
    const postModel = require('./models/post');
    let post = postModel.nextReady('instagram');
    // Filter to video only
    if (post && post.type !== 'video') post = null;

    let file, captionText, firstCommentText;

    if (post) {
      // Post from unified queue
      console.log('[video] posting from queue: post #' + post.id, post.file_name);
      postModel.update(post.id, { status: 'posting' });
      file = { name: post.file_name, path: post.file_path };
      captionText = post.full_caption || `${post.caption || ''}\n\n${post.hashtags || ''}`.trim();
      firstCommentText = post.first_comment || '';
    } else {
      // Fallback: file-based video queue
      const videoFolder = cfg.videoIncomingFolder || '/data/incoming_video';
      file = nextVideoInQueue(videoFolder);
      if (!file) return fin({ ok: false, error: 'Video queue empty' });

      console.log('[video] posting from filesystem:', file.name);

      // Generate a caption
      try {
        const axios = require('axios');
        const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
        const geminiUrl = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${cfg.geminiApiKey}`;
        const res = await axios.post(geminiUrl, {
          contents: [{
            parts: [{
              text: `Write a captivating Instagram Reels caption for a retro game review video. ` +
                `Be fun, energetic, authentic. 1-2 sentences. Then add ${cfg.hashtagCount || 20} hashtags.\n\n` +
                `Format:\nCAPTION: <caption>\nHASHTAGS: #tag1 #tag2 ...`,
            }],
          }],
        });
        captionText = res.data.candidates[0].content.parts[0].text;
        const cm = captionText.match(/CAPTION:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
        const hm = captionText.match(/HASHTAGS:\s*([\s\S]*)/i);
        const cap = cm ? cm[1].trim() : captionText.trim();
        const hash = hm ? hm[1].trim() : '';
        captionText = `${cap}\n\n${hash}`.trim();
      } catch (e) {
        captionText = '🎮 Game review time! #retrogaming #gaming';
      }
      firstCommentText = '';
    }

    if (!captionText) captionText = '🎮 Game review time! #retrogaming #gaming';

    // Post as Reel
    const ig = await postReel(file.path, captionText, cfg);

    // Post first comment (non-blocking)
    if (firstCommentText) {
      try {
        await postComment(ig.mediaId, firstCommentText, cfg);
        console.log('[video] first comment posted');
      } catch (commentErr) {
        console.error('[video] first comment failed (non-critical):', commentErr.message);
      }
    }

    // Update post row if from unified queue
    if (post) {
      postModel.update(post.id, {
        status: 'posted',
        ig_media_id: ig.mediaId,
        posted_at: new Date().toISOString(),
      });
    } else {
      // File-based: move to posted
      const postedFolder = cfg.videoPostedFolder || '/data/posted_video';
      moveVideoToPosted(file.path, postedFolder);
    }

    const entry = {
      status: 'success',
      type: 'video',
      filename: file.name,
      caption: captionText.split('\n')[0],
      mediaId: ig.mediaId,
    };
    addHistory(entry);
    lastRun = new Date().toISOString();
    return fin({ ok: true, ...entry });

  } catch (err) {
    lastErr = err.message;
    addHistory({ status: 'error', type: 'video', error: err.message });
    console.error('[video] POST FAIL:', err.message);
    return fin({ ok: false, error: err.message });
  }
}

function fin(result) { posting = false; return result; }

module.exports = { start, stop, restart, generateOne, postNextVideo, status };
