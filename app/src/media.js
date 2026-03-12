const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ensureDir } = require('./config');

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

/**
 * Return sorted list of image files in the incoming folder (oldest first).
 */
function listQueue(folder) {
  ensureDir(folder);
  return fs
    .readdirSync(folder)
    .filter(f => IMG_EXTS.has(path.extname(f).toLowerCase()) && !f.startsWith('.'))
    .map(f => {
      const fp = path.join(folder, f);
      const st = fs.statSync(fp);
      return { name: f, path: fp, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

/** Oldest file in queue, or null. */
function nextInQueue(folder) {
  const q = listQueue(folder);
  return q.length ? q[0] : null;
}

/** Move file into the posted folder with a timestamp prefix. */
function moveToPosted(filePath, postedFolder) {
  ensureDir(postedFolder);
  const dest = path.join(postedFolder, `${Date.now()}_${path.basename(filePath)}`);
  try { fs.renameSync(filePath, dest); } catch(e) { if(e.code==="EXDEV"){fs.copyFileSync(filePath,dest);fs.unlinkSync(filePath);}else throw e; }
  return dest;
}

/** 300×300 JPEG thumbnail as a data-URI string. */
async function thumbnail(filePath) {
  try {
    const buf = await sharp(filePath).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Encode an image as base64 JPEG (≤1024px) for the Claude vision API. */
async function toBase64(filePath) {
  const buf = await sharp(filePath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return buf.toString('base64');
}

module.exports = { listQueue, nextInQueue, moveToPosted, thumbnail, toBase64 };
