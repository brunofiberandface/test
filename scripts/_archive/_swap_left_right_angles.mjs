/**
 * One-shot swap: every existing wardrobe item has front45Left ↔ front45Right
 * (and back45Left ↔ back45Right) inverted relative to the convention now in
 * use for new uploads. Swap them in place.
 *
 * Files in GCS keep their original names — we only swap the URL VALUES inside
 * Firestore so the doc's `fitModels` map and `fitModelUrls` array index map
 * the right image to the right slot. Filenames are an implementation detail
 * and don't affect downstream pipeline behavior.
 *
 * Skipped IDs: today's two new uploads (already correct by my mapping).
 *
 * Idempotent guard: writes a marker `angleSwap202604` = true on each updated
 * doc so re-runs are no-ops. Delete the field if you want to re-run.
 */
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = 'gstar-ai-studio';
const SKIP_IDS = new Set([
  'shU8uNGorWXuyMqS8Iis', // Midge Straight 52 — uploaded today
  'PWYdwXzb61EXfjhSdulq', // Kate Boyfriend C293 62 — uploaded today
]);

const db = new Firestore({ projectId: PROJECT_ID });

const stats = { total: 0, skipped: 0, alreadyDone: 0, swapped: 0, noChange: 0 };

(async () => {
  const snap = await db.collection('wardrobe').get();
  for (const doc of snap.docs) {
    stats.total++;
    if (SKIP_IDS.has(doc.id)) {
      console.log(`[skip] ${doc.id} (in skip list — today's new upload)`);
      stats.skipped++;
      continue;
    }
    const d = doc.data();
    if (d.angleSwap202604 === true) {
      console.log(`[skip] ${doc.id} (already swapped — marker present)`);
      stats.alreadyDone++;
      continue;
    }
    const fm = d.fitModels || {};
    const hasFront = fm.front45Left || fm.front45Right;
    const hasBack = fm.back45Left || fm.back45Right;
    if (!hasFront && !hasBack) {
      stats.noChange++;
      continue;
    }
    const update = { angleSwap202604: true, updatedAt: new Date() };
    const newFm = { ...fm };
    if (fm.front45Left || fm.front45Right) {
      newFm.front45Left = fm.front45Right || '';
      newFm.front45Right = fm.front45Left || '';
    }
    if (fm.back45Left || fm.back45Right) {
      newFm.back45Left = fm.back45Right || '';
      newFm.back45Right = fm.back45Left || '';
    }
    update.fitModels = newFm;

    // Also fix fitModelUrls array order (canonical: front, front45Left, front45Right, back, back45Left, back45Right)
    if (Array.isArray(d.fitModelUrls) && d.fitModelUrls.length >= 6) {
      const u = [...d.fitModelUrls];
      // swap [1]↔[2] and [4]↔[5]
      [u[1], u[2]] = [u[2], u[1]];
      [u[4], u[5]] = [u[5], u[4]];
      update.fitModelUrls = u;
    }
    await doc.ref.update(update);
    stats.swapped++;
    console.log(`[swap] ${doc.id} (${d.name || 'unnamed'}) — front and back 45L/R swapped`);
  }
  console.log('\nDone:', JSON.stringify(stats, null, 2));
})();
