const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Generate a structured multi-part Veo video prompt for a game review.
 *
 * Uses full game metadata + expanded influencer fields to create a
 * technical, personality-driven review with intro, bulk review, and final score.
 *
 * Returns { parts, part1, part2, part3, score, firstComment, full }.
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
    hype: 'The mood is HIGH ENERGY but controlled — confident voice, dynamic gestures, no rushed speech or rapid speed shifts.',
    chill: 'The mood is relaxed and chill — soft lighting, calm voice, laid-back vibes, smooth camera.',
    funny: 'The mood is comedic — playful reactions and humor while maintaining clear, steady speaking pace.',
    dramatic: 'The mood is cinematic and dramatic — intense atmosphere and deliberate delivery, no abrupt speech speed changes.',
    nostalgic: 'The mood is nostalgic — warm color grading, soft focus, dreamy atmosphere, wistful tone with even cadence.',
    asmr: 'The mood is ASMR — very quiet whispered voice, close-up shots, gentle sounds, intimate feeling, consistent cadence.',
  }[style] || '';

  const scoreInstruction = displayScore
    ? `The game scores ${displayScore} out of 10. The influencer MUST state this exact score.`
    : 'The influencer announces their own score from 1 to 10.';
  const segmentDuration = 8;
  const totalDuration = Math.max(segmentDuration, Number(opts.duration) || 24);
  const numParts = Math.max(1, Math.floor(totalDuration / segmentDuration));
  const partSpecLines = [];
  for (let i = 1; i <= numParts; i++) {
    if (i === 1) {
      partSpecLines.push(
        `PART ${i} — INTRO (${segmentDuration} seconds, 16-24 words):`,
        `Use intro phrase ("${influencer.intro_phrase || `Hey everyone, it's ${influencer.name}!`}"), then clearly state the reviewed game and platform.`
      );
    } else if (i === numParts) {
      partSpecLines.push(
        `PART ${i} — FINAL TAKE + SCORE (${segmentDuration} seconds, 16-24 words):`,
        'Start with "one more thing!", deliver a final technical observation, then clearly say the score.',
        scoreInstruction,
        'End in a pose/position close to PART 1 to help looping.'
      );
    } else {
      partSpecLines.push(
        `PART ${i} — REVIEW CORE (${segmentDuration} seconds, 16-24 words):`,
        'Deliver concrete technical strengths/weaknesses (mechanics, visuals, audio, pacing). Keep detail high and concise.'
      );
    }
    partSpecLines.push('Use a different camera angle or movement than the previous part.', '');
  }
  const outputPartLines = [];
  for (let i = 1; i <= numParts; i++) outputPartLines.push(`PART${i}: <prompt for part ${i}, 16-24 spoken words>`);

  // Text instruction
  parts.push({
    text: `You are writing a video generation prompt for Veo 3.1 (Google's AI video model) AND generating an Instagram first comment.

INFLUENCER PROFILE:
Name: ${influencer.name}
Personality: ${influencer.personality || 'Energetic gamer'}
Quirks: ${influencer.quirks || 'Expressive reactions'}
Visual description: ${influencer.expressions || 'Young person in casual gaming attire'}
Outfit: ${outfitMode === 'game-inspired'
  ? "Inspired by the game — design a tight, suggestive, form-fitting cosplay outfit that clearly references the game's characters/aesthetic through color palette, silhouette, textures, and signature accessories. Keep it stylish, polished, and camera-ready."
  : (influencer.outfit || 'Casual gaming attire')}
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

TASK: Write ${numParts} video prompts for Veo 3.1 that together form a ~${totalDuration}-second vertical 9:16 video WITH AUDIO. This is a structured game review. Each part MUST be 16-24 spoken words (ideal target: 20). Use precise, technical language.

CRITICAL TIMING + DELIVERY CONSTRAINTS:
- Speaking pace must be steady and natural across all parts (about 2.2-2.8 words/second, no sudden acceleration/deceleration).
- The influencer must FINISH the final sentence within ~7.0 seconds of each 8-second part.
- Reserve the final ~0.8-1.0 second of each part for a natural non-speaking beat (expression, nod, breathing room).
- Never end mid-word or mid-sentence; each part must end on a complete thought.
- Keep sentence count short (1-2 short sentences per part) to avoid clipping.

CONTINUITY + EDITING RULES:
- Treat all PARTs as one continuous performance split into 8-second chunks.
- Use smooth temporal continuity between parts; avoid abrupt jump-cuts in motion, pose, or speech energy.
- End each non-final PART with a natural micro-pause that can bridge into the next segment.
- Keep vocal tone and loudness consistent across all parts.

${partSpecLines.join('\n')}

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
- Each part MUST be 16-24 words and end with a complete sentence plus a brief non-speaking beat
- Do NOT wrap in quotes or add any prefix

ALSO generate a FIRST COMMENT for Instagram.
The first comment should be personality-driven, add extra technical thoughts about the game, engage followers.

Respond in EXACTLY this format (nothing else):
${outputPartLines.join('\n')}
SCORE: <number, e.g. 8.5>
FIRST_COMMENT: <Instagram first comment text, 2-4 sentences>`,
  });

  const url = `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;

  const res = await axios.post(url, {
    contents: [{ parts }],
  });

  const text = res.data.candidates[0].content.parts[0].text.trim();

  // Parse parts + score + first comment
  const parsedParts = [];
  for (let i = 1; i <= numParts; i++) {
    const nextTag = i < numParts ? `PART${i + 1}:` : 'SCORE:';
    const re = new RegExp(`PART${i}:\\s*([\\s\\S]*?)(?=${nextTag}|$)`, 'i');
    const m = text.match(re);
    parsedParts.push(m ? m[1].trim() : '');
  }
  const sm = text.match(/SCORE:\s*([\d.]+)/i);
  const fcm = text.match(/FIRST_COMMENT:\s*([\s\S]*?)$/i);
  if (!parsedParts[0]) parsedParts[0] = text.trim();
  const part1 = parsedParts[0] || '';
  const part2 = parsedParts[1] || '';
  const part3 = parsedParts[2] || '';

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

  console.log('[script] parts:', parsedParts.length, '| p1:', (part1 || '').slice(0, 100) + '...');
  console.log('[script] score:', score);
  console.log('[script] firstComment:', firstComment.slice(0, 80) + '...');

  return { parts: parsedParts, part1, part2, part3, score, firstComment, full: text };
}

module.exports = { generateVideoScript };
