/**
 * Platform Router
 *
 * Routes post publishing to the correct platform module
 * based on the post's `platform` field.
 */

const platforms = {
  instagram: require('./instagram'),
  tiktok: require('./tiktok'),
  'youtube-shorts': require('./youtube-shorts'),
};

/**
 * Publish a post to its configured platform.
 *
 * @param {object} post - The post row from the posts table
 * @param {object} config - App config
 * @returns {Promise<{mediaId: string, platform: string}>}
 */
async function publish(post, config) {
  const platform = post.platform || 'instagram';
  const module = platforms[platform];
  if (!module) {
    throw new Error(`Unknown platform: ${platform}. Available: ${Object.keys(platforms).join(', ')}`);
  }
  return module.publish(post, config);
}

/**
 * List available platforms.
 */
function listPlatforms() {
  return Object.keys(platforms);
}

module.exports = { publish, listPlatforms };
