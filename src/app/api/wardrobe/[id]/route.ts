import { NextRequest, NextResponse } from 'next/server';
import { getWardrobeItem, wardrobeCol } from '@/lib/firestore';
import { uploadWardrobeImage } from '@/lib/gcs';

/**
 * GET /api/wardrobe/[id]
 * Fetch a single wardrobe item.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = await getWardrobeItem(id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/wardrobe/[id]
 * Update name, description, or category of a wardrobe item.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, description, category, isPrimary, gender, openShoes, hasHeels, fitModelUrls, flatFrontBase64, flatBackBase64 } = body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (isPrimary !== undefined) updates.isPrimary = isPrimary;
    if (gender !== undefined) updates.gender = gender;
    if (openShoes !== undefined) updates.openShoes = openShoes;
    if (hasHeels !== undefined) updates.hasHeels = hasHeels;
    if (fitModelUrls !== undefined) updates.fitModelUrls = fitModelUrls;

    // Upload flat front image if provided as base64
    if (flatFrontBase64) {
      const item = await getWardrobeItem(id) as Record<string, any> | null;
      const cat = category || item?.category || 'shirt';
      const base64Clean = flatFrontBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const flatFrontUrl = await uploadWardrobeImage(cat, id, 'flat_front.jpg', buffer);
      updates.flatFrontUrl = flatFrontUrl;
    }

    // Upload flat back image if provided as base64
    if (flatBackBase64) {
      const item = updates._item || await getWardrobeItem(id) as Record<string, any> | null;
      const cat = category || item?.category || 'shirt';
      const base64Clean = flatBackBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const flatBackUrl = await uploadWardrobeImage(cat, id, 'flat_back.jpg', buffer);
      updates.flatBackUrl = flatBackUrl;
    }

    await wardrobeCol.doc(id).update(updates);
    return NextResponse.json({
      ok: true,
      ...(updates.flatFrontUrl ? { flatFrontUrl: updates.flatFrontUrl } : {}),
      ...(updates.flatBackUrl ? { flatBackUrl: updates.flatBackUrl } : {}),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/wardrobe/[id]
 * Delete a wardrobe item.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await wardrobeCol.doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
