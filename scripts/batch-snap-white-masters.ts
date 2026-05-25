/**
 * Batch fix for drifted white-backdrop masters.
 *
 * 2026-05-13: Gemini's grounding-shadow pass intermittently tints the
 * pure-white backdrop produced by the Python matte composite (caught on
 * Judee M03: backdrop drifted to #E5E1E1, ΔW=30). Going forward, the live
 * pipeline applies an adaptive snap-to-white step (subject-matte.ts
 * snapNearWhiteToPure) so new renders are pure white deterministically.
 *
 * This script post-processes EXISTING whiteMasterUrl files in-place — no
 * new generations, no API calls. Downloads each whiteMasterUrl, runs the
 * same adaptive snap, re-uploads to the same GCS path. ~2s per shot at
 * sharp speed.
 *
 * Default dry-run prints scope + sample backdrop hex per shot. --execute
 * commits the snap.
 *
 * Usage:
 *   npx tsx scripts/batch-snap-white-masters.ts             # dry-run
 *   npx tsx scripts/batch-snap-white-masters.ts --execute   # commit
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const EXECUTE = process.argv.includes('--execute');
const BUCKET = 'gstar-ai-studio-assets';

/** Parses the GCS object key out of a public https URL. */
function urlToKey(url: string): string | null {
  // Match https://storage.googleapis.com/{bucket}/{key}
  const m = url.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/(.+?)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Returns {drift, snapped} after the adaptive snap. Matches subject-matte.ts. */
async function snapAndAnalyze(buffer: Buffer): Promise<{ snappedBuffer: Buffer; bgR: number; bgG: number; bgB: number; drift: number; snappedPct: number }> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const { width: w, height: h } = meta;
  if (!w || !h) throw new Error('missing dims');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  // Detect backdrop from 100×100 top-left
  let sR = 0, sG = 0, sB = 0, n = 0;
  for (let y = 0; y < 100 && y < h; y++) for (let x = 0; x < 100 && x < w; x++) {
    const i = (y * w + x) * ch;
    sR += data[i]; sG += data[i + 1]; sB += data[i + 2]; n++;
  }
  const bgR = sR / n, bgG = sG / n, bgB = sB / n;
  const drift = 255 - Math.min(bgR, bgG, bgB);

  if (bgR < 200 || bgG < 200 || bgB < 200) {
    return { snappedBuffer: buffer, bgR, bgG, bgB, drift, snappedPct: 0 };
  }

  const TOL = Math.max(5, Math.min(20, Math.round(drift)));
  let snapped = 0;
  for (let i = 0; i < data.length; i += ch) {
    if (Math.abs(data[i] - bgR) <= TOL && Math.abs(data[i + 1] - bgG) <= TOL && Math.abs(data[i + 2] - bgB) <= TOL) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      snapped++;
    }
  }
  const snappedBuffer = await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  return { snappedBuffer, bgR, bgG, bgB, drift, snappedPct: snapped / (w * h) * 100 };
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: saKey.project_id, credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });
  const storage = new Storage({ projectId: saKey.project_id });
  const bucket = storage.bucket(BUCKET);

  console.log(`MODE: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  // Pull all shots with a whiteMasterUrl (M03/M04/M06)
  const allShots: { docId: string; shotType: string; whiteMasterUrl: string }[] = [];
  for (const shotType of ['M03', 'M04', 'M06']) {
    const snap = await db.collection('shots').where('shotType', '==', shotType).where('status', '==', 'done').get();
    for (const d of snap.docs) {
      const s = d.data() as any;
      if (s.whiteMasterUrl) {
        allShots.push({ docId: d.id, shotType, whiteMasterUrl: s.whiteMasterUrl });
      }
    }
  }
  console.log(`Total done shots with whiteMasterUrl: ${allShots.length}`);

  // Per-shot: download, measure drift; if >5, queue for fix
  const DRIFT_THRESHOLD = 5;  // anything ≥5 units off white gets fixed
  const driftedShots: typeof allShots = [];
  const sampleResults: { docId: string; bg: string; drift: number }[] = [];

  console.log(`\nScanning…`);
  let scanned = 0;
  for (const s of allShots) {
    const key = urlToKey(s.whiteMasterUrl);
    if (!key) continue;
    try {
      const [buf] = await bucket.file(key).download();
      // Cheap analyze (skip the snap step in scan phase)
      const image = sharp(buf);
      const meta = await image.metadata();
      const { width: w, height: h } = meta;
      if (!w || !h) continue;
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      let sR = 0, sG = 0, sB = 0, n = 0;
      for (let y = 0; y < 100 && y < h; y++) for (let x = 0; x < 100 && x < w; x++) {
        const i = (y * w + x) * ch;
        sR += data[i]; sG += data[i + 1]; sB += data[i + 2]; n++;
      }
      const bgR = sR / n, bgG = sG / n, bgB = sB / n;
      const drift = 255 - Math.min(bgR, bgG, bgB);
      if (drift >= DRIFT_THRESHOLD && bgR >= 200 && bgG >= 200 && bgB >= 200) {
        driftedShots.push(s);
        sampleResults.push({
          docId: s.docId,
          bg: `#${Math.round(bgR).toString(16).padStart(2, '0').toUpperCase()}${Math.round(bgG).toString(16).padStart(2, '0').toUpperCase()}${Math.round(bgB).toString(16).padStart(2, '0').toUpperCase()}`,
          drift: Math.round(drift),
        });
      }
      scanned++;
      if (scanned % 20 === 0) console.log(`  scanned ${scanned}/${allShots.length}…`);
    } catch { /* skip on download error */ }
  }

  console.log(`\n── SCOPE ──`);
  console.log(`Scanned: ${scanned}`);
  console.log(`Drifted (≥${DRIFT_THRESHOLD} units off white): ${driftedShots.length}`);
  console.log(`\nSample drifted shots (first 15):`);
  for (const r of sampleResults.slice(0, 15)) {
    console.log(`  ${r.docId.slice(0,10)}  bg=${r.bg}  ΔW=${r.drift}`);
  }

  if (driftedShots.length === 0) {
    console.log(`\nNo drift to fix.`);
    return;
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN. Re-run with --execute to commit.`);
    return;
  }

  console.log(`\nApplying snap to ${driftedShots.length} files…`);
  let fixed = 0;
  for (const s of driftedShots) {
    const key = urlToKey(s.whiteMasterUrl)!;
    try {
      const [buf] = await bucket.file(key).download();
      const { snappedBuffer, drift, snappedPct } = await snapAndAnalyze(buf);
      await bucket.file(key).save(snappedBuffer, { metadata: { contentType: 'image/png' } });
      fixed++;
      if (fixed % 10 === 0 || fixed === driftedShots.length) {
        console.log(`  ${fixed}/${driftedShots.length}  ${s.docId.slice(0,10)} drift=${drift.toFixed(0)} snapped=${snappedPct.toFixed(0)}%`);
      }
    } catch (e) {
      console.warn(`  ${s.docId.slice(0,10)} FAILED:`, (e as Error).message);
    }
  }

  console.log(`\n── DONE ──`);
  console.log(`Files snapped + re-uploaded: ${fixed}/${driftedShots.length}`);
  console.log(`No DB writes — whiteMasterUrl already points to these GCS keys.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
