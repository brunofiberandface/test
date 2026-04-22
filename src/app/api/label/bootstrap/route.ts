/**
 * POST /api/label/bootstrap
 *
 * Idempotent seed: creates the L2936-8.0 template doc if it does not already
 * exist. Uses static assets shipped in /public/label-assets:
 *   - L2936-8.0.png       → artwork / height map
 *   - leather-pebbled.png → material tile for the pebbled grain variant
 *
 * Called once by the label-setup UI on first load. Safe to call repeatedly —
 * it only writes when the doc is missing so you can edit template metadata
 * directly in Firestore after bootstrap without it getting clobbered.
 */
import { NextResponse } from 'next/server';
import { getLabelTemplate, upsertLabelTemplate } from '@/lib/firestore';
import type { LabelTemplate } from '@/types';

const SEED: Omit<LabelTemplate, 'createdAt' | 'updatedAt'> = {
  templateId: 'L2936-8.0',
  name: 'L2936-8.0 — G-Star leather back patch',
  artworkUrl: '/label-assets/L2936-8.0.png',
  materialTileUrls: {
    pebbled: '/label-assets/leather-pebbled.png',
  },
  // Width 957 / height 662 from the template PNG
  aspectRatio: 957 / 662,
};

export async function POST() {
  try {
    const existing = await getLabelTemplate(SEED.templateId);
    if (existing) {
      return NextResponse.json({
        ok: true,
        status: 'already-exists',
        templateId: SEED.templateId,
      });
    }
    await upsertLabelTemplate(SEED);
    return NextResponse.json({
      ok: true,
      status: 'created',
      templateId: SEED.templateId,
    });
  } catch (err: unknown) {
    console.error('[LabelBootstrap]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Convenience: GET also seeds. Lets Bruno hit the URL in a browser.
export const GET = POST;
