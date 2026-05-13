/**
 * Models API — v2 Pro pipeline.
 * Models have a single 4K reference image (no more generated model cards).
 */
import { NextRequest, NextResponse } from 'next/server';
import { listModels, createModel, updateModel } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';
import { triggerCelebrityCheck } from '@/lib/celebrity-check';
import { makeWhiteBgRef } from '@/lib/pipeline/model-whitebg';

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

    // Fire-and-forget celebrity check on the original reference image
    // (runs in parallel with the white-bg + back-view pipeline below)
    if (finalImageUrl) {
      triggerCelebrityCheck(trimmedId, finalImageUrl).catch(err =>
        console.error(`[Models] Celebrity check fire failed for ${trimmedId}:`, err)
      );
    }

    // 2026-05-13: post-creation pipeline (Bruno: "process all other models
    // that don't have a white background, and that step needs to happen at
    // model creation" + "always generate back view as well, this is now
    // manual"). Runs async in the background — the user-facing create
    // response returns immediately. Sequence matters:
    //
    //   1. Matte the uploaded front reference to pure-white-bg (rembg + sharp,
    //      $0 cost). Updates referenceImageUrl to the clean version.
    //   2. Trigger back-view generation — uses the new white-bg
    //      referenceImageUrl as the identity source, so back view inherits
    //      the clean backdrop too.
    //
    // Both steps fire-and-forget; failures are logged but don't fail the
    // user's create call. The manual /models/[id] regenerate button stays
    // as a re-run fallback.
    if (finalImageUrl) {
      (async () => {
        try {
          console.log(`[Models] Starting post-create pipeline for ${trimmedId}…`);
          // Step 1: matte to white-bg, update referenceImageUrl
          const whiteRefUrl = await makeWhiteBgRef(finalImageUrl, trimmedId, 'front');
          await updateModel(trimmedId, {
            referenceImageUrl: whiteRefUrl,
            originalReferenceImageUrl: finalImageUrl.split('?')[0],
          });
          console.log(`[Models] ${trimmedId} referenceImageUrl now white-bg`);

          // Step 2: trigger back-view (reads the updated white-bg front)
          const baseUrl = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
          const r = await fetch(`${baseUrl}/api/models/generate-back`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: trimmedId }),
          });
          console.log(`[Models] Back view trigger for ${trimmedId} → HTTP ${r.status}`);
        } catch (err) {
          console.error(`[Models] Post-create pipeline failed for ${trimmedId}:`, err);
        }
      })();
    }

    return NextResponse.json({ success: true, modelId: trimmedId });
  } catch (error) {
    console.error('Error creating model:', error);
    return NextResponse.json({ error: 'Failed to create model' }, { status: 500 });
  }
}
