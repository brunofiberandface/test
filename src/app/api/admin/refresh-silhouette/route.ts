/**
 * POST /api/admin/refresh-silhouette
 *
 * Force re-generate silhouette analysis for a wardrobe item, or for a job's
 * focus wardrobe item with propagation back to the job.
 *
 * Used after updating the Opus silhouette-analysis prompt in silhouette.ts —
 * existing silhouettes are cached on wardrobe items AND snapshot onto jobs,
 * so a code deploy alone doesn't refresh them.
 *
 * Body (one of):
 *   { jobId: string }  — re-run silhouette for the job's focus wardrobe item
 *                         AND write the new text back onto the job's
 *                         silhouetteAnalysis field so the next shot
 *                         regeneration picks it up.
 *   { itemId: string } — re-run silhouette for a wardrobe item only. Any
 *                         existing jobs using this item are NOT touched.
 *
 * Returns: { success, itemId, jobUpdated, frontChars, backChars,
 *            hemFloorExcerptBack, hemFloorExcerptFront }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJob, updateJob, getWardrobeItem } from '@/lib/firestore';
import { runSilhouetteForWardrobe } from '@/lib/pipeline/silhouette';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, itemId } = body;

    if (!jobId && !itemId) {
      return NextResponse.json(
        { error: 'Provide either jobId or itemId' },
        { status: 400 }
      );
    }

    // Resolve target wardrobe item ID
    let targetItemId: string;
    let targetJob: any = null;

    if (jobId) {
      const job = await getJob(jobId) as any;
      if (!job) {
        return NextResponse.json({ error: `Job not found: ${jobId}` }, { status: 404 });
      }
      const wardrobe = job.wardrobe || {};
      const focusEntry = Object.entries(wardrobe).find(
        ([, v]: [string, any]) => v?.isFocus
      );
      if (!focusEntry) {
        return NextResponse.json(
          { error: `Job ${jobId} has no focus wardrobe item (nothing marked isFocus:true in job.wardrobe)` },
          { status: 400 }
        );
      }
      targetItemId = (focusEntry[1] as any).itemId;
      targetJob = job;
    } else {
      const item = await getWardrobeItem(itemId);
      if (!item) {
        return NextResponse.json({ error: `Wardrobe item not found: ${itemId}` }, { status: 404 });
      }
      targetItemId = itemId;
    }

    console.log(`[RefreshSilhouette] Starting for wardrobe ${targetItemId}${jobId ? ` (job ${jobId})` : ''}`);

    // Re-run silhouette analysis via the canonical pipeline function.
    // This also re-caches on the wardrobe item (silhouetteFront/Back fields).
    const result = await runSilhouetteForWardrobe(targetItemId);

    // If caller supplied jobId, write new silhouette to the job too so the
    // NEXT M03/M04 regeneration on that job uses the refreshed text.
    if (targetJob) {
      await updateJob(jobId, { silhouetteAnalysis: result });
      console.log(`[RefreshSilhouette] Updated job ${jobId}.silhouetteAnalysis (front: ${result.front.length}chars, back: ${result.back.length}chars)`);
    }

    // Pull HEM-TO-FLOOR excerpts for quick verification the new Opus prompt
    // produced clean drape language (not the old "pool on shoe" menu pick).
    const excerpt = (text: string) => {
      const k = (text || '').indexOf('HEM-TO-FLOOR');
      return k >= 0 ? text.substring(k, k + 600) : '(HEM-TO-FLOOR section not found)';
    };

    return NextResponse.json({
      success: true,
      itemId: targetItemId,
      jobId: jobId || null,
      jobUpdated: !!targetJob,
      frontChars: (result.front || '').length,
      backChars: (result.back || '').length,
      hemFloorExcerptFront: excerpt(result.front || ''),
      hemFloorExcerptBack: excerpt(result.back || ''),
    });
  } catch (error: any) {
    console.error('[RefreshSilhouette] Error:', error);
    return NextResponse.json(
      { error: 'Refresh failed', details: String(error?.message || error) },
      { status: 500 }
    );
  }
}
