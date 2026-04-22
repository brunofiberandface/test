/**
 * Seed alternative prompts — creates Color Fidelity, Top Enforcement, and Fit Wide/Loose
 * alternatives for all shot types (M01-M05) by modifying the active base prompts.
 *
 * POST /api/prompt-vault/seed-alternatives
 * One-time use. Reads active base prompts and creates alternative versions.
 */
import { NextResponse } from 'next/server';
import { promptVaultCol, db } from '@/lib/firestore';

// ── Alternative definitions ──
// Each injects additional emphasis blocks into the base prompt's Step 2

const COLOR_FIDELITY_INJECTION = `
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
══════════════════════════════════════════════════════════════
`;

const TOP_ENFORCEMENT_INJECTION = `
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
══════════════════════════════════════════════════════════════
`;

const FIT_WIDE_LOOSE_INJECTION = `
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
══════════════════════════════════════════════════════════════
`;

const ANATOMY_FIRST_INJECTION = `[CRITICAL ANATOMY: The model is wearing {shoes_description} — these are slim-profile, compact footwear. The shoes must be shown at a slight 3/4 angle (V-stance) to avoid distortion. The overall size of the footwear must be strictly compact and naturally proportioned to match the slim build of the female model. The feet and shoes are the SMALLEST elements in the frame — never oversized, never distorted, never wider than the model's ankles.]

`;

interface AlternativeDef {
  label: string;
  injection: string;
  position?: 'top' | 'after-objective';  // 'top' = before ROLE:, default = after OBJECTIVE
  modelOverride?: string;  // Override the generation model (e.g. 'gemini-3.1-flash-image-preview')
  aspectOverride?: string; // Override aspect ratio (e.g. '3:4' instead of '9:16')
}

const ALTERNATIVES: AlternativeDef[] = [
  { label: 'Color Fidelity', injection: COLOR_FIDELITY_INJECTION },
  { label: 'Top Enforcement', injection: TOP_ENFORCEMENT_INJECTION },
  { label: 'Fit Wide/Loose', injection: FIT_WIDE_LOOSE_INJECTION },
  { label: 'Anatomy First', injection: ANATOMY_FIRST_INJECTION, position: 'top' },
  // ── Foot proportion A/B test: 2×2 matrix (model × aspect ratio) ──
  // Baseline = Pro + 9:16 (default, no alternative needed)
  { label: 'Pro 3:4', injection: '', aspectOverride: '3:4' },
  { label: 'Flash 9:16', injection: '', modelOverride: 'gemini-3.1-flash-image-preview' },
  { label: 'Flash 3:4', injection: '', modelOverride: 'gemini-3.1-flash-image-preview', aspectOverride: '3:4' },
];

