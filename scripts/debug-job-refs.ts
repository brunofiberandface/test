/**
 * Debug: print the actual URLs that the predressed pipeline test pulled
 * for a job's wardrobe items. Use this to confirm we're feeding the right
 * Bowey Barrel jeans references to Seedream.
 *
 * Usage: npx tsx scripts/debug-job-refs.ts <jobId>
 */
import * as fs from 'fs';
import * as path from 'path';

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

const jobId = process.argv[2];
if (!jobId) { console.error('Usage: npx tsx scripts/debug-job-refs.ts <jobId>'); process.exit(1); }

async function main() {
  const db = new Firestore();
  const jobSnap = await db.collection('jobs').doc(jobId).get();
  if (!jobSnap.exists) { console.error(`Job ${jobId} not found`); process.exit(1); }
  const job = jobSnap.data() as { wardrobe: Record<string, { itemId: string; isFocus?: boolean }>; modelId: string };

  console.log(`Job ${jobId}`);
  console.log(`Model: ${job.modelId}`);
  console.log('');

  for (const [slot, cfg] of Object.entries(job.wardrobe)) {
    if (!cfg.itemId) continue;
    console.log(`── ${slot.toUpperCase()} (itemId: ${cfg.itemId}, focus=${cfg.isFocus || false}) ──`);
    const itemSnap = await db.collection('wardrobe').doc(cfg.itemId).get();
    if (!itemSnap.exists) { console.log(`  ✗ NOT FOUND in wardrobe collection`); continue; }
    const item = itemSnap.data() as {
      name?: string;
      designNumber?: string;
      flatFrontUrl?: string;
      flatBackUrl?: string;
      fitModels?: Record<string, string>;
      fitModelUrls?: string[];
      thumbnailUrl?: string;
    };
    console.log(`  name: ${item.name}`);
    console.log(`  designNumber: ${item.designNumber || '(none)'}`);
    console.log(`  flatFrontUrl: ${item.flatFrontUrl || '(none)'}`);
    console.log(`  flatBackUrl: ${item.flatBackUrl || '(none)'}`);
    console.log(`  thumbnailUrl: ${item.thumbnailUrl || '(none)'}`);
    if (item.fitModels) {
      console.log(`  fitModels (v2):`);
      for (const [k, v] of Object.entries(item.fitModels)) {
        console.log(`    ${k}: ${v}`);
      }
    } else {
      console.log(`  fitModels: (none — v1 only)`);
    }
    if (item.fitModelUrls?.length) {
      console.log(`  fitModelUrls (v1 legacy, ${item.fitModelUrls.length}):`);
      item.fitModelUrls.forEach((u, i) => console.log(`    [${i}]: ${u}`));
    }
    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
