/**
 * One-off: list all non-archived wardrobe items where category ∈ {bottom, top}
 * with fields needed to drive the 4K fit-model backfill:
 *   wardrobeId, name, designNumber, category, fitModels.front, fitModels.back
 *
 * Output: JSON array to stdout.
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
  const rows: Array<{
    id: string;
    name: string;
    designNumber: string;
    category: string;
    archived: boolean;
    frontUrl: string | null;
    backUrl: string | null;
  }> = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const category = (data.category as string) || '';
    const archived = data.archived === true;
    if (archived) continue;
    if (category !== 'bottom' && category !== 'top') continue;
    const fitModels = (data.fitModels as Record<string, unknown>) || {};
    rows.push({
      id: d.id,
      name: (data.name as string) || '',
      designNumber: (data.designNumber as string) || '',
      category,
      archived,
      frontUrl: (fitModels.front as string) || null,
      backUrl: (fitModels.back as string) || null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  console.log(JSON.stringify(rows, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
