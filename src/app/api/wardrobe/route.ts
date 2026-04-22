import { NextRequest, NextResponse } from 'next/server';
import { createWardrobeItem, listWardrobeItems, wardrobeCol } from '@/lib/firestore';
import { uploadWardrobeImage } from '@/lib/gcs';
import { runSilhouetteForWardrobe } from '@/lib/pipeline/silhouette';
import { runTopDescriptionForWardrobe } from '@/lib/pipeline/top-description';

/**
 * GET /api/wardrobe?category=shoes
 * List wardrobe items, optionally filtered by category.
 */
export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get('category') || undefined;
    const items = await listWardrobeItems(category);
    return NextResponse.json({ items });
  } catch (err: any) {
    console.error('[Wardrobe GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/wardrobe
 * Create a new wardrobe stock item with fit model images + flat front/back.
 *
 * Body:
 *   { name, category, description,
 *     fitModelSlots?: Record<'front'|'front45Left'|'front45Right'|'back'|'back45Left'|'back45Right', base64>,  // v2 preferred
 *     fitModelBase64?: string[],  // v1 legacy array (up to 8)
 *     flatFrontBase64?, flatBackBase64? }
 *
 * When fitModelSlots is provided, the item is written with both the v2 `fitModels` map
 * AND a legacy `fitModelUrls` array in canonical order (for backward compat). This is the
 * preferred path for new items — it enforces the v2 schema so angle-setup audits aren't
 * needed later.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, designNumber, category, description, fitModelBase64, fitModelSlots, flatFrontBase64, flatBackBase64, fitModelUrls: gcsFitModelUrls, flatFrontUrl: gcsFlatFrontUrl, flatBackUrl: gcsFlatBackUrl, isPrimary, gender, openShoes, hasHeels } = body;

    const hasSlotFitModels = fitModelSlots && Object.keys(fitModelSlots).length > 0;
    const hasFitModels = hasSlotFitModels || fitModelBase64?.length || gcsFitModelUrls?.length;
    const hasFlatImages = flatFrontBase64 || gcsFlatFrontUrl;
    if (!name || !category || !description || (!hasFitModels && !hasFlatImages)) {
      return NextResponse.json(
        { error: 'name, category, description, and either fit model images or flat images are required' },
        { status: 400 }
      );
    }

    // Resolve gender — shoes default to 'unisex', other categories require a value (default 'unisex' if omitted)
    const resolvedGender: 'male' | 'female' | 'unisex' = gender || (category === 'shoes' ? 'unisex' : 'unisex');

    // ── Fast path: GCS URLs already uploaded ──
    if (gcsFitModelUrls?.length && !fitModelBase64?.length) {
      const wardrobeId = await createWardrobeItem({
        name,
        designNumber: designNumber || undefined,
        category,
        description,
        gender: resolvedGender,
        fitModelUrls: gcsFitModelUrls,
        flatFrontUrl: gcsFlatFrontUrl || undefined,
        flatBackUrl: gcsFlatBackUrl || undefined,
        thumbnailUrl: gcsFitModelUrls[0] || gcsFlatFrontUrl || '',
        isPrimary: isPrimary !== undefined ? isPrimary : undefined,
        openShoes: openShoes !== undefined ? openShoes : undefined,
        hasHeels: hasHeels !== undefined ? hasHeels : undefined,
      });
      return NextResponse.json({
        wardrobeId,
        fitModelUrls: gcsFitModelUrls,
        flatFrontUrl: gcsFlatFrontUrl || '',
        flatBackUrl: gcsFlatBackUrl || '',
        thumbnailUrl: gcsFitModelUrls[0],
      });
    }

    // Create Firestore doc first to get ID
    const createData: Record<string, any> = {
      name,
      category,
      description,
      gender: resolvedGender,
      fitModelUrls: [],
      thumbnailUrl: '',
    };
    if (designNumber) createData.designNumber = designNumber;
    if (isPrimary !== undefined) createData.isPrimary = isPrimary;
    if (openShoes !== undefined) createData.openShoes = openShoes;
    if (hasHeels !== undefined) createData.hasHeels = hasHeels;
    const wardrobeId = await createWardrobeItem(createData as any);

    // Upload fit model images to GCS.
    //
    // Two upload paths:
    //   (A) v2 slot-keyed upload — client sent fitModelSlots { front: base64, back: base64, ... }
    //       Upload each keyed entry with semantic filename, build both v2 fitModels map
    //       and a legacy fitModelUrls array in canonical order for backward compat.
    //   (B) v1 legacy array upload — client sent fitModelBase64 as flat array.
    //       Upload with index-based filenames, store as fitModelUrls only.
    //       (normalizeWardrobeItem() will guess the slot mapping at read time.)
    const fitModelUrls: string[] = [];
    let fitModels: Record<string, string> | undefined;

    if (hasSlotFitModels) {
      // (A) v2 path — preferred for new items.
      const canonicalOrder = ['front', 'front45Left', 'front45Right', 'back', 'back45Left', 'back45Right'] as const;
      fitModels = {};
      for (const slotKey of canonicalOrder) {
        const b64 = (fitModelSlots as Record<string, string>)[slotKey];
        if (!b64) continue;
        const base64 = b64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const filename = `fitmodel_${slotKey}.jpg`;
        const url = await uploadWardrobeImage(category, wardrobeId, filename, buffer);
        fitModels[slotKey] = url;
        fitModelUrls.push(url); // also push in canonical order for legacy readers
      }
    } else if (fitModelBase64?.length) {
      // (B) v1 legacy path — kept for callers that haven't migrated to fitModelSlots yet.
      const maxImages = Math.min(fitModelBase64.length, 8);
      for (let i = 0; i < maxImages; i++) {
        const base64 = fitModelBase64[i].replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const filename = `fitmodel_${String(i).padStart(2, '0')}.jpg`;
        const url = await uploadWardrobeImage(category, wardrobeId, filename, buffer);
        fitModelUrls.push(url);
      }
    }

    // Upload flat front image if provided
    let flatFrontUrl: string | undefined;
    if (flatFrontBase64) {
      const base64 = flatFrontBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      flatFrontUrl = await uploadWardrobeImage(category, wardrobeId, 'flat_front.jpg', buffer);
    }

    // Upload flat back image if provided
    let flatBackUrl: string | undefined;
    if (flatBackBase64) {
      const base64 = flatBackBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      flatBackUrl = await uploadWardrobeImage(category, wardrobeId, 'flat_back.jpg', buffer);
    }

    // Update doc with image URLs
    const updatePayload: Record<string, any> = {
      fitModelUrls,
      flatFrontUrl: flatFrontUrl || '',
      flatBackUrl: flatBackUrl || '',
      thumbnailUrl: fitModels?.front || fitModelUrls[0] || flatFrontUrl || '',
      updatedAt: new Date(),
    };
    if (fitModels) updatePayload.fitModels = fitModels;
    await wardrobeCol.doc(wardrobeId).update(updatePayload);

    // Fire silhouette analysis in the background — don't block upload response.
    // Only for pants/jeans with fit model images (not shoes/tops).
    if (category === 'bottom' || category === 'pants' || category === 'jeans') {
      runSilhouetteForWardrobe(wardrobeId).catch(err =>
        console.error(`[Wardrobe] Background silhouette failed for ${wardrobeId}:`, err)
      );
    }

    // Fire top description analysis in the background for tops.
    // Opus generates a rich text description used by Seedream instead of the reference image.
    if (category === 'top' || category === 'shirt' || category === 'tee') {
      runTopDescriptionForWardrobe(wardrobeId).catch(err =>
        console.error(`[Wardrobe] Background top description failed for ${wardrobeId}:`, err)
      );
    }

    return NextResponse.json({
      wardrobeId,
      fitModels,
      fitModelUrls,
      flatFrontUrl,
      flatBackUrl,
      thumbnailUrl: fitModels?.front || fitModelUrls[0],
    });
  } catch (err: any) {
    console.error('[Wardrobe POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
