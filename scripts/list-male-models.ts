/**
 * One-off: list all active models with gender, then print the docIds of male models.
 * Used to drive a male-only batch regen of model assets after fixing the
 * sports-bra-on-men prompt bug.
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
  const snap = await db.collection('models').where('active', '==', true).get();
  const rows: Array<{ id: string; modelId: string; gender: string }> = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    rows.push({
      id: d.id,
      modelId: (data.modelId as string) || '(none)',
      gender: (data.gender as string) || '(none)',
    });
  }
  rows.sort((a, b) => a.modelId.localeCompare(b.modelId));
  console.log('All active models:');
  for (const r of rows) {
    console.log(`  ${r.modelId.padEnd(6)} | gender=${r.gender.padEnd(10)} | docId=${r.id}`);
  }
  const males = rows.filter(r => /^m/i.test(r.gender));
  console.log(`\nMale model docIds (${males.length}):`);
  console.log(males.map(m => m.id).join(' '));
})().catch(e => { console.error(e); process.exit(1); });
