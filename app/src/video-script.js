const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Generate a structured 3-part Veo video prompt for a game review.
 *
 * Uses full game metadata + expanded influencer fields to create a
 * technical, personality-driven review with intro, bulk review, and final score.
 *
 * Returns { part1, part2, part3, score, firstComment, full }.
 */
async function generateVideoScript(config, influencer, gameImagePath, opts = {}) {
  if (!config.geminiApiKey) throw new Error('Gemini API key not configured');

  const parts = [];

  // Add influencer reference photos (up to 3)
  if (influencer.photos && influencer.photos.length) {
    const photoDir = path.join('/data/team', influencer.id);
    const refs = influencer.photos.slice(0, 3);
    for (const p of refs) {
      const fp = path.join(photoDir, p);
      if (fs.existsSync(fp)) {
        try {
          const buf = await sharp(fp)
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          parts.push({
            inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') },
          });
        } catch (e) {
          console.log('[script] skipping ref photo:', p, e.message);
        }
      }
    }
  }

  // Add room/background reference image if available
  let hasRoom = false;
  if (influencer.room) {
    const roomPath = path.join('/data/team', influencer.id, influencer.room);
    if (fs.existsSync(roomPath)) {
      try {
        const buf = await sharp(roomPath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        parts.push({
          inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') },
        });
        hasRoom = true;
      } catch (e) {
        console.log('[script] skipping room image:', e.message);
      }
    }
  }

  // Use verified RAWG box art if available, otherwise use uploaded game image
  const effectiveGameImage = opts.verifiedBoxArtPath && fs.existsSync(opts.verifiedBoxArtPath)
    ? opts.verifiedBoxArtPath
    : gameImagePath;

  // Add the game image
  if (effectiveGameImage && fs.existsSync(effectiveGameImage)) {
    const gameBuf = await sharp(effectiveGameImage)
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    parts.push({
      inline_data: { mime_type: 'image/jpeg', data: gameBuf.toString('base64') },
    });
  }

  const background = opts.background || config.videoBackground || 'retro arcade with neon lights';
  const bgMode = opts.bgMode || 'influencer';
  const outfitMode = opts.outfitMode || 'game-inspired';
  const scriptContent = opts.scriptContent || null;
  const game = opts.game || {};

  // Convert metacritic score to X/10 format (one decimal)
  const displayScore = game.metacritic_score
    ? (game.metacritic_score / 10).toFixed(1)
    : null;

  // Build image index description for the prompt
  const refPhotoCount = Math.min(influencer.photos?.length || 0, 3);
  let imageIndex = '';
  if (refPhotoCount > 0) {
    imageIndex += `Images 1-${refPhotoCount}: REFERENCE PHOTOS of the influencer — study their exact appearance.\n`;
  }
  if (hasRoom) {
    imageIndex += `Image ${refPhotoCount + 1}: ROOM/BACKGROUND reference — use this as the setting for the video.\n`;
  }
  const gameImgIdx = refPhotoCount + (hasRoom ? 1 : 0) + 1;
  imageIndex += `Image ${gameImgIdx}: The GAME being reviewed.${opts.verifiedBoxArtPath ? ' (Official cover art)' : ''}\n`;

  // Game metadata block
  const gameInfo = game.title ? `
GAME BEING REVIEWED:
Title: ${game.title}
Console: ${game.console || 'Unknown'}
Genre: ${game.genre_name || 'Unknown'}
Studio: ${game.studio || 'Unknown'}
Year: ${game.year || 'Unknown'}
Lead Artist: ${game.lead_artist || 'Unknown'}
Lead Creative: ${game.lead_creative || 'Unknown'}
Lead Musician: ${game.lead_musician || 'Unknown'}${displayScore ? '\nScore: ' + displayScore + '/10' : ''}` : '';

  const style = opts.style || '';
  const styleGuide = {
    hype: 'The mood is HIGH ENERGY — fast cuts, loud voice, extreme excitement, lots of movement.',
    chill: 'The mood is relaxed and chill — soft lighting, calm voice, laid-back vibes, smooth camera.',
    funny: 'The mood is comedic — exaggerated expressions, funny reactions, unexpected moments, humor.',
    dramatic: 'The mood is cinematic and dramatic — epic lighting, intense music, serious tone, slow motion moments.',
    nostalgic: 'The mood is nostalgic — warm color grading, soft focus, dreamy atmosphere, wistful tone.',
    asmr: 'The mood is ASMR — very quiet whispered voice, close-up shots, gentle sounds, intimate feeling.',
  }[style] || '';

  const scoreInstruction = displayScore
    ? `The game scores ${displayScore} out of 10. The influencer MUST state this exact score.`
    : 'The influencer announces their own score from 1 to 10.';

  // Text instruction
  parts.push({
    text: `You are writing a video generation prompt for Veo 3.1 (Google's AI video model) AND generating an Instagram first comment.

INFLUENCER PROFILE:
Name: ${influencer.name}
Personality: ${influencer.personality || 'Energetic gamer'}
Quirks: ${influencer.quirks || 'Expressive reactions'}
Visual description: ${influencer.expressions || 'Young person in casual gaming attire'}
Outfit: ${outfitMode === 'game-inspired' ? "Inspired by the game — design a creative cosplay outfit with colors, accessories, and elements that reference the game's characters or aesthetic" : (influencer.outfit || 'Casual gaming attire')}
Intro Phrase: ${influencer.intro_phrase || `Hey everyone, it's ${influencer.name}!`}
Game Tastes: ${influencer.game_tastes || 'Loves all kinds of games'}
Fashion Style: ${influencer.fashion_style || 'Gaming-inspired streetwear'}
${influencer.boyfriend ? 'Boyfriend / Character Lore: ' + influencer.boyfriend : ''}
${gameInfo}

IMAGE INDEX:
${imageIndex}
${bgMode === 'game-inspired' ? 'BACKGROUND: Design a creative environment INSPIRED BY THE GAME being reviewed. The setting should reference the game\'s world, art style, and atmosphere — NOT the influencer\'s usual room.\n' : (hasRoom ? 'Use the ROOM reference image as the primary background/setting for the video scene.\n' : `Background: ${background}\n`)}
${scriptContent ? 'SCRIPT TEMPLATE / CREATIVE DIRECTION:\n' + scriptContent + '\n' : (opts.topic ? 'SCRIPT / TOPIC: ' + opts.topic : '')}
${styleGuide ? 'STYLE: ' + styleGuide : ''}

TASK: Write THREE video prompts for Veo 3.1 that together form a ~24-second vertical 9:16 video WITH AUDIO. This is a structured game review. Each part MUST be 40-60 words. Use precise, technical language.

PART 1 — INTRO (8 seconds, 40-60 words):
The influencer uses their intro phrase ("${influencer.intro_phrase || `Hey everyone, it's ${influencer.name}!`}"), shows a signature expression, then states "I am reviewing ${game.title || 'this game'} for ${game.console || 'retro console'}."
Establish the outfit, setting, and camera angle (medium close-up, slight low angle).

PART 2 — BULK REVIEW (8 seconds, 40-60 words):
The influencer delivers a precise critique: highlight 2 technical strengths and 2 weaknesses.
Use terms like "well-crafted", "mechanically sound", "visually striking", "lacks polish", "uneven pacing".
Their personality and game tastes should inform the opinions.
${influencer.boyfriend ? 'They can reference ' + influencer.boyfriend + ' for humor.' : ''}
Use a DIFFERENT camera angle (switch to wide shot or dolly around).

PART 3 — ONE MORE THING + SCORE (8 seconds, 40-60 words):
The influencer says "one more thing!" with a dramatic pause, shares a final technical observation or standout detail.
${scoreInstruction}
IMPORTANT: Describe the influencer SAYING the score number clearly and holding up fingers or a sign.
The score overlay will be added via ffmpeg — just have the influencer express the score verbally.
End in a similar pose/position as the opening for Instagram loop.

TONE RULES:
- Use precise, technical vocabulary: "well-crafted", "mechanically refined", "visually cohesive", "sonically rich"
- Avoid casual filler: NO "like", "you know", "super", "totally", "awesome", "amazing", "insane"
- The influencer speaks with authority and specificity about game design

VISUAL RULES:
- VERTICAL (9:16) phone format
- Describe the influencer's OUTFIT in detail — it should reference the game
- The person should SPEAK — describe their voice and what they say in EACH part
- Each part must use a DIFFERENT camera angle/movement
- First frame of Part 1 and last frame of Part 3 should be similar (for Instagram loop)
- Reference the game visually — props, costume elements, background details
- Include lighting, atmosphere, and sound design details
- Each part MUST be 40-60 words — Veo works best with concise, vivid prompts
- Do NOT wrap in quotes or add any prefix

ALSO generate a FIRST COMMENT for Instagram.
The first comment should be personality-driven, add extra technical thoughts about the game, engage followers.

Respond in EXACTLY this format (nothing else):
PART1: <intro 8-second prompt, 40-60 words>
PART2: <bulk review 8-second prompt, 40-60 words>
PART3: <score + final take 8-second prompt, 40-60 words>
SCORE: <number, e.g. 8.5>
FIRST_COMMENT: <Instagram first comment text, 2-4 sentences>`,
  });

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;

  const res = await axios.post(url, {
    contents: [{ parts }],
  });

  const text = res.data.candidates[0].content.parts[0].text.trim();

  // Parse three parts + score + first comment
  const p1m = text.match(/PART1:\s*([\s\S]*?)(?=PART2:|$)/i);
  const p2m = text.match(/PART2:\s*([\s\S]*?)(?=PART3:|$)/i);
  const p3m = text.match(/PART3:\s*([\s\S]*?)(?=SCORE:|$)/i);
  const sm = text.match(/SCORE:\s*([\d.]+)/i);
  const fcm = text.match(/FIRST_COMMENT:\s*([\s\S]*?)$/i);

  const part1 = p1m ? p1m[1].trim() : text.trim();
  const part2 = p2m ? p2m[1].trim() : '';
  const part3 = p3m ? p3m[1].trim() : '';

  // Prefer metacritic-derived score; fall back to Gemini's score
  let score;
  if (displayScore) {
    score = parseFloat(displayScore);
  } else if (sm) {
    score = Math.min(10, Math.max(1, parseFloat(sm[1])));
  } else {
    score = null;
  }
  const firstComment = fcm ? fcm[1].trim() : '';

  console.log('[script] part1:', part1.slice(0, 100) + '...');
  console.log('[script] part2:', part2.slice(0, 100) + '...');
  console.log('[script] part3:', part3.slice(0, 100) + '...');
  console.log('[script] score:', score);
  console.log('[script] firstComment:', firstComment.slice(0, 80) + '...');

  return { part1, part2, part3, score, firstComment, full: text };
}

module.exports = { generateVideoScript };
