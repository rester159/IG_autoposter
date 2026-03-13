const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const gameModel = require('./models/game');

const RAWG_API = 'https://api.rawg.io/api';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Search RAWG for a game by title and optional platform.
 */
async function searchGame(title, apiKey, platform = '') {
  if (!apiKey) throw new Error('RAWG API key not configured');

  const { data } = await axios.get(`${RAWG_API}/games`, {
    params: { key: apiKey, search: title, page_size: 5 },
  });

  if (!data.results?.length) return null;

  let match = data.results[0];
  if (platform) {
    const platMatch = data.results.find(g =>
      g.platforms?.some(p =>
        p.platform.name.toLowerCase().includes(platform.toLowerCase())
      )
    );
    if (platMatch) match = platMatch;
  }

  return {
    rawg_id: match.id,
    title: match.name,
    metacritic_score: match.metacritic || null,
    box_art_url: match.background_image || null,
    released: match.released || null,
  };
}

/**
 * Download box art from URL and save to game_images folder.
 */
async function downloadBoxArt(url, gameId, config) {
  const folder = config.gameImagesFolder || '/data/game_images';
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const filename = `rawg_${gameId}_boxart.jpg`;
  const filepath = path.join(folder, filename);

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(filepath, response.data);

  return { filename, filepath };
}

/**
 * Use Gemini Vision to compare uploaded game image with RAWG cover art.
 * Confirms they are the same game.
 */
async function verifyBoxArt(uploadedImagePath, downloadedImagePath, geminiApiKey) {
  if (!geminiApiKey) throw new Error('Gemini API key required for verification');

  // Resize both images for comparison
  const resize = async (imgPath) => {
    const buf = await sharp(imgPath)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return buf.toString('base64');
  };

  const [uploadedB64, downloadedB64] = await Promise.all([
    resize(uploadedImagePath),
    resize(downloadedImagePath),
  ]);

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
  const { data } = await axios.post(url, {
    contents: [{
      parts: [
        { text: 'Compare these two game images. Image 1 is a user-uploaded photo (could be a cartridge, box, screenshot, or cover). Image 2 is an official cover art from a game database. Are they the SAME GAME? Respond as JSON: {"match": true/false, "confidence": "high"/"medium"/"low", "reason": "<brief explanation>"}. ONLY respond with JSON, no markdown.' },
        { inlineData: { mimeType: 'image/jpeg', data: uploadedB64 } },
        { inlineData: { mimeType: 'image/jpeg', data: downloadedB64 } },
      ],
    }],
  });

  let text = data.candidates[0].content.parts[0].text.trim();
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(text);
}

/**
 * Full enrichment: fetch RAWG data + download art + verify match + update game record.
 */
async function enrichGame(gameId, rawgApiKey, geminiApiKey, config) {
  const game = gameModel.get(gameId);
  if (!game || !game.title) throw new Error('Game has no title to search');

  const rawgData = await searchGame(game.title, rawgApiKey, game.console);
  if (!rawgData) return { ok: false, message: 'Game not found on RAWG' };

  const updates = {
    rawg_id: rawgData.rawg_id,
    metacritic_score: rawgData.metacritic_score,
  };

  // Download box art if available
  let boxArtVerified = false;
  if (rawgData.box_art_url) {
    try {
      const { filename, filepath } = await downloadBoxArt(rawgData.box_art_url, gameId, config);
      updates.box_art_url = rawgData.box_art_url;

      // Verify match with uploaded image
      const uploadedPath = path.join(config.gameImagesFolder || '/data/game_images', game.image_filename);
      if (fs.existsSync(uploadedPath) && geminiApiKey) {
        const verification = await verifyBoxArt(uploadedPath, filepath, geminiApiKey);
        console.log('[rawg] box art verification:', JSON.stringify(verification));
        boxArtVerified = verification.match === true;
        if (!boxArtVerified) {
          console.log('[rawg] box art mismatch — keeping uploaded image');
          // Clean up downloaded file if no match
          try { fs.unlinkSync(filepath); } catch {}
        }
      }
    } catch (e) {
      console.error('[rawg] box art download/verify failed:', e.message);
    }
  }

  const updated = gameModel.update(gameId, updates);
  return { ok: true, game: updated, rawg: rawgData, boxArtVerified };
}

module.exports = { searchGame, downloadBoxArt, verifyBoxArt, enrichGame };
