import { NextRequest, NextResponse } from 'next/server';
import { dressedBasesCol, deleteDressedBase } from '@/lib/firestore';

// Internal base URL for calling our own generate-dressed endpoint
const SELF_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// GET /api/models/batch-redress — list all existing dressed bases (dry run)
export async function GET() {
  try {
    const snap = await dressedBasesCol.get();
    const bases = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        modelId: data.modelId,
        wardrobeHash: data.wardrobeHash,
        view: data.view,
        wardrobeItemIds: data.wardrobeItemIds,
        wardrobeItemNames: data.wardrobeItemNames,
        qcScore: data.qcScore,
        qcPass: data.qcPass,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
      };
    });

    // Group by model
    const byModel: Record<string, typeof bases> = {};
    for (const b of bases) {
      if (!byModel[b.modelId]) byModel[b.modelId] = [];
      byModel[b.modelId].push(b);
    }

    return NextResponse.json({
      totalBases: bases.length,
      models: Object.keys(byModel).length,
      byModel,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/models/batch-redress — regenerate all dressed bases
// Body: { modelIds?: string[], dryRun?: boolean }
// - modelIds: optional filter — only regenerate for these models
// - dryRun: if true, just list what would be regenerated
//
// Each dressed base takes ~30-60s. Cloud Run timeout is 540s.
// We process sequentially and return results.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const filterModelIds: string[] | undefined = body.modelIds;
    const dryRun: boolean = body.dryRun || false;

    // 1. List all existing dressed bases
    const snap = await dressedBasesCol.get();
    let bases = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        modelId: data.modelId as string,
        wardrobeHash: data.wardrobeHash as string,
        view: (data.view || 'front') as string,
        wardrobeItemIds: data.wardrobeItemIds as Record<string, string>,
      };
    });

    // Filter by modelIds if specified
    if (filterModelIds?.length) {
      bases = bases.filter(b => filterModelIds.includes(b.modelId));
    }

    // Deduplicate by modelId + wardrobeHash + view
    const uniqueKey = (b: typeof bases[0]) => `${b.modelId}_${b.wardrobeHash}_${b.view}`;
    const seen = new Set<string>();
    const dedupedBases = bases.filter(b => {
      const key = uniqueKey(b);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        toRegenerate: dedupedBases.length,
        items: dedupedBases.map(b => ({
          id: b.id,
          modelId: b.modelId,
          view: b.view,
          wardrobeItemIds: b.wardrobeItemIds,
        })),
      });
    }

    // 2. Process each dressed base: delete old → regenerate
    const results: Array<{
      id: string;
      modelId: string;
      view: string;
      status: string;
      qcScore?: number;
      error?: string;
    }> = [];

    // Internal loopback base URL — bypasses Cloud Run IAM auth
    const port = process.env.PORT || '3000';
    const origin = `http://localhost:${port}`;

    for (const base of dedupedBases) {
      console.log(`[BatchRedress] Processing ${base.id} (model=${base.modelId}, view=${base.view})...`);

      try {
        // Delete old dressed base
        await deleteDressedBase(base.id);
        console.log(`[BatchRedress] Deleted old: ${base.id}`);

        // Regenerate via internal API call
        const genUrl = `${origin}/api/models/generate-dressed`;
        const genResponse = await fetch(genUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: base.modelId,
            wardrobeItemIds: base.wardrobeItemIds,
            view: base.view,
          }),
        });

        if (genResponse.ok) {
          const genResult = await genResponse.json();
          results.push({
            id: base.id,
            modelId: base.modelId,
            view: base.view,
            status: 'regenerated',
            qcScore: genResult.qcScore,
          });
          console.log(`[BatchRedress] Regenerated ${base.id} (QC=${genResult.qcScore})`);
        } else {
          const errText = await genResponse.text();
          results.push({
            id: base.id,
            modelId: base.modelId,
            view: base.view,
            status: 'failed',
            error: errText.substring(0, 200),
          });
          console.error(`[BatchRedress] Failed ${base.id}: ${errText.substring(0, 200)}`);
        }
      } catch (err) {
        results.push({
          id: base.id,
          modelId: base.modelId,
          view: base.view,
          status: 'error',
          error: String(err).substring(0, 200),
        });
        console.error(`[BatchRedress] Error ${base.id}:`, err);
      }
    }

    const succeeded = results.filter(r => r.status === 'regenerated').length;
    const failed = results.filter(r => r.status !== 'regenerated').length;

    return NextResponse.json({
      success: true,
      total: dedupedBases.length,
      succeeded,
      failed,
      results,
    });

  } catch (error) {
    console.error('[BatchRedress] error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
