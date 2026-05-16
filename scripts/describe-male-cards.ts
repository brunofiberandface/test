/**
 * Use Gemini text-only to DESCRIBE what M15/M16/M21 (the persistent-bra
 * males) actually wear in their model card photos. If their cards show
 * dark tops with straps, that's the source of the bra hallucination — the
 * AI is reading IMAGE 1's clothing as identity and reproducing the strap
 * shapes despite the bare-chest prompt.
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
import { analyzeWithFlashLite } from '../src/lib/vertex';

async function fetchBuf(url: string): Promise<Buffer> {
  const r = await fetch(url.split('?')[0]);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const db = new Firestore();
  const ids = ['M2', 'M15', 'M16', 'M21', 'M1'];
  for (const id of ids) {
    const snap = await db.collection('models').doc(id).get();
    const d = snap.data() as Record<string, string>;
    const url = d.referenceImageUrl || d.cardImageUrl;
    if (!url) { console.log(`${id}: NO URL`); continue; }
    console.log(`\n══ ${id} (${url.split('/').pop()?.split('?')[0]}) ══`);
    try {
      const buf = await fetchBuf(url);
      const result = await analyzeWithFlashLite({
        prompt: 'In one sentence, describe ONLY the clothing visible on this person from neck to navel. Be specific about: top garment (shirt/tank/bare chest/etc), colour, neckline shape, strap visibility (any shoulder straps?), and any contrast/dark bands across the chest.',
        images: [{ buffer: buf, mimeType: 'image/jpeg' }],
      });
      console.log(`  ${result.trim()}`);
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
