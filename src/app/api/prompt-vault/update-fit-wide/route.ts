/**
 * One-time: regenerate ALL alternative prompts from current base prompts
 * with the latest injection blocks. Deletes existing alternatives and re-seeds.
 *
 * POST /api/prompt-vault/update-fit-wide
 * (kept the URL for backward compat but it updates all alternatives now)
 */
import { NextResponse } from 'next/server';
import { promptVaultCol, db } from '@/lib/firestore';

const COLOR_INJECTION = `
══════════════════════════════════════════════════════════════
COLOR CORRECTION NOTE
══════════════════════════════════════════════════════════════
The previous generation had slight color drift on the pants.
Correct the color while keeping ALL other garment details identical.

COLOR RULES (apply ONLY to the pants color — everything else stays the same):
1. Match the exact color shown in Image 1 and Images 2-5. No brightening, darkening, warming, or cooling.
2. If the garment is dark raw indigo, it stays dark raw indigo. No blue/grey/purple shift.
3. Reproduce any wash patterns (fading, whiskering) exactly as shown in the reference images.
4. The color should be consistent across the entire garment unless the references show intentional variation.

CRITICAL: This is a color-only correction. All garment construction details — seams, pockets, rivets, fly stitching, belt loops, yoke panels — must be reproduced exactly from the reference images. Do not change the fit, silhouette, or any structural detail. The focus garment (pants) is the hero — reproduce every detail faithfully, just fix the color.
══════════════════════════════════════════════════════════════`;

const TOP_INJECTION = `
══════════════════════════════════════════════════════════════
TOP/SHIRT CORRECTION NOTE
══════════════════════════════════════════════════════════════
The previous generation had issues with the top garment (wrong color, fit, or length).
Correct the top while keeping the PANTS (focus garment) exactly the same.

TOP RULES (apply ONLY to the top — pants must not change):
1. Match the top shown in the Top Reference image — color, fit, length, and fabric.
2. If the top is cropped, it stays cropped. If oversized, it stays oversized. If tucked, it stays tucked.
3. The top color must match the reference image exactly — no shifting between front/sides/back.
4. For cropped shots: only the natural amount of the top should be visible at the top of the frame.

CRITICAL: The pants are the hero garment and must not be affected by this correction. Every seam, pocket, rivet, and construction detail on the pants must be reproduced exactly from the reference images. Do not change the pants color, fit, silhouette, or any structural detail. Only the top changes.
══════════════════════════════════════════════════════════════`;

const FIT_INJECTION = `
══════════════════════════════════════════════════════════════
FIT FIDELITY NOTE: WIDER THAN DEFAULT
══════════════════════════════════════════════════════════════
The previous generation made the pants slimmer than they actually are.
This garment has a wide, loose, or relaxed fit. Correct the width while
keeping ALL garment details (seams, pockets, construction, color) intact.

WIDTH CORRECTION RULES:
1. TRUST the silhouette analysis completely — it describes the actual garment width. Do NOT slim it down.
2. Study the flat lay and fit model reference images (Images 2-5) carefully. The WIDTH RATIO between leg and body visible in those images is the ground truth. Reproduce that same ratio.
3. There should be visible air/space between the model's leg and the denim fabric from thigh to ankle — the fabric should not cling to the leg.
4. The hem opening should match the reference images — for wide fits this is typically as wide as or wider than the shoe.
5. The fabric should show natural drape and gentle folds from the looser fit.

CRITICAL: Garment fidelity comes first. Every seam, pocket, rivet, and construction detail from the reference images must still be reproduced exactly. The only change is the WIDTH — make it faithful to the actual garment rather than defaulting to a slimmer silhouette.
══════════════════════════════════════════════════════════════`;

const ALTERNATIVES = [
  { label: 'Color Fidelity', injection: COLOR_INJECTION },
  { label: 'Top Enforcement', injection: TOP_INJECTION },
  { label: 'Fit Wide/Loose', injection: FIT_INJECTION },
];

export async function POST() {
  try {
    const shotTypes = ['M01', 'M02', 'M03', 'M04', 'M05'];
    const results: string[] = [];

    // Step 1: Delete all existing alternatives
    const altSnap = await promptVaultCol.where('isAlternative', '==', true).get();
    if (!altSnap.empty) {
      const deleteBatch = db.batch();
      altSnap.docs.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
      results.push(`Deleted ${altSnap.size} old alternatives`);
    }

    // Step 2: Re-create from current base prompts with new injection blocks
    for (const shotType of shotTypes) {
      const baseSnap = await promptVaultCol
        .where('shotType', '==', shotType)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (baseSnap.empty) continue;
      const baseContent = baseSnap.docs[0].data().content as string;

      // Find insert point
      let step2Idx = baseContent.indexOf('## Step 2 Prompt');
      if (step2Idx === -1) step2Idx = baseContent.indexOf('## Prompt');
      if (step2Idx === -1) continue;

      const roleIdx = baseContent.indexOf('ROLE:', step2Idx);
      if (roleIdx === -1) continue;

      const objIdx = baseContent.indexOf('OBJECTIVE:', roleIdx);
      if (objIdx === -1) continue;

      let insertPoint = baseContent.indexOf('\nTHIS IS THE SAME', objIdx);
      if (insertPoint === -1) insertPoint = baseContent.indexOf('\nMODEL IDENTITY', objIdx);
      if (insertPoint === -1) insertPoint = baseContent.indexOf('\nGARMENT', objIdx);
      if (insertPoint === -1) insertPoint = baseContent.indexOf('\n\nImage ', objIdx);
      if (insertPoint === -1) insertPoint = baseContent.indexOf('\n\n', objIdx);
      if (insertPoint === -1) continue;

      // Get latest revision
      const revSnap = await promptVaultCol
        .where('shotType', '==', shotType)
        .orderBy('revision', 'desc')
        .limit(1)
        .get();
      let nextRev = revSnap.empty ? 1 : (revSnap.docs[0].data().revision || 0) + 1;

      for (const alt of ALTERNATIVES) {
        const modifiedContent = baseContent.substring(0, insertPoint) + '\n' + alt.injection + baseContent.substring(insertPoint);

        // Extract generation prompt
        const modPromptSection = modifiedContent.indexOf('## Step 2 Prompt') !== -1
          ? modifiedContent.indexOf('## Step 2 Prompt')
          : modifiedContent.indexOf('## Prompt');
        const modStep2Start = modifiedContent.indexOf('```\nROLE:', modPromptSection);
        const modStep2End = modifiedContent.indexOf('\n```', modStep2Start + 10);
        const generationPrompt = modStep2Start !== -1 && modStep2End !== -1
          ? modifiedContent.substring(modStep2Start + 4, modStep2End).trim()
          : undefined;

        const ref = promptVaultCol.doc();
        await ref.set({
          id: ref.id,
          filename: `${shotType}_ALT_${alt.label.toUpperCase().replace(/[\s/]/g, '_')}.md`,
          shotType,
          content: modifiedContent,
          gcsUrl: '',
          uploadedBy: 'system-seed-v2',
          revision: nextRev++,
          isActive: false,
          isAlternative: true,
          label: alt.label,
          ...(generationPrompt ? { generationPrompt } : {}),
          uploadedAt: new Date(),
        });

        results.push(`${shotType}: ${alt.label}`);
      }
    }

    return NextResponse.json({ success: true, created: results.length, changes: results });
  } catch (error) {
    console.error('[UpdateAlternatives] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
