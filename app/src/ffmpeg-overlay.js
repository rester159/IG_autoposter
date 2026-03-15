const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Overlay a score on the last ~3 seconds of a video.
 *
 * @param {string} videoPath - Path to input video (.mp4)
 * @param {number|string} score - Score value to display (e.g. 8.5 for "8.5/10")
 * @param {string} [outputPath] - Output path. If omitted, overwrites input via temp file.
 * @param {object} [opts] - Options
 * @param {string} [opts.scoreText] - Custom score text override (e.g. "8.5/10")
 * @returns {Promise<string>} Path to the output video
 */
async function overlayScore(videoPath, score, outputPath, opts = {}) {
  if (!fs.existsSync(videoPath)) throw new Error('Video not found: ' + videoPath);

  // If no output path, use a temp file then rename
  const useTemp = !outputPath;
  if (useTemp) {
    const dir = path.dirname(videoPath);
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);
    outputPath = path.join(dir, `${base}_scored${ext}`);
  }

  // Get video duration first
  const duration = await getVideoDuration(videoPath);
  const fadeInStart = Math.max(0, duration - 3);

  // Build score text — accept pre-formatted string or format as X/10
  const scoreText = opts.scoreText || `${score}/10`;
  const fontsize = scoreText.length > 4 ? 100 : 120;

  console.log('[ffmpeg] overlaying score', scoreText, 'on', path.basename(videoPath),
    `(duration: ${duration.toFixed(1)}s, fade at ${fadeInStart.toFixed(1)}s)`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoFilters([
        {
          filter: 'drawtext',
          options: {
            text: scoreText,
            fontfile: '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
            fontsize,
            fontcolor: 'white',
            borderw: 4,
            bordercolor: 'black',
            shadowcolor: 'black@0.6',
            shadowx: 3,
            shadowy: 3,
            x: '(w-text_w)/2',
            y: 'h*0.72',
            enable: `between(t,${fadeInStart},${duration})`,
            alpha: `if(lt(t,${fadeInStart}),0,min(1,(t-${fadeInStart})/0.5))`,
          },
        },
      ])
      .outputOptions(['-c:a', 'copy'])
      .output(outputPath)
      .on('end', () => {
        console.log('[ffmpeg] score overlay done:', path.basename(outputPath));
        if (useTemp) {
          try {
            fs.unlinkSync(videoPath);
            fs.renameSync(outputPath, videoPath);
            resolve(videoPath);
          } catch (e) {
            if (e.code === 'EXDEV') {
              fs.copyFileSync(outputPath, videoPath);
              fs.unlinkSync(outputPath);
              resolve(videoPath);
            } else {
              resolve(outputPath);
            }
          }
        } else {
          resolve(outputPath);
        }
      })
      .on('error', (err) => {
        console.error('[ffmpeg] overlay error:', err.message);
        if (useTemp && fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }
        reject(err);
      })
      .run();
  });
}

/**
 * Get video duration in seconds using ffprobe.
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (!duration) return reject(new Error('Could not determine video duration'));
      resolve(parseFloat(duration));
    });
  });
}

function hasAudioStream(videoPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return resolve(false);
      const streams = metadata?.streams || [];
      resolve(streams.some(s => s.codec_type === 'audio'));
    });
  });
}

/**
 * Normalize a video's runtime to targetSeconds.
 * - If slightly short, time-stretch A/V so content reaches exact target
 * - If long, trims to exact target
 */
async function normalizeVideoDuration(videoPath, targetSeconds, outputPath, opts = {}) {
  if (!fs.existsSync(videoPath)) throw new Error('Video not found: ' + videoPath);
  const target = Number(targetSeconds);
  if (!Number.isFinite(target) || target <= 0) return { path: videoPath, changed: false };

  const current = await getVideoDuration(videoPath);
  const diff = target - current;
  if (Math.abs(diff) < 0.12) {
    return { path: videoPath, changed: false, before: current, after: current };
  }

  const useTemp = !outputPath;
  if (useTemp) {
    const dir = path.dirname(videoPath);
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);
    outputPath = path.join(dir, `${base}_durfix${ext}`);
  }

  const hasAudio = await hasAudioStream(videoPath);
  const ratio = target / current; // >1 => extend runtime (slower), <1 => shorten runtime
  const speedAudio = Math.max(0.5, Math.min(2.0, 1 / ratio)); // atempo range

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(videoPath).videoFilters([`setpts=${ratio.toFixed(6)}*PTS`]);
    if (hasAudio) cmd = cmd.audioFilters([`atempo=${speedAudio.toFixed(6)}`]);

    cmd
      .outputOptions(['-t', target.toFixed(3), '-movflags', '+faststart'])
      .output(outputPath)
      .on('end', () => {
        if (useTemp) {
          try {
            fs.unlinkSync(videoPath);
            fs.renameSync(outputPath, videoPath);
            resolve({ path: videoPath, changed: true, before: current, after: target });
          } catch (e) {
            if (e.code === 'EXDEV') {
              fs.copyFileSync(outputPath, videoPath);
              fs.unlinkSync(outputPath);
              resolve({ path: videoPath, changed: true, before: current, after: target });
            } else {
              resolve({ path: outputPath, changed: true, before: current, after: target });
            }
          }
        } else {
          resolve({ path: outputPath, changed: true, before: current, after: target });
        }
      })
      .on('error', (err) => {
        if (useTemp && fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }
        reject(err);
      })
      .run();
  });
}

module.exports = { overlayScore, getVideoDuration, normalizeVideoDuration };
