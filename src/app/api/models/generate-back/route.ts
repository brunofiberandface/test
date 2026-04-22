/**
 * Generate a back view reference image from the front model card.
 *
 * Takes the front reference photo and asks Gemini Flash to generate
 * the same person from the back.
 *
 * POST /api/models/generate-back
 * Body: { modelId: string }
 *
 * Also supports batch: { modelIds: string[] }
 *
 * v2: Sports bra (women) / bare torso (men) for Seedream pipeline
 * compatibility. Seamless infinity cove, no horizon lines.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getModel, updateModel } from '@/lib/firestore';
import { uploadModelBackImage } from '@/lib/gcs';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { downloadGarmentImage } from '@/lib/gcs';
import { prepareForGeneration } from '@/lib/pipeline/image-prep';
import { MODEL_REF_PROMPT_BACK } from '@/lib/pipeline/model-ref-prompts';

const FLASH_MODEL = 'gemini-3.1-flash-image-preview';
const FLASH_FALLBACK = 'gemini-2.5-flash-image';

async function generateBackView(modelId: string): Promise<{ backUrl: string }> {
  const model = await getModel(modelId) as any;
  if (!model) throw new Error(`Model not found: ${modelId}`);

  const frontUrl = model.referenceImageUrl || model.cardImageUrl;
  if (!frontUrl) throw new Error(`No front reference image for ${modelId}`);

  // Download and prepare front reference
  const cleanUrl = frontUrl.split('?')[0];
  const raw = await downloadGarmentImage(cleanUrl);
  const prepared = await prepareForGeneration(raw);

  const frontRef: ReferenceImage = {
    buffer: prepared,
    mimeType: 'image/jpeg',
    label: 'FRONT VIEW of this exact person. Match face shape, hair (color, length, texture, style), skin tone, body proportions, and build PRECISELY.',
  };

  const gender = model.gender || 'female';
  const prompt = MODEL_REF_PROMPT_BACK(gender);

  // Generate with Flash (fallback)
  let imageData: Buffer | null = null;
  const models = [FLASH_MODEL, FLASH_FALLBACK];

  for (const m of models) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages: [frontRef],
        aspectRatio: '3:4',
        model: m,
      });
      imageData = result.imageData;
      console.log(`[GenerateBack] ${modelId} generated with ${m}`);
      break;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('429') && m !== models[models.length - 1]) {
        console.warn(`[GenerateBack] ${m} rate limited, falling back...`);
        continue;
      }
      throw e;
    }
  }

  if (!imageData) throw new Error('All models rate limited');

  // Upload to GCS (no foot resize — this is an identity reference, not a dressed base)
  const backUrl = await uploadModelBackImage(modelId, imageData);

  // Save to Firestore
  await updateModel(modelId, { backReferenceImageUrl: backUrl });
  console.log(`[GenerateBack] ${modelId} back view saved: ${backUrl}`);

  return { backUrl };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Batch mode
    if (body.modelIds && Array.isArray(body.modelIds)) {
      const results: Array<{ modelId: string; status: string; backUrl?: string; error?: string }> = [];

      for (const modelId of body.modelIds) {
        try {
          const { backUrl } = await generateBackView(modelId);
          results.push({ modelId, status: 'success', backUrl });
        } catch (e) {
          console.error(`[GenerateBack] ${modelId} failed:`, e);
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

    const { backUrl } = await generateBackView(modelId);
    return NextResponse.json({ success: true, modelId, backUrl });

  } catch (error) {
    console.error('[GenerateBack] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate back view', details: String(error) },
      { status: 500 }
    );
  }
}
