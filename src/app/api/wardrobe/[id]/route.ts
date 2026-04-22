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
    const { name, designNumber, description, category, isPrimary, gender, openShoes, hasHeels, fitModelUrls, fitModels, flatFrontBase64, flatBackBase64 } = body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (designNumber !== undefined) updates.designNumber = designNumber;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (isPrimary !== undefined) updates.isPrimary = isPrimary;
    if (gender !== undefined) updates.gender = gender;
    if (openShoes !== undefined) updates.openShoes = openShoes;
    if (hasHeels !== undefined) updates.hasHeels = hasHeels;
    if (fitModelUrls !== undefined) updates.fitModelUrls = fitModelUrls;

    // v2 fit-model slot map — written by the angle-setup page.
    // Accepts a partial map; merged into the existing doc. Setting a slot to '' clears it.
    //
    // Important: we do NOT touch the legacy fitModelUrls array. It stays as the raw pool of
    // uploaded photos (including any "unused" ones not assigned to a canonical slot). Once
    // fitModels is written, normalizeWardrobeItem() will read v2 first (sentinel on
    // item.fitModels.front), so the legacy array is historical — we keep it so re-remapping
    // later can still see all available photos.
    if (fitModels !== undefined && fitModels !== null && typeof fitModels === 'object') {
      const existing = (await getWardrobeItem(id) as any)?.fitModels || {};
      const merged: Record<string, string> = { ...existing };
      for (const [k, v] of Object.entries(fitModels as Record<string, string>)) {
        if (typeof v === 'string') merged[k] = v;
      }
      updates.fitModels = merged;
      if (merged.front) updates.thumbnailUrl = merged.front;
    }

    // Accept direct GCS URLs for flat images (no re-upload needed)
    if (body.flatFrontUrl && !flatFrontBase64) updates.flatFrontUrl = body.flatFrontUrl;
    if (body.flatBackUrl && !flatBackBase64) updates.flatBackUrl = body.flatBackUrl;

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
