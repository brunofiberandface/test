/**
 * Read-only: inspect what silhouette data (if any) is cached on the Kate
 * Boyfriend job, and whether the item actually has fit model images
 * anywhere in its document (not just fitModels).
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

const JOB_ID = 'E9RZzfNp2aUeqKUtnFBg';
const ITEM_ID = 'OnOe3MaP00xavnoRtNN7';

function divider(t: string) { console.log('\n' + '═'.repeat(80) + '\n' + t + '\n' + '═'.repeat(80)); }

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  divider('JOB — silhouette fields');
  const js = await db.collection('jobs').doc(JOB_ID).get();
  const j = js.data() as any;
  console.log('status:', j.status);
  console.log('has silhouetteAnalysis:', !!j.silhouetteAnalysis);
  if (j.silhouetteAnalysis) {
    console.log('  front length:', (j.silhouetteAnalysis.front || '').length);
    console.log('  back  length:', (j.silhouetteAnalysis.back || '').length);
    console.log('  front preview:', (j.silhouetteAnalysis.front || '').slice(0, 400));
    console.log('  back  preview:', (j.silhouetteAnalysis.back || '').slice(0, 400));
  }
  console.log('silhouetteError:', j.silhouetteError || '(none)');

  divider('WARDROBE ITEM — all top-level keys');
  const is = await db.collection('wardrobe').doc(ITEM_ID).get();
  const it = is.data() as any;
  console.log(Object.keys(it).sort());

  divider('WARDROBE ITEM — image-related fields');
  const keys = Object.keys(it);
  for (const k of keys) {
    const v = (it as any)[k];
    if (typeof v === 'string' && /https?:\/\//.test(v)) {
      console.log(`  ${k}: url set (${v.slice(0, 80)}...)`);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      // one level deep — show any url-like string children
      for (const k2 of Object.keys(v)) {
        const v2 = (v as any)[k2];
        if (typeof v2 === 'string' && /https?:\/\//.test(v2)) {
          console.log(`  ${k}.${k2}: url set (${v2.slice(0, 80)}...)`);
        }
      }
    }
  }

  divider('fitModels detail');
  console.log('fitModels:', JSON.stringify(it.fitModels, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
