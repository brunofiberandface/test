/**
 * One-shot backfill: pre-create _seedream.jpg siblings for every wardrobe and
 * model image whose original is non-JPEG/PNG (typically AVIF) or > 9 MiB.
 *
 * Idempotent — re-runs are no-ops since the sibling existence is checked first.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa_key.json node scripts/_backfill_seedream_siblings.mjs
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const PROJECT_ID = 'gstar-ai-studio';
const BUCKET_NAME = 'gstar-ai-studio-assets';
const SAFE_LIMIT_BYTES = 9 * 1024 * 1024;
const TARGET_MAX_BYTES = 8 * 1024 * 1024;
const MAX_LONG_EDGE = 2000;

const db = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET_NAME);

const stats = { checked: 0, alreadyOk: 0, convertedNew: 0, siblingExisted: 0, skipped: 0, errors: 0 };

function gcsPathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const prefix = `https://storage.googleapis.com/${BUCKET_NAME}/`;
  const clean = url.split('?')[0];
  if (!clean.startsWith(prefix)) return null;
  return decodeURIComponent(clean.slice(prefix.length));
}

function siblingPath(p) {
  const lastSlash = p.lastIndexOf('/');
  const dir = lastSlash >= 0 ? p.slice(0, lastSlash + 1) : '';
  const name = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  return `${dir}${base}_seedream.jpg`;
}

async function statSize(p) {
  try {
    const [meta] = await bucket.file(p).getMetadata();
    return Number(meta.size || 0);
  } catch {
    return null;
  }
}

async function isJpegOrPng(p) {
  try {
    const [head] = await bucket.file(p).download({ start: 0, end: 31 });
    if (head.length < 8) return false;
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
    return false;
  } catch {
    return false;
  }
}

async function downsizeToJpeg(buf) {
  let q = 85, edge = MAX_LONG_EDGE;
  for (let i = 0; i < 5; i++) {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: q, mozjpeg: true })
      .toBuffer();
    if (out.length <= TARGET_MAX_BYTES) return out;
    if (q > 60) q = Math.max(60, q - 10); else edge = Math.max(1200, Math.round(edge * 0.85));
  }
  return await sharp(buf).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 60, mozjpeg: true }).toBuffer();
}

async function ensureSibling(url, label = '') {
  stats.checked++;
  const p = gcsPathFromUrl(url);
  if (!p) { stats.skipped++; return; }
  const size = await statSize(p);
  if (size === null) { stats.skipped++; return; }

  const oversize = size > SAFE_LIMIT_BYTES;
  let nonSupported = false;
  if (!oversize) {
    nonSupported = !(await isJpegOrPng(p));
  }
  if (!oversize && !nonSupported) { stats.alreadyOk++; return; }

  const sibPath = siblingPath(p);
  const sibSize = await statSize(sibPath);
  if (sibSize !== null && sibSize <= SAFE_LIMIT_BYTES) {
    console.log(`[skip-existing] ${p} → sibling exists (${(sibSize/1024/1024).toFixed(1)} MiB)`);
    stats.siblingExisted++;
    return;
  }

  const reason = oversize ? `oversize ${(size/1024/1024).toFixed(1)}MiB` : 'non-JPEG/PNG';
  console.log(`[convert] ${p} (${reason})${label ? ' ['+label+']' : ''}`);
  try {
    const [origBuf] = await bucket.file(p).download();
    const outBuf = await downsizeToJpeg(origBuf);
    await bucket.file(sibPath).save(outBuf, { metadata: { contentType: 'image/jpeg' } });
    console.log(`           → ${sibPath} (${(outBuf.length/1024/1024).toFixed(1)} MiB)`);
    stats.convertedNew++;
  } catch (err) {
    console.error(`           ERROR converting ${p}:`, err.message);
    stats.errors++;
  }
}

(async () => {
  console.log('--- Wardrobe items ---');
  const wardSnap = await db.collection('wardrobe').get();
  for (const doc of wardSnap.docs) {
    const d = doc.data();
    const name = d.name || doc.id;
    const candidates = [
      d.flatFrontUrl, d.flatBackUrl,
      d.fitModels?.front, d.fitModels?.front45Left, d.fitModels?.front45Right,
      d.fitModels?.back, d.fitModels?.back45Left, d.fitModels?.back45Right,
    ].filter(Boolean);
    for (const u of candidates) {
      await ensureSibling(u, `wardrobe/${name}`);
    }
  }

  console.log('--- Models ---');
  const modSnap = await db.collection('models').get();
  for (const doc of modSnap.docs) {
    const d = doc.data();
    const candidates = [d.referenceImageUrl, d.cardImageUrl, d.backReferenceImageUrl].filter(Boolean);
    for (const u of candidates) {
      await ensureSibling(u, `model/${doc.id}`);
    }
  }

  console.log('\nDone:', JSON.stringify(stats, null, 2));
})();
