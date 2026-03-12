const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const gameModel = require('./models/game');
const genreModel = require('./models/genre');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Extract game metadata from an image using Gemini Vision,
 * then research credits (lead artist/creative/musician) in a follow-up call.
 *
 * Updates the games DB row with extracted data and sets ai_extracted = 1.
 *
 * @param {number} gameId - The games table row ID
 * @param {string} imagePath - Absolute path to the game image
 * @param {string} geminiApiKey - Gemini API key
 * @returns {{ ok: boolean, game?: object, error?: string }}
 */
async function extractGameMetadata(gameId, imagePath, geminiApiKey) {
  if (!geminiApiKey) throw new Error('Gemini API key not configured');
  if (!fs.existsSync(imagePath)) throw new Error('Image not found: ' + imagePath);

  const game = gameModel.get(gameId);
  if (!game) throw new Error('Game not found: ' + gameId);

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  // ── Call 1: Visual extraction (with image) ─────────────────────

  const genreNames = genreModel.nameList();

  const imgBuf = await sharp(imagePath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  console.log('[game-meta] call 1 — visual extraction for game', gameId);

  const call1 = await axios.post(url, {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: imgBuf.toString('base64') } },
        {
          text: `Analyze this game image (box art, screenshot, or cartridge). Extract the following as JSON:
{
  "title": "Game title",
  "console": "Platform/console (e.g. SNES, PS1, Genesis, NES, Game Boy, N64, etc.)",
  "genre": "Must be one of: ${genreNames.join(', ')}",
  "studio": "Developer/publisher studio name",
  "year": "Release year (4 digits)"
}

Rules:
- If you can't determine a field with confidence, use an empty string ""
- genre MUST be from the provided list, pick the closest match
- Be specific about the console — distinguish SNES vs NES, Genesis vs Master System, etc.
- Respond with ONLY the JSON object, no markdown fences or extra text`,
        },
      ],
    }],
  });

  let extracted = {};
  try {
    let text = call1.data.candidates[0].content.parts[0].text.trim();
    // Strip markdown fences if present
    text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    extracted = JSON.parse(text);
  } catch (e) {
    console.error('[game-meta] call 1 parse error:', e.message);
    extracted = {};
  }

  console.log('[game-meta] extracted:', JSON.stringify(extracted));

  // Match genre to ID
  let genreId = null;
  if (extracted.genre) {
    const genre = genreModel.list().find(g =>
      g.name.toLowerCase() === extracted.genre.toLowerCase()
    );
    if (genre) genreId = genre.id;
  }

  // Update game with visual extraction results
  const updateData = {
    title: extracted.title || '',
    console: extracted.console || '',
    genre_id: genreId,
    studio: extracted.studio || '',
    year: extracted.year || '',
  };

  // ── Call 2: AI research (text-only follow-up) ─────────────────

  if (extracted.title) {
    console.log('[game-meta] call 2 — credit research for', extracted.title);

    try {
      const call2 = await axios.post(url, {
        contents: [{
          parts: [{
            text: `For the video game "${extracted.title}" (${extracted.console || 'unknown platform'}, ${extracted.year || 'unknown year'}) by ${extracted.studio || 'unknown studio'}, provide the following as JSON:
{
  "lead_artist": "Lead artist or art director name",
  "lead_creative": "Lead designer, director, or producer name",
  "lead_musician": "Lead composer or music director name"
}

Rules:
- Use the actual credited individuals for these roles
- If you are not confident about a specific person, use "Unknown"
- Do NOT guess — only provide names you are reasonably sure about
- Respond with ONLY the JSON object, no markdown fences or extra text`,
          }],
        }],
      });

      let credits = {};
      try {
        let text = call2.data.candidates[0].content.parts[0].text.trim();
        text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
        credits = JSON.parse(text);
      } catch (e) {
        console.error('[game-meta] call 2 parse error:', e.message);
        credits = {};
      }

      console.log('[game-meta] credits:', JSON.stringify(credits));

      updateData.lead_artist = credits.lead_artist || '';
      updateData.lead_creative = credits.lead_creative || '';
      updateData.lead_musician = credits.lead_musician || '';
    } catch (e) {
      console.error('[game-meta] call 2 failed:', e.message);
      updateData.lead_artist = '';
      updateData.lead_creative = '';
      updateData.lead_musician = '';
    }
  }

  updateData.ai_extracted = 1;

  const updated = gameModel.update(gameId, updateData);
  console.log('[game-meta] saved:', updated?.title || '(no title)');

  return { ok: true, game: updated };
}

module.exports = { extractGameMetadata };
