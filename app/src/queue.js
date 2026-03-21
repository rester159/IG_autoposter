/**
 * Unified Queue Manager
 *
 * Provides a single view of all content (photos + videos) ordered by
 * scheduled_at / sort_order. Used by schedulers, the API, and the UI.
 */

const postModel = require('./models/post');
const { getAll: loadConfig } = require('./models/config');

/**
 * Get the queue (all items), with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.status] - Filter by status (queued, ready, posted, etc.)
 * @param {string} [filters.type] - Filter by type (photo, video)
 * @param {string} [filters.platform] - Filter by platform (instagram, etc.)
 * @returns {Array} Ordered list of posts
 */
function getQueue(filters = {}) {
  return postModel.list(filters);
}

/**
 * Get the next item that is ready to post (status='ready', scheduled_at <= now).
 *
 * @param {string} [platform='instagram']
 * @returns {object|null} The next post to publish, or null
 */
function getNextReady(platform = 'instagram', accountId) {
  return postModel.nextReady(platform, accountId);
}

/**
 * Reorder queue items.
 *
 * @param {Array<{id: number, sort_order: number}>} items
 */
function reorder(items) {
  postModel.reorder(items);
}

/**
 * Set or update the scheduled datetime on a post.
 *
 * @param {number} postId
 * @param {string} datetime - ISO 8601 datetime string
 * @returns {object|null} Updated post
 */
function schedulePost(postId, datetime) {
  return postModel.update(postId, { scheduled_at: datetime });
}

/**
 * Create a photo post from an uploaded file.
 *
 * @param {object} data
 * @param {string} data.file_path - Full path to the image file
 * @param {string} data.file_name - Filename
 * @param {string} [data.influencer_id]
 * @param {string} [data.scheduled_at] - ISO datetime or null for auto-calc
 * @param {string} [data.platform='instagram']
 * @returns {object} The created post row
 */
function addPhotoPost(data) {
  // Auto-calculate scheduled_at if not provided: last scheduled + configured interval
  let scheduled_at = data.scheduled_at || null;
  if (!scheduled_at) {
    scheduled_at = calculateNextSlot('photo');
  }

  return postModel.add({
    type: 'photo',
    format: 'photo',
    status: 'queued',
    platform: data.platform || 'instagram',
    file_path: data.file_path,
    file_name: data.file_name,
    influencer_id: data.influencer_id || null,
    account_id: data.account_id || null,
    scheduled_at,
  });
}

/**
 * Create a video post from a generated video.
 *
 * @param {object} data
 * @param {string} data.file_path - Full path to the video file
 * @param {string} data.file_name - Filename
 * @param {string} [data.caption]
 * @param {string} [data.hashtags]
 * @param {string} [data.first_comment]
 * @param {string} [data.influencer_id]
 * @param {number} [data.game_id]
 * @param {string} [data.veo_prompt]
 * @param {number} [data.score]
 * @param {string} [data.scheduled_at]
 * @param {string} [data.platform='instagram']
 * @returns {object} The created post row
 */
function addVideoPost(data) {
  let scheduled_at = data.scheduled_at || null;
  if (!scheduled_at) {
    scheduled_at = calculateNextSlot('video');
  }

  return postModel.add({
    type: 'video',
    format: data.format || 'reel',
    status: data.status || 'queued',
    platform: data.platform || 'instagram',
    file_path: data.file_path,
    file_name: data.file_name,
    caption: data.caption || '',
    hashtags: data.hashtags || '',
    full_caption: data.full_caption || '',
    first_comment: data.first_comment || '',
    influencer_id: data.influencer_id || null,
    game_id: data.game_id || null,
    veo_prompt: data.veo_prompt || '',
    score: data.score || null,
    account_id: data.account_id || null,
    scheduled_at,
  });
}

/**
 * Calculate the next available time slot based on existing scheduled items.
 *
 * Spaces posts at least 3 hours apart by default.
 */
function calculateNextSlot(type) {
  const allPosts = postModel.list({ status: 'queued' })
    .concat(postModel.list({ status: 'ready' }));

  // Find the latest scheduled_at among pending items
  let latest = new Date();
  for (const p of allPosts) {
    if (p.scheduled_at) {
      const d = new Date(p.scheduled_at);
      if (d > latest) latest = d;
    }
  }

  // Use configured frequency (fallback to 3h photo / 6h video)
  const cfg = loadConfig();
  const freqMap = { '1h': 1, '3h': 3, '6h': 6, '12h': 12, '1d': 24, '3d': 72, '1w': 168 };
  const freq = type === 'video' ? (cfg.videoFrequency || '1d') : (cfg.photoFrequency || '1d');
  const intervalHours = freqMap[freq] || (type === 'video' ? 6 : 3);
  const next = new Date(latest.getTime() + intervalHours * 60 * 60 * 1000);

  return next.toISOString();
}

module.exports = {
  getQueue,
  getNextReady,
  reorder,
  schedulePost,
  addPhotoPost,
  addVideoPost,
  calculateNextSlot,
};
