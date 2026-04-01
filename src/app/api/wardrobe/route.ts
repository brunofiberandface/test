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
 * Create a new wardrobe stock item with 360° images.
 * Body: { name, category, description, images360Base64[], flatImageBase64? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, category, description, images360Base64, flatImageBase64, imageUrls: gcsImageUrls, flatImageUrl: gcsFlatImageUrl, fitModelUrls: gcsFitModelUrls, isPrimary, gender, openShoes, hasHeels } = body;

    if (!name || !category || !description || (!images360Base64?.length && !gcsImageUrls?.length)) {
      return NextResponse.json(
        { error: 'name, category, description, and images360Base64 (or imageUrls) are required' },
        { status: 400 }
      );
    }

    // Resolve gender — shoes default to 'unisex', other categories require a value (default 'unisex' if omitted)
    const resolvedGender: 'male' | 'female' | 'unisex' = gender || (category === 'shoes' ? 'unisex' : 'unisex');

    // ── Fast path: GCS URLs already uploaded (e.g. from job auto-save backfill) ──
    if (gcsImageUrls?.length && !images360Base64?.length) {
      const wardrobeId = await createWardrobeItem({
        name,
        category,
        description,
        gender: resolvedGender,
        imageUrls: gcsImageUrls,
        fitModelUrls: gcsFitModelUrls?.length ? gcsFitModelUrls : undefined,
        flatImageUrl: gcsFlatImageUrl || undefined,
        thumbnailUrl: gcsImageUrls[0] || gcsFlatImageUrl || '',
        isPrimary: isPrimary !== undefined ? isPrimary : undefined,
        openShoes: openShoes !== undefined ? openShoes : undefined,
        hasHeels: hasHeels !== undefined ? hasHeels : undefined,
      });
      return NextResponse.json({
        wardrobeId,
        imageUrls: gcsImageUrls,
        fitModelUrls: gcsFitModelUrls || [],
        flatImageUrl: gcsFlatImageUrl || '',
        thumbnailUrl: gcsImageUrls[0],
      });
    }

    // Create Firestore doc first to get ID
    const wardrobeId = await createWardrobeItem({
      name,
      category,
      description,
      gender: resolvedGender,
      imageUrls: [],       // Will update after upload
      thumbnailUrl: '',    // Will update after upload
      isPrimary: isPrimary !== undefined ? isPrimary : undefined,
    });

    // Upload 360° images to GCS
    const maxImages = Math.min(images360Base64.length, 9);
    const imageUrls: string[] = [];

    for (let i = 0; i < maxImages; i++) {
      const base64 = images360Base64[i].replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const filename = `360_${String(i).padStart(2, '0')}.jpg`;
      const url = await uploadWardrobeImage(category, wardrobeId, filename, buffer);
      imageUrls.push(url);
    }

    // Upload flat image if provided
    let flatImageUrl: string | undefined;
    if (flatImageBase64) {
      const base64 = flatImageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      flatImageUrl = await uploadWardrobeImage(category, wardrobeId, 'flat.jpg', buffer);
    }

    // Update doc with image URLs
    const { wardrobeCol } = await import('@/lib/firestore');
    await wardrobeCol.doc(wardrobeId).update({
      imageUrls,
      flatImageUrl: flatImageUrl || '',
      thumbnailUrl: imageUrls[0] || '',
      updatedAt: new Date(),
    });

    return NextResponse.json({
      wardrobeId,
      imageUrls,
      flatImageUrl,
      thumbnailUrl: imageUrls[0],
    });
  } catch (err: any) {
    console.error('[Wardrobe POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
