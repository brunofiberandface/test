import { NextRequest, NextResponse } from 'next/server';
import { shotsCol, jobsCol } from '@/lib/firestore';
import { downloadGarmentImage } from '@/lib/gcs';
import { runShotQC } from '@/lib/shot-qc';

/**
 * POST /api/qc — Run QC on an already-generated shot.
 *
 * Body: { shotId, jobId }
 *
 * Returns QC scores and stores them on the shot document.
 * This endpoint is for manual/on-demand QC re-runs — the pipeline
 * also runs QC automatically during generation.
 */
export async function POST(req: NextRequest) {
  try {
    const { shotId, jobId } = await req.json();
    if (!shotId || !jobId) {
      return NextResponse.json({ error: 'shotId and jobId are required' }, { status: 400 });
    }

    // Load shot data
    const shotDoc = await shotsCol.doc(shotId).get();
    const shotData = shotDoc.data();
    if (!shotData?.imageUrl) {
      return NextResponse.json({ error: 'Shot has no generated image' }, { status: 400 });
    }

    // Load job data for flat images and metadata
    const jobDoc = await jobsCol.doc(jobId).get();
    const jobData = jobDoc.data();
    if (!jobData) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const shotType = shotData.shotType || 'M03';
    const isBackShot = shotType === 'M02' || shotType === 'M04' || shotType === 'M05';

    // Download generated image
    const generatedBuffer = await downloadGarmentImage(shotData.imageUrl.split('?')[0]);

    // Download appropriate flat image
    let flatBuffer: Buffer | null = null;
    const flatUrl = isBackShot
      ? (jobData.flatBackUrl || '')
      : (jobData.flatFrontUrl || jobData.flatImageUrl || '');

    if (flatUrl) {
      try {
        flatBuffer = await downloadGarmentImage(flatUrl.split('?')[0]);
      } catch (flatErr) {
        console.error(`[QC] Failed to download flat image:`, flatErr);
      }
    }

    // Run QC
    const jobMeta = jobData.metadata || {};
    const qcResult = await runShotQC({
      generatedImageBuffer: generatedBuffer,
      flatImageBuffer: flatBuffer,
      shotType,
      garmentDescription: shotData.prompt || jobData.designNumber || '',
      metadata: {
        waistHeight: jobMeta.waistHeight || '',
        floorDistance: jobMeta.floorDistance || '',
      },
    });

    // Store on shot document
    await shotsCol.doc(shotId).update({
      qcPass: qcResult.overallPass,
      qcScore: qcResult.overallScore,
      qcDetails: {
        layer1: qcResult.layer1,
        layer2: qcResult.layer2 ? {
          colorMatch: qcResult.layer2.colorMatch.score,
          seamFidelity: qcResult.layer2.seamFidelity.score,
          pocketAccuracy: qcResult.layer2.pocketAccuracy.score,
          silhouetteMatch: qcResult.layer2.silhouetteMatch.score,
          lengthCorrect: qcResult.layer2.lengthCorrect.score,
          backgroundCheck: qcResult.layer2.backgroundCheck.score,
          weightedScore: qcResult.layer2.weightedScore,
          summary: qcResult.layer2.summary,
          criticalIssues: qcResult.layer2.criticalIssues,
        } : null,
      },
      qcTimestamp: qcResult.timestamp,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      shotId,
      qc: {
        pass: qcResult.overallPass,
        score: qcResult.overallScore,
        layer1: qcResult.layer1,
        layer2: qcResult.layer2,
      },
    });
  } catch (error) {
    console.error('[QC] Error:', error);
    return NextResponse.json(
      { error: 'QC check failed', details: String(error) },
      { status: 500 }
    );
  }
}
