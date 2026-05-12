/**
 * Models API — v2 Pro pipeline.
 * Models have a single 4K reference image (no more generated model cards).
 */
import { NextRequest, NextResponse } from 'next/server';
import { listModels, createModel } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';
import { triggerCelebrityCheck } from '@/lib/celebrity-check';

// GET /api/models — list models
//
// By default returns only active models (used by job-creation dropdowns).
// Pass ?includeArchived=1 to include archived models too (admin views).
export async function GET(req: NextRequest) {
  try {
    const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
    const models = await listModels(!includeArchived);
    return NextResponse.json({ models });
  } catch (error) {
    console.error('Error listing models:', error);
    return NextResponse.json({ error: 'Failed to list models' }, { status: 500 });
  }
}

// POST /api/models — create a new model
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, name, description, referenceImageUrl, gender, createdBy } = body;

    if (!modelId || !name || !gender) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const trimmedId = modelId.trim();

    // If referenceImageUrl is base64, upload to GCS
    let finalImageUrl = referenceImageUrl || '';
    if (finalImageUrl.startsWith('data:image/')) {
      const base64Data = finalImageUrl.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      finalImageUrl = await uploadModelCardImage(trimmedId, imageBuffer);
      console.log(`[Models] Uploaded reference image for ${trimmedId} to GCS`);
    }

    await createModel(trimmedId, {
      name: name.trim(),
      description: description || '',
      referenceImageUrl: finalImageUrl,
      gender,
      createdBy,
    });

    // Fire-and-forget celebrity check on the reference image
    if (finalImageUrl) {
      triggerCelebrityCheck(trimmedId, finalImageUrl).catch(err =>
        console.error(`[Models] Celebrity check fire failed for ${trimmedId}:`, err)
      );
    }

    return NextResponse.json({ success: true, modelId: trimmedId });
  } catch (error) {
    console.error('Error creating model:', error);
    return NextResponse.json({ error: 'Failed to create model' }, { status: 500 });
  }
}
