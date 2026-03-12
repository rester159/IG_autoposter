const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Generate a structured 3-part Veo video prompt for a game review.
 *
 * Uses full game metadata + expanded influencer fields to create a
 * personality-driven review with intro, bulk review, and final score.
 *
 * Returns { part1, part2, part3, score, firstComment, full }.
 */
async function generateVideoScript(config, influencer, gameImagePath, opts = {}) {
  if (!config.geminiApiKey) throw new Error('Gemini API key not configured');

  // Build parts array: influencer photos + room reference + game image + text prompt
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

  // Add the game image
  if (gameImagePath && fs.existsSync(gameImagePath)) {
    const gameBuf = await sharp(gameImagePath)
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    parts.push({
      inline_data: { mime_type: 'image/jpeg', data: gameBuf.toString('base64') },
    });
  }

  const background = opts.background || config.videoBackground || 'retro arcade with neon lights';
  const game = opts.game || {}; // game metadata from DB

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
  imageIndex += `Image ${gameImgIdx}: The GAME being reviewed.\n`;

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
Lead Musician: ${game.lead_musician || 'Unknown'}` : '';

  const style = opts.style || '';
  const styleGuide = {
    hype: 'The mood is HIGH ENERGY — fast cuts, loud voice, extreme excitement, lots of movement.',
    chill: 'The mood is relaxed and chill — soft lighting, calm voice, laid-back vibes, smooth camera.',
    funny: 'The mood is comedic — exaggerated expressions, funny reactions, unexpected moments, humor.',
    dramatic: 'The mood is cinematic and dramatic — epic lighting, intense music, serious tone, slow motion moments.',
    nostalgic: 'The mood is nostalgic — warm color grading, soft focus, dreamy atmosphere, wistful tone.',
    asmr: 'The mood is ASMR — very quiet whispered voice, close-up shots, gentle sounds, intimate feeling.',
  }[style] || '';

  // Text instruction
  parts.push({
    text: `You are writing a video generation prompt for Veo 3.1 (Google's AI video model) AND generating an Instagram first comment.

INFLUENCER PROFILE:
Name: ${influencer.name}
Personality: ${influencer.personality || 'Energetic gamer'}
Quirks: ${influencer.quirks || 'Expressive reactions'}
Visual description: ${influencer.expressions || 'Young person in casual gaming attire'}
Outfit: ${influencer.outfit || 'Inspired by the game — cosplay elements, colors, and accessories that reference the game\'s characters or aesthetic'}
Intro Phrase: ${influencer.intro_phrase || `Hey everyone, it's ${influencer.name}!`}
Game Tastes: ${influencer.game_tastes || 'Loves all kinds of games'}
Fashion Style: ${influencer.fashion_style || 'Gaming-inspired streetwear'}
${influencer.boyfriend ? 'Boyfriend / Character Lore: ' + influencer.boyfriend : ''}
${gameInfo}

IMAGE INDEX:
${imageIndex}
${hasRoom ? 'Use the ROOM reference image as the primary background/setting for the video scene.\n' : `Background: ${background}\n`}
${opts.topic ? 'SCRIPT / TOPIC: ' + opts.topic : ''}
${styleGuide ? 'STYLE: ' + styleGuide : ''}

TASK: Write THREE video prompts for Veo 3.1 that together form a ~24-second vertical 9:16 video WITH AUDIO. This is a structured game review.

PART 1 — INTRO (8 seconds):
The influencer uses their intro phrase ("${influencer.intro_phrase || `Hey everyone, it's ${influencer.name}!`}"), shows a cute expression or quirk, then says "I am reviewing ${game.title || 'this game'} for ${game.console || 'retro console'}!"
Establish the outfit, setting, and camera angle (medium close-up, slight low angle).

PART 2 — BULK REVIEW (8 seconds):
The influencer gives their honest take: 2 things they LOVE and 2 things they DISLIKE about the game.
Their personality should drive the opinions — use their game tastes and quirks.
${influencer.boyfriend ? 'They can reference ' + influencer.boyfriend + ' for humor.' : ''}
Use a DIFFERENT camera angle (switch to wide shot or dolly around).

PART 3 — ONE MORE THING + SCORE (8 seconds):
The influencer says "one more thing!" with a dramatic pause, shares a final hot take or fun fact.
Then they announce the final score (1-10) with a big reaction.
IMPORTANT: Describe the influencer SAYING the score number clearly and holding up fingers or a sign.
The score overlay will be added via ffmpeg — just have the influencer express the score verbally.
End in a similar pose/position as the opening for Instagram loop.

RULES:
- VERTICAL (9:16) phone format
- Describe the influencer's OUTFIT in detail — it should reference the game
- The person should SPEAK — describe their voice and what they say in EACH part
- Each part must use a DIFFERENT camera angle/movement
- First frame of Part 1 and last frame of Part 3 should be similar (for Instagram loop)
- Reference the game visually — props, costume elements, background details
- Include lighting, atmosphere, and sound design details
- Each part should be under 150 words — Veo works best with concise, vivid prompts
- Do NOT wrap in quotes or add any prefix

ALSO generate a SCORE (1-10) and a FIRST COMMENT for Instagram.
The first comment should be personality-driven, add extra thoughts about the game, engage followers.

Respond in EXACTLY this format (nothing else):
PART1: <intro 8-second prompt>
PART2: <bulk review 8-second prompt>
PART3: <score + final take 8-second prompt>
SCORE: <number 1-10>
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
  const sm = text.match(/SCORE:\s*(\d+)/i);
  const fcm = text.match(/FIRST_COMMENT:\s*([\s\S]*?)$/i);

  const part1 = p1m ? p1m[1].trim() : text.trim();
  const part2 = p2m ? p2m[1].trim() : '';
  const part3 = p3m ? p3m[1].trim() : '';
  const score = sm ? Math.min(10, Math.max(1, parseInt(sm[1]))) : null;
  const firstComment = fcm ? fcm[1].trim() : '';

  console.log('[script] part1:', part1.slice(0, 100) + '...');
  console.log('[script] part2:', part2.slice(0, 100) + '...');
  console.log('[script] part3:', part3.slice(0, 100) + '...');
  console.log('[script] score:', score);
  console.log('[script] firstComment:', firstComment.slice(0, 80) + '...');

  return { part1, part2, part3, score, firstComment, full: text };
}

module.exports = { generateVideoScript };
