/**
 * Instagram Posting Module
 *
 * Consolidated Instagram posting for photos and reels.
 * Wraps the existing instagram.js (photos) and instagram-reels.js (reels + comments).
 */

const { postToInstagram } = require('../instagram');
const { postReel, postComment } = require('../instagram-reels');

/**
 * Post a content item to Instagram.
 *
 * @param {object} post - The post row from the posts table
 * @param {object} config - App config
 * @returns {Promise<{mediaId: string, platform: string}>}
 */
async function publish(post, config) {
  if (post.type === 'video') {
    // Post as Reel
    const result = await postReel(post.file_path, post.full_caption || post.caption || '', config);

    // Post first comment (non-blocking)
    if (post.first_comment) {
      try {
        await postComment(result.mediaId, post.first_comment, config);
        console.log('[ig] first comment posted on', result.mediaId);
      } catch (err) {
        console.error('[ig] first comment failed (non-critical):', err.message);
      }
    }

    return { mediaId: result.mediaId, platform: 'instagram' };
  } else {
    // Post as photo
    const result = await postToInstagram(post.file_path, post.full_caption || post.caption || '', config);

    // Post first comment for photos too
    if (post.first_comment && result.mediaId) {
      try {
        await postComment(result.mediaId, post.first_comment, config);
        console.log('[ig] first comment posted on photo', result.mediaId);
      } catch (err) {
        console.error('[ig] photo first comment failed (non-critical):', err.message);
      }
    }

    return { mediaId: result.mediaId, platform: 'instagram' };
  }
}

module.exports = { publish };
