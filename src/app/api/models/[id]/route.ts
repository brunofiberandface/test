import { NextRequest, NextResponse } from 'next/server';
import { getModel } from '@/lib/firestore';
import { db } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';

// GET /api/models/:id — fetch a single model
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let model = await getModel(id);
    if (!model) {
      model = await getModel(id + ' ');
    }

    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    return NextResponse.json({ model });
  } catch (error) {
    console.error('Error fetching model:', error);
    return NextResponse.json({ error: 'Failed to fetch model' }, { status: 500 });
  }
}

// PATCH /api/models/:id — update model fields (e.g., cardImageUrl after regen)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const modelsCol = db.collection('models');

    let docRef = modelsCol.doc(id);
    let doc = await docRef.get();
    if (!doc.exists) {
      docRef = modelsCol.doc(id + ' ');
      doc = await docRef.get();
    }

    if (!doc.exists) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    // If cardImageUrl is base64, upload to GCS first (Firestore has 1MB limit)
    if (body.cardImageUrl) {
      let cardUrl = body.cardImageUrl;
      if (cardUrl.startsWith('data:image/')) {
        const base64Data = cardUrl.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        cardUrl = await uploadModelCardImage(id.trim(), imageBuffer);
        console.log(`[Models] Uploaded card for ${id} to GCS: ${cardUrl}`);
      }
      updates.cardImageUrl = cardUrl;
    }

    if (body.description) updates.description = body.description;
    if (body.name) updates.name = body.name;
    if (body.modelId) updates.modelId = body.modelId;
    updates.updatedAt = new Date();

    await docRef.update(updates);

    return NextResponse.json({ success: true, cardImageUrl: updates.cardImageUrl });
  } catch (error) {
    console.error('Error updating model:', error);
    return NextResponse.json({ error: 'Failed to update model' }, { status: 500 });
  }
}

// DELETE /api/models/:id — delete a model
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const modelsCol = db.collection('models');

    let docRef = modelsCol.doc(id);
    let doc = await docRef.get();
    if (!doc.exists) {
      docRef = modelsCol.doc(id + ' ');
      doc = await docRef.get();
    }

    if (!doc.exists) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting model:', error);
    return NextResponse.json({ error: 'Failed to delete model' }, { status: 500 });
  }
}
