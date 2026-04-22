/**
 * Generate a NEW front identity reference image for a model.
 *
 * Takes the existing front reference (original upload or previous generation)
 * as an identity anchor, and regenerates it with the uniform studio setup:
 * sports bra (women) / bare torso (men), seamless infinity cove, even lighting.
 *
 * POST /api/models/generate-front
 * Body: { modelId: string }
 *
 * Also supports batch: { modelIds: string[] }
 *
 * The old referenceImageUrl is preserved in `originalReferenceImageUrl` before
 * being overwritten, so the original upload is never lost.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getModel, updateModel } from '@/lib/firestore';
import { uploadModelCardImage } from '@/lib/gcs';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { downloadGarmentImage } from '@/lib/gcs';
import { prepareForGeneration } from '@/lib/pipeline/image-prep';
import { MODEL_REF_PROMPT_FRONT } from '@/lib/pipeline/model-ref-prompts';

const FLASH_MODEL = 'gemini-3.1-flash-image-preview';
const FLASH_FALLBACK = 'gemini-2.5-flash-image';

async function generateFrontView(modelId: string): Promise<{ frontUrl: string }> {
  const model = await getModel(modelId) as any;
  if (!model) throw new Error(`Model not found: ${modelId}`);

  // Use whichever front ref exists — original upload or previous generation
  const existingUrl = model.referenceImageUrl || model.cardImageUrl;
  if (!existingUrl) throw new Error(`No reference image for ${modelId}`);

  // Download and prepare existing reference as identity anchor
  const cleanUrl = existingUrl.split('?')[0];
  const raw = await downloadGarmentImage(cleanUrl);
  const prepared = await prepareForGeneration(raw);

  const identityRef: ReferenceImage = {
    buffer: prepared,
    mimeType: 'image/jpeg',
    label: 'IDENTITY REFERENCE — this exact person. Match face, hair, skin tone, body proportions PRECISELY. Only the clothing and studio setup change.',
  };

  const gender = model.gender || 'female';
  const prompt = MODEL_REF_PROMPT_FRONT(gender);

  // Generate with Flash (fallback chain)
  let imageData: Buffer | null = null;
  const models = [FLASH_MODEL, FLASH_FALLBACK];

  for (const m of models) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [identityRef],
        aspectRatio: '3:4',
        model: m,
      });
      imageData = result.imageData;
      console.log(`[GenerateFront] ${modelId} generated with ${m}`);
      break;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('429') && m !== models[models.length - 1]) {
        console.warn(`[GenerateFront] ${m} rate limited, falling back...`);
        continue;
      }
      throw e;
    }
  }

  if (!imageData) throw new Error('All models rate limited');

  // Upload to GCS (overwrites existing model card)
  const frontUrl = await uploadModelCardImage(modelId, imageData);

  // Preserve the original upload URL if this is the first regeneration
  const updateData: Record<string, any> = { referenceImageUrl: frontUrl };
  if (!model.originalReferenceImageUrl) {
    updateData.originalReferenceImageUrl = existingUrl;
    console.log(`[GenerateFront] ${modelId} preserving original ref: ${existingUrl}`);
  }

  await updateModel(modelId, updateData);
  console.log(`[GenerateFront] ${modelId} front view saved: ${frontUrl}`);

  return { frontUrl };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Batch mode
    if (body.modelIds && Array.isArray(body.modelIds)) {
      const results: Array<{ modelId: string; status: string; frontUrl?: string; error?: string }> = [];

      for (const modelId of body.modelIds) {
        try {
          const { frontUrl } = await generateFrontView(modelId);
          results.push({ modelId, status: 'success', frontUrl });
        } catch (e) {
          console.error(`[GenerateFront] ${modelId} failed:`, e);
          results.push({ modelId, status: 'failed', error: String(e) });
        }

        // Cooldown between models to avoid rate limiting
        if (body.modelIds.indexOf(modelId) < body.modelIds.length - 1) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      return NextResponse.json({ success: true, results });
    }

    // Single model
    const { modelId } = body;
    if (!modelId) {
      return NextResponse.json({ error: 'Missing modelId' }, { status: 400 });
    }

    const { frontUrl } = await generateFrontView(modelId);
    return NextResponse.json({ success: true, modelId, frontUrl });

  } catch (error) {
    console.error('[GenerateFront] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate front view', details: String(error) },
      { status: 500 },
    );
  }
}
