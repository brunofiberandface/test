/**
 * Fetch each uploaded GCS URL and confirm height=4096.
 * Reads /tmp/backfill_results.json and writes /tmp/backfill_verify.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import sharp from 'sharp';

interface Result { id: string; name: string; category: string; frontSlot: string|null; backSlot: string|null; status: string; }
const results: Result[] = JSON.parse(fs.readFileSync('/tmp/backfill_results.json', 'utf-8'));

const BUCKET = 'gstar-ai-studio-assets';
type Verified = Result & { frontDims?: string; backDims?: string; verifyOk?: boolean; verifyMsg?: string };
const out: Verified[] = [];

(async () => {
  for (const r of results) {
    const v: Verified = { ...r };
    if (r.status !== 'OK' || !r.frontSlot || !r.backSlot) { out.push(v); continue; }
    for (const which of ['front', 'back'] as const) {
      const slot = which === 'front' ? r.frontSlot : r.backSlot;
      const url = `https://storage.googleapis.com/${BUCKET}/wardrobe/${r.category}/${r.id}/${slot}`;
      const tmp = `/tmp/_verify_${r.id}_${which}.jpg`;
      const cur = spawnSync('curl', ['-s', '-o', tmp, url], { stdio: 'pipe' });
      if (cur.status !== 0) { v.verifyOk = false; v.verifyMsg = `curl exit ${cur.status} for ${url}`; continue; }
      try {
        const m = await sharp(tmp).metadata();
        const dims = `${m.width}x${m.height}`;
        if (which === 'front') v.frontDims = dims;
        else v.backDims = dims;
        if (m.height !== 4096) {
          v.verifyOk = false;
          v.verifyMsg = (v.verifyMsg || '') + `; ${which} not 4096 (got ${m.height})`;
        }
      } catch (e) {
        v.verifyOk = false;
        v.verifyMsg = (v.verifyMsg || '') + `; ${which} read err`;
      }
      try { fs.unlinkSync(tmp); } catch {}
    }
    if (v.verifyOk === undefined) v.verifyOk = true;
    out.push(v);
  }
  fs.writeFileSync('/tmp/backfill_verify.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
