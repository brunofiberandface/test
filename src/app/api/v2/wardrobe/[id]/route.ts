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
import { getWardrobeItem, wardrobeCol } from '@/lib/firestore';
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

/**
 * PATCH /api/v2/wardrobe/[id]
 *
 * Partial update of the editable metadata fields: name, designNumber,
 * category, gender, description. Image / fit-angle / label flows are
 * NOT modified here — those still go through the dedicated Classic
 * tools (/wardrobe/[id]/angle-setup, /label-setup).
 *
 * Body: any subset of { name, designNumber, category, gender, description }.
 * Unset fields are ignored. Empty-string clears the field via FieldValue.
 *
 * Returns: { ok: true, updated: <list of touched field names> }
 *
 * Risks: changing `category` will move the item between sidebar buckets
 * on /v2/wardrobe (Bottoms/Tops/Shoes) and may affect downstream
 * pipelines that branch on category (e.g. top-description, label setup).
 * The form surfaces this with a small warning.
 *
 * 2026-05-27 (Phase 2 Slice 2C-hotfix of dashboard redesign).
 */
const EDITABLE_FIELDS = ['name', 'designNumber', 'category', 'gender', 'description'] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const snap = await wardrobeCol.doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Wardrobe item not found' }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const touched: string[] = [];
    for (const f of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        const v = (body as Record<EditableField, unknown>)[f];
        if (typeof v !== 'string') {
          return NextResponse.json(
            { error: `${f} must be a string` },
            { status: 400 },
          );
        }
        update[f] = v;
        touched.push(f);
      }
    }
    if (touched.length === 0) {
      return NextResponse.json({ ok: true, updated: [] });
    }

    await wardrobeCol.doc(id).update(update);
    return NextResponse.json({ ok: true, updated: touched });
  } catch (error) {
    console.error('[v2 wardrobe PATCH] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
