/**
 * Dual-item verification of the fitHint fix.
 *
 * Runs Flash Lite silhouette analysis TWICE per item:
 *   1. WITHOUT fitHint (baseline — what production did before our fix)
 *   2. WITH fitHint    (new — product description as ground-truth anchor)
 *
 * Tests both Kate Boyfriend and Contor 3D Extreme Loose so we see the
 * anchor works across different non-skinny fits.
 *
 * No deploy, no production state touched. Cost ~$0.008 total.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';
import { analyzeSilhouette } from '../src/lib/pipeline/silhouette';
import { downloadGarmentImage } from '../src/lib/gcs';
import { normalizeWardrobeItem } from '../src/lib/wardrobe-compat';

const ITEMS = [
  { id: 'OnOe3MaP00xavnoRtNN7', label: 'KATE BOYFRIEND' },
  { id: 'YgYlPXyfF75wJNVdbtKK', label: 'CONTOR 3D EXTREME LOOSE' },
];

function divider(t: string) { console.log('\n' + '═'.repeat(80) + '\n' + t + '\n' + '═'.repeat(80)); }
function subdivider(t: string) { console.log('\n' + '─'.repeat(80) + '\n' + t + '\n' + '─'.repeat(80)); }

const grabCategory = (txt: string | undefined): string => {
  if (!txt) return '(none)';
  const m = txt.match(/FIT CATEGORY[^\n]{0,300}/i);
  return m ? m[0].replace(/\*\*/g, '').trim() : '(no FIT CATEGORY line — first 200 chars: ' + txt.slice(0, 200) + ')';
};

async function runForItem(db: FirebaseFirestore.Firestore, id: string, label: string) {
  divider(`${label}  (${id})`);

  const snap = await db.collection('wardrobe').doc(id).get();
  if (!snap.exists) { console.log('not found'); return; }
  const raw = snap.data() as any;
  const item = normalizeWardrobeItem(raw);
  if (!item) { console.log('normalize returned null'); return; }

  console.log('name:        ', raw.name);
  console.log('description: ', raw.description?.slice(0, 160) + (raw.description?.length > 160 ? '…' : ''));

  const fitHint = [
    raw?.name,
    raw?.description,
    (raw as any)?.fitDescription,
    (raw as any)?.metadata?.fitDescription,
  ].filter(Boolean).join(' — ');

  const fm = item.fitModels!;
  const stripQ = (u: string) => u.split('?')[0];

  const [flatFront, flatBack, frontBuf, front45L, front45R, backBuf, back45L, back45R] =
    await Promise.all([
      downloadGarmentImage(stripQ(item.flatFrontUrl!)),
      item.flatBackUrl ? downloadGarmentImage(stripQ(item.flatBackUrl)) : Promise.resolve(null),
      downloadGarmentImage(stripQ(fm.front)),
      downloadGarmentImage(stripQ(fm.front45Left)),
      downloadGarmentImage(stripQ(fm.front45Right)),
      downloadGarmentImage(stripQ(fm.back)),
      downloadGarmentImage(stripQ(fm.back45Left)),
      downloadGarmentImage(stripQ(fm.back45Right)),
    ]);

  // Two runs in parallel: with and without fitHint
  subdivider('running silhouette x2 (baseline + with-fitHint)');
  const t0 = Date.now();
  const [baseline, withHint] = await Promise.all([
    analyzeSilhouette({
      flatFront, flatBack,
      frontAngles: [frontBuf, front45L, front45R],
      backAngles: [backBuf, back45L, back45R],
    }),
    analyzeSilhouette({
      flatFront, flatBack,
      frontAngles: [frontBuf, front45L, front45R],
      backAngles: [backBuf, back45L, back45R],
      fitHint,
    }),
  ]);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  subdivider('FIT CATEGORY comparison');
  console.log('BASELINE front  :', grabCategory(baseline.front));
  console.log('WITH HINT front :', grabCategory(withHint.front));
  console.log('BASELINE back   :', grabCategory(baseline.back));
  console.log('WITH HINT back  :', grabCategory(withHint.back));
}

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  for (const it of ITEMS) {
    try { await runForItem(db, it.id, it.label); }
    catch (e) { console.error(`FAILED for ${it.label}:`, e); }
  }

  console.log('\nDone. No production state touched.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
