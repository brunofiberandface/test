import { NextRequest, NextResponse } from 'next/server';
import { createWardrobeItem, listWardrobeItems } from '@/lib/firestore';
import { uploadWardrobeImage } from '@/lib/gcs';

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
 * Body: { name, category, description, fitModelBase64[] (up to 8, front-first rotating right), flatFrontBase64?, flatBackBase64? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, category, description, fitModelBase64, flatFrontBase64, flatBackBase64, fitModelUrls: gcsFitModelUrls, flatFrontUrl: gcsFlatFrontUrl, flatBackUrl: gcsFlatBackUrl, isPrimary, gender, openShoes, hasHeels } = body;

    if (!name || !category || !description || (!fitModelBase64?.length && !gcsFitModelUrls?.length)) {
      return NextResponse.json(
        { error: 'name, category, description, and fitModelBase64 (or fitModelUrls) are required' },
        { status: 400 }
      );
    }

    // Resolve gender — shoes default to 'unisex', other categories require a value (default 'unisex' if omitted)
    const resolvedGender: 'male' | 'female' | 'unisex' = gender || (category === 'shoes' ? 'unisex' : 'unisex');

    // ── Fast path: GCS URLs already uploaded ──
    if (gcsFitModelUrls?.length && !fitModelBase64?.length) {
      const wardrobeId = await createWardrobeItem({
        name,
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
    const wardrobeId = await createWardrobeItem({
      name,
      category,
      description,
      gender: resolvedGender,
      fitModelUrls: [],    // Will update after upload
      thumbnailUrl: '',    // Will update after upload
      isPrimary: isPrimary !== undefined ? isPrimary : undefined,
    });

    // Upload fit model images to GCS (up to 8, ordered front-first rotating right)
    const maxImages = Math.min(fitModelBase64.length, 8);
    const fitModelUrls: string[] = [];

    for (let i = 0; i < maxImages; i++) {
      const base64 = fitModelBase64[i].replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const filename = `fitmodel_${String(i).padStart(2, '0')}.jpg`;
      const url = await uploadWardrobeImage(category, wardrobeId, filename, buffer);
      fitModelUrls.push(url);
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
    const { wardrobeCol } = await import('@/lib/firestore');
    await wardrobeCol.doc(wardrobeId).update({
      fitModelUrls,
      flatFrontUrl: flatFrontUrl || '',
      flatBackUrl: flatBackUrl || '',
      thumbnailUrl: fitModelUrls[0] || flatFrontUrl || '',
      updatedAt: new Date(),
    });

    return NextResponse.json({
      wardrobeId,
      fitModelUrls,
      flatFrontUrl,
      flatBackUrl,
      thumbnailUrl: fitModelUrls[0],
    });
  } catch (err: any) {
    console.error('[Wardrobe POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
