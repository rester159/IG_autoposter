const axios = require('axios');
const postModel = require('./models/post');
const { getAll: loadConfig } = require('./models/config');

const API = 'https://graph.facebook.com/v21.0';

/**
 * Fetch insights for a single Instagram media item.
 * Photos: like_count, comments_count + insights (reach, impressions, saved, shares)
 * Reels: same + plays
 */
async function fetchMediaInsights(mediaId, token) {
  const { data: media } = await axios.get(`${API}/${mediaId}`, {
    params: {
      fields: 'like_count,comments_count,media_type',
      access_token: token,
    },
  });

  let reach = 0, impressions = 0, saves = 0, shares = 0;
  try {
    const { data: insights } = await axios.get(`${API}/${mediaId}/insights`, {
      params: {
        metric: 'reach,impressions,saved,shares',
        access_token: token,
      },
    });
    for (const m of insights.data || []) {
      if (m.name === 'reach') reach = m.values?.[0]?.value || 0;
      if (m.name === 'impressions') impressions = m.values?.[0]?.value || 0;
      if (m.name === 'saved') saves = m.values?.[0]?.value || 0;
      if (m.name === 'shares') shares = m.values?.[0]?.value || 0;
    }
  } catch (e) {
    console.error('[insights] metrics fetch failed for', mediaId, ':', e.message);
  }

  return {
    likes: media.like_count || 0,
    comments: media.comments_count || 0,
    reach,
    impressions,
    saves,
    shares,
  };
}

/**
 * Sync insights for all posted items that have an ig_media_id.
 */
async function syncAllInsights() {
  const cfg = loadConfig();
  if (!cfg.instagramToken) {
    console.log('[insights] no IG token, skipping sync');
    return { synced: 0 };
  }

  const posted = postModel.listPostedWithInsights()
    .filter(p => p.ig_media_id);

  let synced = 0;
  for (const post of posted) {
    try {
      const metrics = await fetchMediaInsights(post.ig_media_id, cfg.instagramToken);
      postModel.updateInsights(post.id, {
        ig_likes: metrics.likes,
        ig_comments_count: metrics.comments,
        ig_shares: metrics.shares,
        ig_reach: metrics.reach,
        ig_impressions: metrics.impressions,
        ig_saves: metrics.saves,
        insights_fetched_at: new Date().toISOString(),
      });
      synced++;
      // Rate limiting: ~200 calls/hour for IG Graph API
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error('[insights] sync failed for post #' + post.id, ':', e.message);
    }
  }
  console.log('[insights] synced', synced, 'posts');
  return { synced };
}

module.exports = { fetchMediaInsights, syncAllInsights };
