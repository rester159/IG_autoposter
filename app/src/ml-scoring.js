const axios = require('axios');
const postModel = require('./models/post');
const { getAll: loadConfig } = require('./models/config');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Score all queued/ready posts using Gemini as the "ML model."
 *
 * Strategy:
 * 1. Gather historical performance data (posted items with insights)
 * 2. For each queued post, ask Gemini to predict engagement score
 * 3. Store ml_score on each post
 */
async function scoreQueue() {
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) throw new Error('Gemini API key missing');

  // Build historical context: posted items with engagement data
  const posted = postModel.listPostedWithInsights()
    .filter(p => p.ig_likes > 0 || p.ig_reach > 0)
    .slice(0, 30);

  const historyContext = posted.map(p => ({
    type: p.type,
    game: p.game_title || 'unknown',
    console: p.game_console || 'unknown',
    genre: p.genre_name || 'unknown',
    influencer: p.influencer_name || 'unknown',
    score: p.score || 0,
    likes: p.ig_likes || 0,
    comments: p.ig_comments_count || 0,
    shares: p.ig_shares || 0,
    reach: p.ig_reach || 0,
    saves: p.ig_saves || 0,
    posted_hour: p.posted_at ? new Date(p.posted_at).getHours() : 12,
    posted_day: p.posted_at ? new Date(p.posted_at).getDay() : 1,
  }));

  // Get queued/ready posts to score
  const queued = postModel.list({ status: 'queued' })
    .concat(postModel.list({ status: 'ready' }));

  if (!queued.length) return { scored: 0 };

  const postItems = queued.map(p => ({
    id: p.id,
    type: p.type,
    game: p.game_title || 'unknown',
    console: p.game_console || 'unknown',
    influencer: p.influencer_name || 'unknown',
    score: p.score || 0,
    caption_preview: (p.caption || '').slice(0, 100),
    scheduled_hour: p.scheduled_at ? new Date(p.scheduled_at).getHours() : 12,
  }));

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${cfg.geminiApiKey}`;

  const promptText = `You are a social media analytics engine. Based on historical Instagram post performance data, predict the engagement score (0-100) for each queued post.

HISTORICAL PERFORMANCE DATA (posts with real engagement metrics):
${JSON.stringify(historyContext, null, 1)}

QUEUED POSTS TO SCORE:
${JSON.stringify(postItems, null, 1)}

For each queued post, predict:
1. engagement_score (0-100): how well this post will perform
2. best_hour (0-23): optimal posting hour based on historical patterns
3. recommendation: one sentence why this score

Respond as JSON array, one object per queued post:
[{"id": <post_id>, "engagement_score": <0-100>, "best_hour": <0-23>, "recommendation": "<reason>"}]

ONLY respond with the JSON array, no markdown fences.`;

  const res = await axios.post(url, {
    contents: [{ parts: [{ text: promptText }] }],
  });

  let text = res.data.candidates[0].content.parts[0].text.trim();
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

  let scores;
  try {
    scores = JSON.parse(text);
  } catch (e) {
    console.error('[ml] parse error:', e.message);
    return { scored: 0, error: 'Parse error' };
  }

  let scored = 0;
  for (const s of scores) {
    if (!s.id || s.engagement_score === undefined) continue;
    postModel.updateMlScore(s.id, {
      ml_score: s.engagement_score,
      ml_recommendation: s.recommendation || '',
      ml_scored_at: new Date().toISOString(),
    });
    scored++;
  }

  console.log('[ml] scored', scored, 'posts');
  return { scored, scores };
}

/**
 * Get the top recommended post (highest ml_score).
 */
function getTopRecommended() {
  const queued = postModel.list({ status: 'queued' })
    .concat(postModel.list({ status: 'ready' }))
    .filter(p => p.ml_score != null)
    .sort((a, b) => (b.ml_score || 0) - (a.ml_score || 0));
  return queued[0] || null;
}

module.exports = { scoreQueue, getTopRecommended };
