/**
 * GET /api/v2/wardrobe/[id]
 *
 * Returns the full wardrobe item — all 6 fit-model angles, both flat
 * images, the metadata block (name, designNumber, category, gender,
 * description), the v2 classification (coerced via the same defaulter
 * the list endpoint uses), and the audit fields (fitModels4K_*).
 *
 * One round-trip for the /v2/wardrobe/[id] assessment page.
 *
 * 2026-05-27 (Phase 2 Slice 2C-classify of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWardrobeItem } from '@/lib/firestore';
import { coerceClassification } from '@/lib/v2/wardrobe-classification';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const item = await getWardrobeItem(id) as any;
    if (!item) {
      return NextResponse.json({ error: 'Wardrobe item not found' }, { status: 404 });
    }

    const c = coerceClassification(item);

    return NextResponse.json({
      item: {
        wardrobeId: id,
        name: item.name || '—',
        designNumber: item.designNumber,
        category: item.category,
        gender: item.gender,
        description: item.description,

        // Images.
        flatFrontUrl: item.flatFrontUrl,
        flatBackUrl: item.flatBackUrl,
        thumbnailUrl: item.thumbnailUrl,
        fitModels: item.fitModels || {},

        // Classification (always coerced — unclassified items default to
        // NOOS so the form has a sensible starting state).
        classification: c.classification,
        drop: c.drop,
        noosBucket: c.noosBucket,
        classifiedAt: item.classifiedAt,
        classifiedBy: item.classifiedBy,
        rawClassification: item.classification, // for the UI to know whether
                                                 // this was explicitly set or
                                                 // just coerced
        // Label refs (passed through so the page can show "Labels set up").
        leatherLabelTemplateId: item.leatherLabelTemplateId,
        pocketLabelTemplateId: item.pocketLabelTemplateId,

        // 4K audit signal.
        fitModels4K_count: item.fitModels4K_count,
        fitModels4K_populatedCount: item.fitModels4K_populatedCount,
        fitModels4K_all: item.fitModels4K_all,
        fitModels4K_auditedAt: item.fitModels4K_auditedAt,

        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
  } catch (error) {
    console.error('[v2 wardrobe detail] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
