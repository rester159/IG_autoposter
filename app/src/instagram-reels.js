const axios = require('axios');
const path = require('path');

const API = 'https://graph.facebook.com/v21.0';

/**
 * Post a video as an Instagram Reel via the Graph API.
 *
 * Flow: create Reels container → poll until ready → publish.
 *
 * The video must be reachable at a public URL.
 */
async function postReel(filePath, caption, config) {
  if (!config.instagramToken) throw new Error('Instagram token not configured');
  if (!config.instagramAccountId) throw new Error('Instagram account ID not configured');
  if (!config.publicUrl) {
    throw new Error(
      'publicUrl not set — Instagram must fetch the video from a public URL. ' +
      'Set it in Settings → Public URL.'
    );
  }

  const videoUrl =
    config.publicUrl.replace(/\/+$/, '') +
    '/media/incoming_video/' +
    encodeURIComponent(path.basename(filePath));

  // 1 ── create Reels container
  console.log('[reels] creating container for', videoUrl);
  const { data: ctr } = await axios.post(`${API}/${config.instagramAccountId}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: true,
    access_token: config.instagramToken,
  });
  const containerId = ctr.id;
  console.log('[reels] container', containerId);

  // 2 ── poll until FINISHED (videos take longer)
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const { data } = await axios.get(`${API}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: config.instagramToken },
    });
    console.log('[reels] status', data.status_code, `(${i + 1})`);
    if (data.status_code === 'FINISHED') break;
    if (data.status_code === 'ERROR') {
      throw new Error('Instagram rejected the video: ' + (data.status || 'unknown error'));
    }
    if (i === 59) throw new Error('Timed out waiting for Instagram to process video (5 min)');
  }

  // 3 ── publish
  const { data: pub } = await axios.post(
    `${API}/${config.instagramAccountId}/media_publish`,
    { creation_id: containerId, access_token: config.instagramToken }
  );
  console.log('[reels] published', pub.id);
  return { mediaId: pub.id, containerId };
}

/**
 * Post a comment on an Instagram media item.
 *
 * Used for "first comment" — posting hashtags or extra engagement text
 * as the first comment right after publishing.
 *
 * Non-critical: caller should catch errors so a failed comment doesn't
 * kill the post workflow.
 *
 * @param {string} mediaId - The IG media ID (from postReel or photo publish)
 * @param {string} commentText - The comment text
 * @param {object} config - App config with instagramToken
 * @returns {{ id: string }} The comment ID
 */
async function postComment(mediaId, commentText, config) {
  if (!config.instagramToken) throw new Error('Instagram token not configured');
  if (!mediaId) throw new Error('mediaId is required');
  if (!commentText || !commentText.trim()) throw new Error('Comment text is empty');

  console.log('[reels] posting first comment on', mediaId, '(' + commentText.length + ' chars)');

  const { data } = await axios.post(`${API}/${mediaId}/comments`, {
    message: commentText.trim(),
    access_token: config.instagramToken,
  });

  console.log('[reels] comment posted:', data.id);
  return { id: data.id };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { postReel, postComment };
