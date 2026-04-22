/**
 * Backfill endpoint: run celebrity check on ALL existing models.
 * One-time use — audits every model that has a reference image
 * but no celebrityCheck record yet.
 *
 * POST /api/models/audit-all
 */
import { NextResponse } from 'next/server';
import { listModels } from '@/lib/firestore';
import { runCelebrityCheck } from '@/lib/celebrity-check';

export async function POST() {
  try {
    const models = await listModels(false); // include inactive
    const results: Array<{
      modelId: string;
      status: string;
      topMatch?: string | null;
      topScore?: number;
      skipped?: string;
    }> = [];

    for (const model of models as any[]) {
      const id = model.modelId || model.id;
      const imageUrl = model.referenceImageUrl || model.cardImageUrl;

      // Skip if already successfully audited (re-check errors)
      if (model.celebrityCheck?.status && model.celebrityCheck.status !== 'error') {
        results.push({ modelId: id, status: 'already_audited', skipped: model.celebrityCheck.status });
        continue;
      }

      // Skip if no image
      if (!imageUrl) {
        results.push({ modelId: id, status: 'skipped', skipped: 'no_image' });
        continue;
      }

      try {
        console.log(`[AuditAll] Checking model ${id}...`);
        const result = await runCelebrityCheck(id, imageUrl);
        if (result) {
          results.push({
            modelId: id,
            status: result.status,
            topMatch: result.topMatch,
            topScore: result.topScore,
          });
        } else {
          results.push({ modelId: id, status: 'skipped', skipped: 'check_disabled' });
        }
      } catch (err) {
        console.error(`[AuditAll] Failed for ${id}:`, err);
        results.push({ modelId: id, status: 'error', skipped: String(err) });
      }
    }

    const summary = {
      total: models.length,
      checked: results.filter(r => ['pass', 'review', 'blocked'].includes(r.status)).length,
      skipped: results.filter(r => r.status === 'skipped' || r.status === 'already_audited').length,
      errors: results.filter(r => r.status === 'error').length,
      flagged: results.filter(r => r.status === 'review' || r.status === 'blocked').length,
    };

    console.log(`[AuditAll] Complete:`, summary);
    return NextResponse.json({ success: true, summary, results });
  } catch (error) {
    console.error('[AuditAll] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
