/**
 * Model CRUD — v2 Pro pipeline.
 * Models use referenceImageUrl (single 4K photo) instead of cardImageUrl.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getModel } from '@/lib/firestore';
import { db } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';
import { triggerCelebrityCheck } from '@/lib/celebrity-check';

// GET /api/models/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const model = await getModel(id);
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return NextResponse.json({ model });
  } catch (error) {
    console.error('Error fetching model:', error);
    return NextResponse.json({ error: 'Failed to fetch model' }, { status: 500 });
  }
}

// PATCH /api/models/:id — update model fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const modelsCol = db.collection('models');

    const docRef = modelsCol.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    // Handle referenceImageUrl (also accept legacy cardImageUrl)
    const imageUrl = body.referenceImageUrl || body.cardImageUrl;
    if (imageUrl) {
      let finalUrl = imageUrl;
      if (finalUrl.startsWith('data:image/')) {
        const base64Data = finalUrl.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        finalUrl = await uploadModelCardImage(id.trim(), imageBuffer);
      }
      updates.referenceImageUrl = finalUrl;
    }

    if (body.description !== undefined) updates.description = body.description;
    if (body.name !== undefined) updates.name = body.name;
    updates.updatedAt = new Date();

    await docRef.update(updates);

    // Re-run celebrity check if reference image changed
    if (updates.referenceImageUrl) {
      triggerCelebrityCheck(id, updates.referenceImageUrl as string).catch(err =>
        console.error(`[Models] Celebrity check fire failed for ${id}:`, err)
      );
    }

    return NextResponse.json({ success: true, referenceImageUrl: updates.referenceImageUrl });
  } catch (error) {
    console.error('Error updating model:', error);
    return NextResponse.json({ error: 'Failed to update model' }, { status: 500 });
  }
}

// DELETE /api/models/:id — soft-delete (archive)
//
// 2026-05-12: changed from hard-delete (docRef.delete()) to archive
// (active=false + archivedAt timestamp). A hard-delete left dangling
// references in jobs/shots that pointed to the deleted modelId — every
// shot for the missing model failed with "Model reference image not found"
// (F8 and F10 incident, 9 hourly failures + 2 stuck slots).
//
// Soft-delete keeps the doc in Firestore so:
//   - Job records with that modelId still resolve (UI can show the name)
//   - Admin can restore a wrongly-archived model
//   - Audit history (createdAt, celebrityCheck, etc.) is preserved
//
// listModels(activeOnly=true) already filters archived out of dropdowns
// for new jobs — no UI change needed.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const modelsCol = db.collection('models');
    const docRef = modelsCol.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    await docRef.update({
      active: false,
      archivedAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error('Error archiving model:', error);
    return NextResponse.json({ error: 'Failed to archive model' }, { status: 500 });
  }
}
