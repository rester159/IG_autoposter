const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Overlay a score (e.g. "8/10") on the last ~3 seconds of a video.
 *
 * Uses ffmpeg drawtext filter:
 * - White text with black border/shadow
 * - Centered horizontally, lower-third of 9:16 frame
 * - Fades in during the last 3 seconds of the video
 *
 * @param {string} videoPath - Path to input video (.mp4)
 * @param {number} score - Score value (1-10)
 * @param {string} [outputPath] - Output path. If omitted, overwrites input via temp file.
 * @returns {Promise<string>} Path to the output video
 */
async function overlayScore(videoPath, score, outputPath) {
  if (!fs.existsSync(videoPath)) throw new Error('Video not found: ' + videoPath);
  if (score < 1 || score > 10) throw new Error('Score must be 1-10, got: ' + score);

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
  const fadeInStart = Math.max(0, duration - 3); // Start showing score 3s before end

  const scoreText = `${score}/10`;

  console.log('[ffmpeg] overlaying score', scoreText, 'on', path.basename(videoPath),
    `(duration: ${duration.toFixed(1)}s, fade at ${fadeInStart.toFixed(1)}s)`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoFilters([
        {
          filter: 'drawtext',
          options: {
            text: scoreText,
            fontsize: 120,
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
      .outputOptions(['-c:a', 'copy']) // keep audio untouched
      .output(outputPath)
      .on('end', () => {
        console.log('[ffmpeg] score overlay done:', path.basename(outputPath));
        if (useTemp) {
          // Replace original with scored version
          try {
            fs.unlinkSync(videoPath);
            fs.renameSync(outputPath, videoPath);
            resolve(videoPath);
          } catch (e) {
            // Cross-device fallback
            if (e.code === 'EXDEV') {
              fs.copyFileSync(outputPath, videoPath);
              fs.unlinkSync(outputPath);
              resolve(videoPath);
            } else {
              resolve(outputPath); // leave scored version if rename fails
            }
          }
        } else {
          resolve(outputPath);
        }
      })
      .on('error', (err) => {
        console.error('[ffmpeg] overlay error:', err.message);
        // Clean up temp file on failure
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

module.exports = { overlayScore, getVideoDuration };
