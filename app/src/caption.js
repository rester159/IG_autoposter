const axios = require('axios');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Send the image to Gemini and get back { caption, hashtags, full, metaTags, firstComment }.
 */
async function generateCaption(imageBase64, config, opts = {}) {
  if (!config.geminiApiKey) throw new Error('Gemini API key not configured');

  const hashtagGuide = {
    viral:
      'Use trending, high-volume hashtags that maximise reach (millions of posts each).',
    niche:
      'Use specific, micro-community hashtags (10 k–500 k posts) tightly related to the image.',
    mixed:
      'Mix ~40 % high-volume viral tags, ~30 % mid-range (500 k–5 M), ~30 % niche tags.',
  }[config.hashtagStyle] || '';

  // Build influencer personality context if available
  const infContext = opts.influencer
    ? `The post is by ${opts.influencer.name} (personality: ${opts.influencer.personality || 'energetic'}). Match their voice.`
    : '';

  const promptText = [
    config.captionPrompt,
    infContext,
    '',
    `Then on a NEW line generate exactly ${config.hashtagCount} hashtags.`,
    hashtagGuide,
    '',
    'Also generate META_TAGS: 5-8 comma-separated keywords describing the image content (for alt text / discoverability).',
    '',
    infContext ? 'Also generate a FIRST_COMMENT: a personality-matched engaging comment (2-3 sentences) from the influencer to boost engagement.' : '',
    '',
    'Respond in EXACTLY this format (nothing else):',
    'CAPTION: <caption>',
    'HASHTAGS: #tag1 #tag2 …',
    'META_TAGS: keyword1, keyword2, …',
    infContext ? 'FIRST_COMMENT: <comment text>' : '',
  ].filter(Boolean).join('\n');

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;

  const res = await axios.post(url, {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        { text: promptText },
      ],
    }],
  });

  const text = res.data.candidates[0].content.parts[0].text;
  return parse(text);
}

function parse(text) {
  const cm = text.match(/CAPTION:\s*([\s\S]*?)(?=HASHTAGS:|META_TAGS:|FIRST_COMMENT:|$)/i);
  const hm = text.match(/HASHTAGS:\s*([\s\S]*?)(?=META_TAGS:|FIRST_COMMENT:|$)/i);
  const mm = text.match(/META_TAGS:\s*([\s\S]*?)(?=FIRST_COMMENT:|$)/i);
  const fm = text.match(/FIRST_COMMENT:\s*([\s\S]*?)$/i);
  const caption = cm ? cm[1].trim() : text.trim();
  const hashtags = hm ? hm[1].trim() : '';
  const metaTags = mm ? mm[1].trim() : '';
  const firstComment = fm ? fm[1].trim() : '';
  return {
    caption,
    hashtags,
    full: `${caption}\n\n${hashtags}`.trim(),
    metaTags,
    firstComment,
  };
}

module.exports = { generateCaption };