export async function POST() {
  try {
    const shotTypes = ['M01', 'M02', 'M03', 'M04', 'M05'];
    const created: string[] = [];

    for (const shotType of shotTypes) {
      // Get active base prompt for this shot type
      const baseSnap = await promptVaultCol
        .where('shotType', '==', shotType)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (baseSnap.empty) {
        console.log(`[Seed] No active base prompt for ${shotType}, skipping`);
        continue;
      }

      const baseDoc = baseSnap.docs[0].data();
      const baseContent = baseDoc.content as string;

      for (const alt of ALTERNATIVES) {
        // Check if this alternative already exists
        const existingSnap = await promptVaultCol
          .where('shotType', '==', shotType)
          .where('isAlternative', '==', true)
          .where('label', '==', alt.label)
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          console.log(`[Seed] ${shotType} "${alt.label}" already exists, skipping`);
          continue;
        }

        // Inject the emphasis block into the prompt (or use base content unchanged for model-only overrides)
        let modifiedContent = baseContent;

        if (alt.injection) {
          // Find the Step 2 code block
          let step2Idx = baseContent.indexOf('## Step 2 Prompt');
          if (step2Idx === -1) step2Idx = baseContent.indexOf('## Prompt');
          if (step2Idx === -1) {
            console.log(`[Seed] ${shotType} has no Step 2 Prompt section, skipping`);
            continue;
          }

          // Find the ROLE: line inside the code block
          const roleIdx = baseContent.indexOf('ROLE:', step2Idx);
          if (roleIdx === -1) continue;

          if (alt.position === 'top') {
            // Insert BEFORE the ROLE: line — forces model to read anatomy constraints first
            modifiedContent = baseContent.substring(0, roleIdx) + alt.injection + baseContent.substring(roleIdx);
          } else {
            // Default: inject after OBJECTIVE paragraph
            const objIdx = baseContent.indexOf('OBJECTIVE:', roleIdx);
            if (objIdx === -1) continue;

            let insertPoint = baseContent.indexOf('\nTHIS IS THE SAME', objIdx);
            if (insertPoint === -1) insertPoint = baseContent.indexOf('\nMODEL IDENTITY', objIdx);
            if (insertPoint === -1) insertPoint = baseContent.indexOf('\nGARMENT', objIdx);
            if (insertPoint === -1) insertPoint = baseContent.indexOf('\n\nImage ', objIdx);
            if (insertPoint === -1) insertPoint = baseContent.indexOf('\n\n', objIdx);
            if (insertPoint === -1) {
              console.log(`[Seed] ${shotType} couldn't find insert point, skipping`);
              continue;
            }

            modifiedContent = baseContent.substring(0, insertPoint) + '\n' + alt.injection + baseContent.substring(insertPoint);
          }
        }

        // Also extract the modified generation prompt for the generationPrompt field
        const modPromptSection = modifiedContent.indexOf('## Step 2 Prompt') !== -1 ? modifiedContent.indexOf('## Step 2 Prompt') : modifiedContent.indexOf('## Prompt');
        const modStep2Start = modifiedContent.indexOf('```\nROLE:', modPromptSection);
        const modStep2End = modifiedContent.indexOf('\n```', modStep2Start + 10);
        const generationPrompt = modStep2Start !== -1 && modStep2End !== -1
          ? modifiedContent.substring(modStep2Start + 4, modStep2End).trim()
          : undefined;

        // Get latest revision for this shot type
        const revSnap = await promptVaultCol
          .where('shotType', '==', shotType)
          .orderBy('revision', 'desc')
          .limit(1)
          .get();
        const latestRev = revSnap.empty ? 0 : (revSnap.docs[0].data().revision || 0);

        // Create the alternative
        const ref = promptVaultCol.doc();
        await ref.set({
          id: ref.id,
          filename: `${shotType}_ALT_${alt.label.toUpperCase().replace(/[\s/]/g, '_')}.md`,
          shotType,
          content: modifiedContent,
          gcsUrl: '',
          uploadedBy: 'system-seed',
          revision: latestRev + 1,
          isActive: false,
          isAlternative: true,
          label: alt.label,
          ...(generationPrompt ? { generationPrompt } : {}),
          ...(alt.modelOverride ? { modelOverride: alt.modelOverride } : {}),
          ...(alt.aspectOverride ? { aspectOverride: alt.aspectOverride } : {}),
          uploadedAt: new Date(),
        });

        created.push(`${shotType}: ${alt.label}`);
        console.log(`[Seed] Created ${shotType} "${alt.label}" (rev ${latestRev + 1})`);
      }
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      alternatives: created,
    });
  } catch (error) {
    console.error('[Seed] Error:', error);
    return NextResponse.json(
      { error: 'Seeding failed', details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/prompt-vault/seed-alternatives?labels=Smaller+Feet,Telephoto+Fix,v1+Proportions
// Removes named alternatives from Firestore.
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const labelsParam = url.searchParams.get('labels');
    const labels = labelsParam ? labelsParam.split(',').map(l => l.trim()) : [];
    if (labels.length === 0) {
      return NextResponse.json({ error: 'Provide ?labels=Label1,Label2' }, { status: 400 });
    }

    const deleted: string[] = [];
    for (const label of labels) {
      const snap = await promptVaultCol
        .where('isAlternative', '==', true)
        .where('label', '==', label)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data();
        await doc.ref.delete();
        deleted.push(`${data.shotType}: ${label}`);
        console.log(`[Seed] Deleted ${data.shotType} "${label}"`);
      }
    }

    return NextResponse.json({ success: true, deleted: deleted.length, items: deleted });
  } catch (error) {
    console.error('[Seed] Delete error:', error);
    return NextResponse.json({ error: 'Delete failed', details: String(error) }, { status: 500 });
  }
}
