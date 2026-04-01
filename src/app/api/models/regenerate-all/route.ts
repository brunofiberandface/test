import { NextRequest, NextResponse } from 'next/server';
import { listModels } from '@/lib/firestore';
import { generateModelCard } from '@/lib/vertex';
import { uploadModelCardImage } from '@/lib/gcs';
import { db } from '@/lib/firestore';

// POST /api/models/regenerate-all — regenerate card images for ALL models at correct 3:4 ratio
// Body: { gender?: 'male' | 'female', modelIds?: string[], dryRun?: boolean }
// - gender: optional filter by gender
// - modelIds: optional filter — only regenerate these specific models
// - dryRun: if true, just list what would be regenerated
//
// Model cards are generated at 3:4 (1792x2400) via generateModelCard() in vertex.ts.
// This endpoint uploads to GCS (not base64 in Firestore — avoids 1MB limit).
// Runs sequentially to avoid Gemini rate limits (~30-60s per card).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const filterGender = body.gender as string | undefined;
    const filterModelIds = body.modelIds as string[] | undefined;
    const dryRun = body.dryRun || false;

    const models = await listModels(true);
    const modelsCol = db.collection('models');

    let filtered = models as Array<Record<string, unknown>>;
    if (filterGender) {
      filtered = filtered.filter(m => m.gender === filterGender);
    }
    if (filterModelIds?.length) {
      filtered = filtered.filter(m => {
        const mid = (m.modelId as string) || (m.id as string);
        return filterModelIds.includes(mid);
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        toRegenerate: filtered.length,
        models: filtered.map(m => ({
          modelId: (m.modelId as string) || (m.id as string),
          name: m.name,
          gender: m.gender,
        })),
      });
    }

    const results: Array<{ modelId: string; name: string; status: string; elapsed?: number }> = [];

    for (const model of filtered) {
      const mid = (model.modelId as string) || (model.id as string);
      const name = (model.name as string) || mid;
      const desc = model.description as string;
      const gender = model.gender as 'male' | 'female';

      if (!desc || !gender) {
        results.push({ modelId: mid, name, status: 'skipped — no description or gender' });
        continue;
      }

      const startTime = Date.now();
      try {
        console.log(`[Regenerate] Starting ${mid} (${name})...`);
        const imageBase64 = await generateModelCard(desc, gender);

        if (imageBase64) {
          // Upload to GCS (not base64 in Firestore — avoids 1MB limit)
          const imageBuffer = Buffer.from(imageBase64, 'base64');
          const cardImageUrl = await uploadModelCardImage(mid.trim(), imageBuffer);
          console.log(`[Regenerate] Uploaded card for ${mid} to GCS: ${cardImageUrl}`);

          // Update Firestore with GCS URL
          const docRef = modelsCol.doc(mid);
          const doc = await docRef.get();
          if (doc.exists) {
            await docRef.update({ cardImageUrl, updatedAt: new Date() });
            results.push({ modelId: mid, name, status: 'regenerated', elapsed: Math.round((Date.now() - startTime) / 1000) });
          } else {
            // Try with trailing space (legacy)
            const docRef2 = modelsCol.doc(mid + ' ');
            const doc2 = await docRef2.get();
            if (doc2.exists) {
              await docRef2.update({ cardImageUrl, updatedAt: new Date() });
              results.push({ modelId: mid, name, status: 'regenerated (legacy id)', elapsed: Math.round((Date.now() - startTime) / 1000) });
            } else {
              results.push({ modelId: mid, name, status: 'doc not found' });
            }
          }
        } else {
          results.push({ modelId: mid, name, status: 'generation failed', elapsed: Math.round((Date.now() - startTime) / 1000) });
        }
      } catch (err) {
        console.error(`[Regenerate] Error for ${mid}:`, err);
        results.push({ modelId: mid, name, status: `error: ${(err as Error).message}`, elapsed: Math.round((Date.now() - startTime) / 1000) });
      }
    }

    const succeeded = results.filter(r => r.status.startsWith('regenerated')).length;
    const failed = results.filter(r => !r.status.startsWith('regenerated') && r.status !== 'skipped').length;

    return NextResponse.json({
      success: true,
      total: filtered.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    console.error('Error in batch regenerate:', error);
    return NextResponse.json({ error: 'Batch regenerate failed' }, { status: 500 });
  }
}
