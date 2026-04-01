import { NextRequest, NextResponse } from 'next/server';
import { listModels, createModel } from '@/lib/firestore';
import { db } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';

// GET /api/models — list all active models
// ?fix=trim — one-time cleanup to fix trailing spaces in model IDs and names
export async function GET(req: NextRequest) {
  try {
    const fix = req.nextUrl.searchParams.get('fix');

    // One-time fix: re-save models with trimmed IDs
    if (fix === 'trim') {
      const modelsCol = db.collection('models');
      const snap = await modelsCol.get();
      const fixed: string[] = [];

      for (const doc of snap.docs) {
        const data = doc.data();
        const oldId = doc.id;
        const trimmedId = oldId.trim();
        const trimmedModelId = (data.modelId || '').trim();
        const trimmedName = (data.name || '').trim();

        // If ID has trailing/leading spaces, create new doc with trimmed ID and delete old
        if (oldId !== trimmedId) {
          await modelsCol.doc(trimmedId).set({
            ...data,
            modelId: trimmedModelId || trimmedId,
            name: trimmedName,
          });
          await modelsCol.doc(oldId).delete();
          fixed.push(`${oldId} → ${trimmedId}`);
        } else if (data.modelId !== trimmedModelId || data.name !== trimmedName) {
          // Just fix the fields
          await modelsCol.doc(oldId).update({
            modelId: trimmedModelId || oldId,
            name: trimmedName,
          });
          fixed.push(`${oldId} (fields trimmed)`);
        }
      }

      return NextResponse.json({ success: true, fixed });
    }

    const models = await listModels(true);
    return NextResponse.json({ models });
  } catch (error) {
    console.error('Error listing models:', error);
    return NextResponse.json({ error: 'Failed to list models' }, { status: 500 });
  }
}

// POST /api/models — create a new model (admin only)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, name, description, cardImageUrl, gender, createdBy } = body;

    if (!modelId || !name || !description || !gender) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Always trim IDs to prevent trailing space issues
    const trimmedId = modelId.trim();

    // If cardImageUrl is base64, upload to GCS (Firestore 1MB limit)
    let finalCardUrl = cardImageUrl || `/model-cards/${trimmedId}.png`;
    if (finalCardUrl.startsWith('data:image/')) {
      const base64Data = finalCardUrl.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      finalCardUrl = await uploadModelCardImage(trimmedId, imageBuffer);
      console.log(`[Models] Uploaded card for new model ${trimmedId} to GCS: ${finalCardUrl}`);
    }

    await createModel(trimmedId, {
      name: name.trim(),
      description,
      cardImageUrl: finalCardUrl,
      gender,
      createdBy,
    });

    return NextResponse.json({ success: true, modelId: modelId.trim() });
  } catch (error) {
    console.error('Error creating model:', error);
    return NextResponse.json({ error: 'Failed to create model' }, { status: 500 });
  }
}
