/**
 * One-off: fix the polluted topDescription on item #184 (Flowy Slim Mock T-Shirt).
 *
 * Before: "Solid blush-pink sleeveless mock-neck fitted cropped top in smooth
 *          stretch fabric with a center-front vertical seam, horizontal bust-line
 *          seam, snap closure at back neck, and small metallic logo tag at
 *          lower right hem."
 *   (Wrong color, wrong material — actual garment is ecru/off-white suede-effect
 *    microfibre. This stale topDescription is what produced the pink M01/M02
 *    renders in the PDF.)
 *
 * After: corrected color (off-white/ecru) + correct fabric (suede-effect microfibre
 *        matte) + same structural enumeration the old text had, since that part was
 *        well-formed.
 *
 * Item id: drzaHkB6mM40uHeKWzsU (top, #184).
 *
 * Per Bruno's call (Option A): fix the data, don't change the lookup chain.
 * Audit follow-up runs in parallel to count whether more items are polluted.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';

const projectRoot = path.resolve(__dirname, '..');
const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));

const ITEM_ID = 'drzaHkB6mM40uHeKWzsU';
const NEW_TOP_DESCRIPTION =
  'Solid off-white / ecru sleeveless mock-neck cropped top in smooth suede-effect microfibre fabric with a subtle matte finish, a center-front vertical panel seam, a horizontal bust-line seam (four-panel construction), a small back-neck snap closure, and a small metallic logo tag at lower right hem.';

async function main() {
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const ref = db.collection('wardrobe').doc(ITEM_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`item ${ITEM_ID} not found`);
  const data = snap.data() || {};
  const before = data.topDescription as string;
  console.log(`Item: ${data.name}`);
  console.log(`Before: ${before.slice(0, 100)}…`);
  console.log(`After:  ${NEW_TOP_DESCRIPTION.slice(0, 100)}…`);

  await ref.update({
    topDescription: NEW_TOP_DESCRIPTION,
    topDescriptionPreviousBlushpink_2026may24: before, // archive the old polluted value
    topDescriptionUpdatedAt: new Date(),
  });
  console.log(`✓ Updated. Old value archived to topDescriptionPreviousBlushpink_2026may24.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
