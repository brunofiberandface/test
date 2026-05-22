/**
 * Audit every wardrobe item's fit-model slots and write a `fitModels4K_status`
 * map to its Firestore doc indicating which slots are 4K-resolution.
 *
 * Slot is considered "4K" if its URL's HEAD content-length > 500_000 bytes
 * (proxy for 4096px-height JPEG q92, which lands at ~0.9–2.3 MB; low-res
 * 1333×2000 fit-models are ~200–300 KB).
 *
 * Schema written to each wardrobe doc:
 *   fitModels4K_status: {
 *     front: boolean,
 *     front45Left: boolean,
 *     front45Right: boolean,
 *     back: boolean,
 *     back45Left: boolean,
 *     back45Right: boolean,
 *   },
 *   fitModels4K_count: number,    // 0..6 — how many slots are 4K
 *   fitModels4K_all: boolean,     // true iff count === 6 AND all 6 slots are populated
 *   fitModels4K_auditedAt: ISO string
 *
 * Usage:
 *   npx tsx scripts/audit-fit-model-4k.ts            # audit all bottoms+tops
 *   npx tsx scripts/audit-fit-model-4k.ts <wardrobeId> [<wardrobeId> ...]
 */
import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';

const SLOT_KEYS = ['front', 'front45Left', 'front45Right', 'back', 'back45Left', 'back45Right'] as const;
type SlotKey = typeof SLOT_KEYS[number];

// 4K threshold: real 4K JPEGs from our pipeline are 0.9-2.3 MB (height 4096,
// JPEG q92 mozjpeg). The legacy ~1333×2000 fit-models are 200-400 KB. A
// short transition wave of mid-res files lands at 500-625 KB and is NOT
// what we want flagged as 4K — set the threshold above that band.
const THRESHOLD_BYTES = 800_000;

async function headSize(url: string): Promise<number | null> {
  try {
    // Cache-buster: storage.googleapis.com / Google's edge may return a stale
    // content-length for HEAD on objects that were recently overwritten.
    // Adding a unique query string forces a fresh metadata fetch from origin.
    const cleanUrl = url.split('?')[0];
    const busted = `${cleanUrl}?v=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await fetch(busted, { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return null;
    const len = r.headers.get('content-length');
    return len ? parseInt(len, 10) : null;
  } catch {
    return null;
  }
}

async function auditItem(db: Firestore, id: string): Promise<{ id: string; name: string; count: number; all: boolean; status: Record<SlotKey, boolean> }> {
  const snap = await db.collection('wardrobe').doc(id).get();
  if (!snap.exists) throw new Error(`Wardrobe ${id} not found`);
  const d = snap.data() as Record<string, unknown>;
  const fitModels = (d.fitModels || {}) as Partial<Record<SlotKey, string>>;
  const status: Record<SlotKey, boolean> = {
    front: false, front45Left: false, front45Right: false,
    back: false, back45Left: false, back45Right: false,
  };
  const populated: Record<SlotKey, boolean> = { ...status };
  for (const slot of SLOT_KEYS) {
    const url = fitModels[slot];
    if (!url) continue;
    populated[slot] = true;
    const size = await headSize(url);
    if (size !== null && size > THRESHOLD_BYTES) status[slot] = true;
  }
  const count = Object.values(status).filter(Boolean).length;
  const populatedCount = Object.values(populated).filter(Boolean).length;
  const all = count === SLOT_KEYS.length;
  await db.collection('wardrobe').doc(id).update({
    fitModels4K_status: status,
    fitModels4K_count: count,
    fitModels4K_populatedCount: populatedCount,
    fitModels4K_all: all,
    fitModels4K_auditedAt: new Date().toISOString(),
  });
  return { id, name: (d.name as string) || '(no name)', count, all, status };
}

(async () => {
  const args = process.argv.slice(2);
  const db = new Firestore();
  let ids: string[];
  if (args.length > 0) {
    ids = args;
    console.log(`Auditing ${ids.length} specific wardrobeId(s)...`);
  } else {
    // Firestore `!=` excludes docs where the field is undefined — most
    // wardrobe items don't have an `archived` field at all. Filter in code.
    const snap = await db.collection('wardrobe').get();
    ids = snap.docs
      .filter(d => {
        const data = d.data() as Record<string, unknown>;
        const cat = data.category as string;
        const archived = data.archived as boolean | undefined;
        return (cat === 'bottom' || cat === 'top') && archived !== true;
      })
      .map(d => d.id);
    console.log(`Auditing ${ids.length} bottoms+tops...`);
  }
  let allCount = 0;
  let totalCountAccum = 0;
  for (const id of ids) {
    try {
      const r = await auditItem(db, id);
      const tag = r.all ? '✅ ALL 4K' : `${r.count}/6`;
      console.log(`  ${tag.padEnd(10)} ${r.name.padEnd(40)} ${id}`);
      if (r.all) allCount++;
      totalCountAccum += r.count;
    } catch (e) {
      console.error(`  ERROR ${id}: ${(e as Error).message}`);
    }
  }
  console.log(`\nSummary: ${allCount}/${ids.length} items have all 6 slots in 4K. Avg: ${(totalCountAccum / ids.length).toFixed(1)}/6 slots per item.`);
})().catch(e => { console.error(e); process.exit(1); });
