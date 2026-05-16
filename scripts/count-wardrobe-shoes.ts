/**
 * One-off: count active wardrobe shoes, used to size the Tier-2
 * (model × shoe) pre-render batch.
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

(async () => {
  const db = new Firestore();
  const snap = await db.collection('wardrobe').get();
  const shoes: Array<{ id: string; name: string; category: string; active: boolean }> = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const category = (data.category as string) || '';
    if (category === 'shoes') {
      shoes.push({
        id: d.id,
        name: (data.name as string) || '(no name)',
        category,
        active: (data.active as boolean) ?? true,
      });
    }
  }
  const activeShoes = shoes.filter(s => s.active);
  console.log(`Total shoes in wardrobe: ${shoes.length}`);
  console.log(`Active shoes: ${activeShoes.length}`);
  console.log('\nActive shoes:');
  for (const s of activeShoes) {
    console.log(`  ${s.id.padEnd(24)} | ${s.name}`);
  }
  if (shoes.length !== activeShoes.length) {
    console.log('\nInactive shoes:');
    for (const s of shoes.filter(s => !s.active)) {
      console.log(`  ${s.id.padEnd(24)} | ${s.name}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
