/**
 * Build a single HTML audit page showing all wardrobe items' 6 fit-model
 * angles side-by-side. Lets Bruno scan the whole wardrobe for slot
 * mismatches (e.g. back45Left and back45Right showing the same image,
 * front slot showing a 45° angle, etc).
 *
 * Reads wardrobe.fitModels map from Firestore (the URLs the app actually
 * loads — same source of truth used by matrix-paint). For each URL, also
 * fetches the content-length so the page can flag 4K vs not-4K.
 *
 * Output: test_outputs/fitmodel-audit.html — open in a browser.
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

const SLOT_ORDER = ['front45Left', 'front', 'front45Right', 'back45Left', 'back', 'back45Right'] as const;
const SLOT_LABELS: Record<typeof SLOT_ORDER[number], string> = {
  front45Left: 'Front 45° L',
  front: 'Front',
  front45Right: 'Front 45° R',
  back45Left: 'Back 45° L',
  back: 'Back',
  back45Right: 'Back 45° R',
};

const OUT_PATH = path.join(projectRoot, 'test_outputs/fitmodel-audit.html');

interface SlotInfo {
  url: string | null;
  bytes: number;
  is4k: boolean; // > 800KB heuristic
}
interface ItemInfo {
  wardrobeId: string;
  name: string;
  designNumber: string;
  category: string;
  slots: Record<string, SlotInfo>;
  num4k: number;
}

async function getContentLength(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return 0;
    return parseInt(r.headers.get('content-length') || '0', 10);
  } catch {
    return 0;
  }
}

async function main() {
  const sa = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key } });

  const snap = await db.collection('wardrobe').get();
  console.log(`Wardrobe (${snap.size} docs)`);

  const items: ItemInfo[] = [];
  let i = 0;
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const cat = String(data.category || '');
    if (cat !== 'bottom' && cat !== 'top') continue;
    if (data.archived) continue;

    const fm = (data.fitModels || {}) as Record<string, string>;
    const slots: Record<string, SlotInfo> = {};
    let num4k = 0;
    for (const slot of SLOT_ORDER) {
      const url = (fm[slot] || '').split('?')[0] || null;
      if (url) {
        const bytes = await getContentLength(url);
        const is4k = bytes > 800_000;
        slots[slot] = { url, bytes, is4k };
        if (is4k) num4k++;
      } else {
        slots[slot] = { url: null, bytes: 0, is4k: false };
      }
    }

    items.push({
      wardrobeId: d.id,
      name: String(data.name || ''),
      designNumber: String(data.designNumber || ''),
      category: cat,
      slots,
      num4k,
    });
    i++;
    if (i % 5 === 0) console.log(`  audited ${i} items…`);
  }

  // Sort: tops first, then bottoms by name
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  // Build HTML
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fit-model Audit</title>
<style>
  body { font: 12px sans-serif; background: #1a1a1a; color: #eee; margin: 0; padding: 16px; }
  h1 { margin: 0 0 16px; font-size: 18px; }
  .summary { background: #2a2a2a; padding: 12px; margin-bottom: 16px; border-radius: 6px; }
  .item { display: grid; grid-template-columns: 220px repeat(6, 1fr); gap: 4px; margin-bottom: 12px; padding: 8px; background: #222; border-radius: 4px; }
  .item-info { padding-right: 8px; }
  .item-info .name { font-weight: bold; font-size: 13px; margin-bottom: 4px; }
  .item-info .meta { color: #888; font-size: 11px; }
  .slot { position: relative; aspect-ratio: 0.67; background: #111; border-radius: 4px; overflow: hidden; }
  .slot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .slot.empty { background: #333; display: flex; align-items: center; justify-content: center; color: #666; font-size: 10px; }
  .slot .label { position: absolute; bottom: 0; left: 0; right: 0; padding: 3px 4px; font-size: 10px; background: rgba(0,0,0,0.7); }
  .slot .size { position: absolute; top: 0; right: 0; padding: 2px 4px; font-size: 9px; background: rgba(0,0,0,0.7); }
  .slot.k4 .size { background: rgba(40, 100, 40, 0.9); }
  .slot.k2 .size { background: rgba(120, 60, 0, 0.9); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; margin-right: 4px; }
  .badge.k4 { background: #285028; }
  .badge.k2 { background: #5a3000; }
  .nav { font-size: 12px; }
  .nav a { color: #6cf; text-decoration: none; margin-right: 8px; }
</style></head><body>
<h1>Fit-model Angle Audit (${items.length} wardrobe items)</h1>
<div class="summary">
  <p><strong>Scan for mismatches:</strong> in each row the 6 thumbs should be visually distinct.
  Watch for: (a) two slots showing the same image, (b) "Front" actually showing a 45° angle,
  (c) Back 45° L and Back 45° R reversed or duplicated.</p>
  <p>Green badge = 4K (>800KB), orange = sub-4K. Click a thumb to open full-resolution.</p>
  <div class="nav">Jump: ${['bottom', 'top'].map(c => `<a href="#cat-${c}">${c}s</a>`).join('')}</div>
</div>

${(() => {
  let html = '';
  let lastCat = '';
  for (const it of items) {
    if (it.category !== lastCat) {
      html += `<h2 id="cat-${it.category}" style="margin: 24px 0 8px; padding-top: 12px; border-top: 1px solid #444;">${it.category.toUpperCase()}S</h2>`;
      lastCat = it.category;
    }
    const slotsHtml = SLOT_ORDER.map(slot => {
      const s = it.slots[slot];
      if (!s.url) return `<div class="slot empty"><span>${SLOT_LABELS[slot]}<br>(missing)</span></div>`;
      const cls = s.is4k ? 'k4' : 'k2';
      const sizeKB = (s.bytes / 1024).toFixed(0);
      return `<a href="${s.url}" target="_blank"><div class="slot ${cls}">
        <img src="${s.url}" loading="lazy" alt="${SLOT_LABELS[slot]}">
        <span class="size">${sizeKB}KB</span>
        <span class="label">${SLOT_LABELS[slot]}</span>
      </div></a>`;
    }).join('');
    html += `<div class="item">
      <div class="item-info">
        <div class="name">${it.name}</div>
        <div class="meta">${it.designNumber}</div>
        <div class="meta">${it.wardrobeId}</div>
        <div class="meta" style="margin-top: 4px;">
          <span class="badge ${it.num4k === 6 ? 'k4' : 'k2'}">${it.num4k}/6 at 4K</span>
        </div>
      </div>
      ${slotsHtml}
    </div>`;
  }
  return html;
})()}
</body></html>`;

  fs.writeFileSync(OUT_PATH, html);
  console.log(`\n✓ Wrote audit page: ${OUT_PATH}`);
  console.log(`  Open with: open "${OUT_PATH}"`);
  console.log(`\nSummary: ${items.length} items audited`);
  const fullyDone = items.filter(it => it.num4k === 6).length;
  const partiallyDone = items.filter(it => it.num4k > 0 && it.num4k < 6).length;
  const notDone = items.filter(it => it.num4k === 0).length;
  console.log(`  ${fullyDone} fully at 4K (6/6)`);
  console.log(`  ${partiallyDone} partially at 4K`);
  console.log(`  ${notDone} not backfilled`);
}
main().catch(e => { console.error(e); process.exit(1); });
