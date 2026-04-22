/**
 * Read-only: find Kate Boyfriend + Contor 3D wardrobe items and
 * compare their fit-relevant fields side-by-side.
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

function divider(t: string) { console.log('\n' + '═'.repeat(80) + '\n' + t + '\n' + '═'.repeat(80)); }

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  // Pull all wardrobe items, filter in code (avoids index needs)
  const all = await db.collection('wardrobe').get();
  const items: any[] = [];
  all.forEach((d) => items.push({ id: d.id, ...d.data() }));

  const matches = items.filter((it) => {
    const hay = `${it.name || ''} ${it.description || ''} ${it.designNumber || ''}`.toLowerCase();
    return hay.includes('kate') || hay.includes('contor') || hay.includes('3d');
  });

  divider(`Found ${matches.length} candidate items (kate/contor/3d)`);
  for (const it of matches) {
    console.log(`• ${it.id}  ${it.name}  (category=${it.category || '—'})`);
  }

  const show = (label: string, it: any) => {
    divider(label + ` — ${it.id}`);
    console.log('name:           ', it.name);
    console.log('designNumber:   ', it.designNumber || '(none)');
    console.log('category:       ', it.category);
    console.log('description:    ', it.description || '(none)');
    console.log('fitDescription: ', (it as any).fitDescription || '(none)');
    console.log('metadata.fit:   ', it.metadata?.fitDescription || '(none)');
    console.log('flatFrontUrl:   ', it.flatFrontUrl ? 'set' : '(none)');
    console.log('flatBackUrl:    ', it.flatBackUrl ? 'set' : '(none)');
    console.log('fitModelUrls:   ', it.fitModelUrls ? Object.keys(it.fitModelUrls) : '(none)');
    console.log('fitModels:      ', it.fitModels ? Object.keys(it.fitModels) : '(none)');
    console.log('updatedAt:      ', it.updatedAt?.toDate?.() || it.updatedAt || '(none)');
    console.log('all top-level keys:', Object.keys(it).sort());
  };

  const kate = matches.find((m) => /kate/i.test(m.name || ''));
  const contor = matches.find((m) => /contor/i.test(m.name || ''));

  if (kate) show('KATE BOYFRIEND', kate);
  else console.log('\n(Kate not found)');

  if (contor) show('CONTOR 3D', contor);
  else console.log('\n(Contor 3D not found — showing all matches above)');
}

main().catch((e) => { console.error(e); process.exit(1); });
