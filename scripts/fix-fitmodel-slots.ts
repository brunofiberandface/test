/**
 * Fix mismatched fit-model slot assignments in a wardrobe doc.
 *
 * When the parallel backfill task mis-mapped a 45° angle to a canonical
 * slot (or canonical to a 45°), this swaps slot URLs in Firestore without
 * touching the GCS files. Wardrobe doc fitModels.{slot} URLs get re-pointed
 * to the correct files.
 *
 * Use case: Bruno identifies on the audit page that, e.g., CONTOR's `back`
 * slot is showing a back-45° image, and the canonical back is actually in
 * the `back45Left` slot. He swaps them with one command.
 *
 * Usage:
 *   npx tsx scripts/fix-fitmodel-slots.ts <wardrobeId> --back-is <correctSlot> [--front-is <correctSlot>]
 *
 * <correctSlot> is the CURRENT slot key that actually contains the right image:
 *   front, front45Left, front45Right, back, back45Left, back45Right
 *
 * Example (CONTOR's `back` slot currently has a 45° image; the true canonical
 * back is currently in back45Left):
 *   npx tsx scripts/fix-fitmodel-slots.ts ZB2GMhoH1hQDjdJQbD6d --back-is back45Left
 *
 * What it does:
 *   - Read current wardrobe.fitModels map
 *   - Swap fitModels.back ↔ fitModels.back45Left URLs (if --back-is back45Left)
 *   - Same for --front-is if provided
 *   - Write updated doc
 *   - URL swap only — no file uploads, no GCS changes
 *
 * After running, re-check the audit page — the swapped slots should now
 * show the correct images.
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

type SlotKey = 'front' | 'front45Left' | 'front45Right' | 'back' | 'back45Left' | 'back45Right';
const ALL_SLOTS: SlotKey[] = ['front', 'front45Left', 'front45Right', 'back', 'back45Left', 'back45Right'];

function parseArgs(argv: string[]): { wardrobeId: string; backIs?: SlotKey; frontIs?: SlotKey; dry: boolean } {
  let wardrobeId = '';
  let backIs: SlotKey | undefined;
  let frontIs: SlotKey | undefined;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--back-is') backIs = argv[++i] as SlotKey;
    else if (a === '--front-is') frontIs = argv[++i] as SlotKey;
    else if (a === '--dry') dry = true;
    else if (!wardrobeId) wardrobeId = a;
  }
  if (!wardrobeId) throw new Error('wardrobeId required');
  if (!backIs && !frontIs) throw new Error('At least one of --back-is or --front-is required');
  for (const slot of [backIs, frontIs].filter(Boolean) as SlotKey[]) {
    if (!ALL_SLOTS.includes(slot)) throw new Error(`Invalid slot: ${slot}. Must be one of: ${ALL_SLOTS.join(', ')}`);
  }
  return { wardrobeId, backIs, frontIs, dry };
}

async function main() {
  const { wardrobeId, backIs, frontIs, dry } = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${dry ? 'DRY RUN' : 'LIVE UPDATE'}`);
  console.log(`Wardrobe: ${wardrobeId}`);
  if (backIs) console.log(`  Swap: fitModels.back ↔ fitModels.${backIs}`);
  if (frontIs) console.log(`  Swap: fitModels.front ↔ fitModels.${frontIs}`);

  const sa = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
  const ref = db.collection('wardrobe').doc(wardrobeId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Wardrobe ${wardrobeId} not found`);

  const data = snap.data() as Record<string, unknown>;
  const fm = { ...((data.fitModels || {}) as Record<string, string>) };
  console.log(`\nBefore:`);
  for (const slot of ALL_SLOTS) {
    const fname = (fm[slot] || '').split('/').pop()?.split('?')[0] || '(none)';
    console.log(`  ${slot.padEnd(13)}: ${fname}`);
  }

  // Apply swaps
  if (backIs && backIs !== 'back') {
    const oldBack = fm.back;
    fm.back = fm[backIs];
    fm[backIs] = oldBack;
  }
  if (frontIs && frontIs !== 'front') {
    const oldFront = fm.front;
    fm.front = fm[frontIs];
    fm[frontIs] = oldFront;
  }

  console.log(`\nAfter:`);
  for (const slot of ALL_SLOTS) {
    const fname = (fm[slot] || '').split('/').pop()?.split('?')[0] || '(none)';
    console.log(`  ${slot.padEnd(13)}: ${fname}`);
  }

  if (dry) {
    console.log(`\nDRY RUN — no Firestore writes performed.`);
    return;
  }

  await ref.update({ fitModels: fm, updatedAt: new Date() });
  console.log(`\n✓ Updated wardrobe ${wardrobeId}.fitModels`);
}
main().catch(e => { console.error(e); process.exit(1); });
