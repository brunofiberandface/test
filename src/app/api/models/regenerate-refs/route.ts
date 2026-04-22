/**
 * POST /api/models/regenerate-refs
 *
 * Batch regenerate identity reference images (front + back) for all active
 * models using the uniform studio setup: sports bra (women) / bare torso
 * (men), seamless infinity cove, even lighting.
 *
 * Body (optional):
 *   { modelIds?: string[] }   — specific models; omit for ALL active models
 *   { skipFront?: boolean }   — skip front regeneration (only do back)
 *   { skipBack?: boolean }    — skip back regeneration (only do front)
 *   { twoPass?: boolean }     — two-pass mode: first generates on pure white
 *                                background to break wall/floor associations,
 *                                then uses that clean result as identity anchor
 *                                for the final infinity cove generation
 *
 * Processes sequentially with 5s cooldown between each generation call to
 * avoid Gemini rate limiting. Returns per-model results.
 *
 * This endpoint can take several minutes for many models. Call it from
 * curl or a long-timeout client, not the browser UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getModel, listModels, updateModel } from '@/lib/firestore';
import { uploadModelCardImage, uploadModelBackImage, downloadGarmentImage } from '@/lib/gcs';
import { generateImage, type ReferenceImage } from '@/lib/vertex';
import { prepareForGeneration } from '@/lib/pipeline/image-prep';
import { MODEL_REF_PROMPT_FRONT, MODEL_REF_PROMPT_BACK, MODEL_REF_PROMPT_CLEAN_EXTRACT } from '@/lib/pipeline/model-ref-prompts';

const FLASH_MODEL = 'gemini-3.1-flash-image-preview';
const FLASH_FALLBACK = 'gemini-2.5-flash-image';
const COOLDOWN_MS = 5000;

async function generateWithFallback(
  prompt: string,
  refs: ReferenceImage[],
): Promise<Buffer> {
  const models = [FLASH_MODEL, FLASH_FALLBACK];
  for (const m of models) {
    try {
      const result = await generateImage({
        prompt,
        referenceImages: refs,
        aspectRatio: '3:4',
        model: m,
      });
      console.log(`[RegenerateRefs] Generated with ${m}`);
      return result.imageData;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('429') && m !== models[models.length - 1]) {
        console.warn(`[RegenerateRefs] ${m} rate limited, falling back...`);
        continue;
      }
      throw e;
    }
  }
  throw new Error('All models rate limited');
}

interface ModelResult {
  modelId: string;
  name: string;
  front?: { status: string; url?: string; error?: string };
  back?: { status: string; url?: string; error?: string };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const skipFront = body.skipFront === true;
    const skipBack = body.skipBack === true;
    const twoPass = body.twoPass === true;

    // Resolve model list
    let modelIds: string[];
    if (body.modelIds && Array.isArray(body.modelIds)) {
      modelIds = body.modelIds;
    } else {
      const allModels = await listModels(true) as any[];
      modelIds = allModels.map(m => m.modelId || m.id);
    }

    console.log(`[RegenerateRefs] Starting batch: ${modelIds.length} models, skipFront=${skipFront}, skipBack=${skipBack}, twoPass=${twoPass}`);

    const results: ModelResult[] = [];

    for (let i = 0; i < modelIds.length; i++) {
      const modelId = modelIds[i];
      const model = await getModel(modelId) as any;
      if (!model) {
        results.push({ modelId, name: '?', front: { status: 'skipped', error: 'Model not found' } });
        continue;
      }

      const result: ModelResult = { modelId, name: model.name || modelId };
      const gender = model.gender || 'female';

      // Get existing reference for identity anchor
      const existingUrl = model.referenceImageUrl || model.cardImageUrl;
      if (!existingUrl) {
        results.push({ ...result, front: { status: 'skipped', error: 'No reference image' } });
        continue;
      }

      const cleanUrl = existingUrl.split('?')[0];
      let prepared: Buffer;
      try {
        const raw = await downloadGarmentImage(cleanUrl);
        prepared = await prepareForGeneration(raw);
      } catch (e) {
        results.push({ ...result, front: { status: 'failed', error: `Download failed: ${e}` } });
        continue;
      }

      const identityRef: ReferenceImage = {
        buffer: prepared,
        mimeType: 'image/jpeg',
        label: 'IDENTITY REFERENCE — match this exact person.',
      };

      // ── Generate FRONT ──
      if (!skipFront) {
        try {
          let finalIdentityRef = identityRef;

          // Two-pass mode: first generate on pure white to break background associations
          if (twoPass) {
            console.log(`[RegenerateRefs] ${modelId} Pass 1: clean extraction (white bg)...`);
            const cleanPrompt = MODEL_REF_PROMPT_CLEAN_EXTRACT(gender);
            const cleanData = await generateWithFallback(cleanPrompt, [identityRef]);
            const cleanPrepared = await prepareForGeneration(cleanData);
            finalIdentityRef = {
              buffer: cleanPrepared,
              mimeType: 'image/jpeg',
              label: 'IDENTITY REFERENCE — match this exact person. IGNORE the white background from this reference — generate the studio environment described in the prompt instead.',
            };
            console.log(`[RegenerateRefs] ${modelId} Pass 1 done, proceeding to Pass 2...`);
            await new Promise(r => setTimeout(r, COOLDOWN_MS));
          }

          const prompt = MODEL_REF_PROMPT_FRONT(gender);
          const imageData = await generateWithFallback(prompt, [finalIdentityRef]);
          const frontUrl = await uploadModelCardImage(modelId, imageData);

          // Preserve original upload
          const updateData: Record<string, any> = { referenceImageUrl: frontUrl };
          if (!model.originalReferenceImageUrl) {
            updateData.originalReferenceImageUrl = existingUrl;
          }
          await updateModel(modelId, updateData);

          result.front = { status: twoPass ? 'success (two-pass)' : 'success', url: frontUrl };
          console.log(`[RegenerateRefs] ${modelId} front done${twoPass ? ' (two-pass)' : ''}`);
        } catch (e) {
          console.error(`[RegenerateRefs] ${modelId} front failed:`, e);
          result.front = { status: 'failed', error: String(e) };
        }
        await new Promise(r => setTimeout(r, COOLDOWN_MS));
      }

      // ── Generate BACK ──
      // Use the NEW front ref if we just generated it, otherwise use existing
      if (!skipBack) {
        try {
          // Re-fetch model to get updated referenceImageUrl if front was just regenerated
          const updatedModel = await getModel(modelId) as any;
          const frontForBack = updatedModel?.referenceImageUrl || existingUrl;
          const frontClean = frontForBack.split('?')[0];
          const frontRaw = await downloadGarmentImage(frontClean);
          const frontPrepared = await prepareForGeneration(frontRaw);

          const frontRef: ReferenceImage = {
            buffer: frontPrepared,
            mimeType: 'image/jpeg',
            label: 'FRONT VIEW of this exact person.',
          };

          const prompt = MODEL_REF_PROMPT_BACK(gender);
          const imageData = await generateWithFallback(prompt, [frontRef]);
          const backUrl = await uploadModelBackImage(modelId, imageData);
          await updateModel(modelId, { backReferenceImageUrl: backUrl });

          result.back = { status: 'success', url: backUrl };
          console.log(`[RegenerateRefs] ${modelId} back done`);
        } catch (e) {
          console.error(`[RegenerateRefs] ${modelId} back failed:`, e);
          result.back = { status: 'failed', error: String(e) };
        }
        if (i < modelIds.length - 1) {
          await new Promise(r => setTimeout(r, COOLDOWN_MS));
        }
      }

      results.push(result);
      console.log(`[RegenerateRefs] ${i + 1}/${modelIds.length} complete`);
    }

    const summary = {
      total: modelIds.length,
      frontSuccess: results.filter(r => r.front?.status === 'success').length,
      frontFailed: results.filter(r => r.front?.status === 'failed').length,
      backSuccess: results.filter(r => r.back?.status === 'success').length,
      backFailed: results.filter(r => r.back?.status === 'failed').length,
    };

    console.log(`[RegenerateRefs] Batch complete:`, summary);

    return NextResponse.json({ success: true, summary, results });
  } catch (error) {
    console.error('[RegenerateRefs] Error:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate refs', details: String(error) },
      { status: 500 },
    );
  }
}
