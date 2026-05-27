/**
 * GET /api/v2/jobs/[id]/shots/[shotType]
 *
 * Returns every version of one shot type for one job — the data shape
 * the v2 contact sheet ("barbie-doll fitting" view) renders.
 *
 * Response: {
 *   shotType,
 *   shotId,
 *   isWinner,
 *   status,
 *   versions: [{ version, imageUrl, createdAt, provider, isCurrent }],
 *   job: { jobId, focusDesignNumber, focusDesignName, modelName, ... }
 * }
 *
 * 2026-05-27 (Phase 3 Slice 3A of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJob, listShots, getModel } from '@/lib/firestore';

interface VersionEntry {
  version: number;
  imageUrl?: string;
  createdAt?: string;
  provider?: string;
  isCurrent: boolean;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; shotType: string }> },
) {
  try {
    const { id, shotType } = await params;
    const job = await getJob(id) as any;
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const shotsRaw = await listShots(id);
    const matches = shotsRaw.filter((s: any) => s.shotType === shotType);
    if (matches.length === 0) {
      return NextResponse.json({ error: `No ${shotType} shot on this job` }, { status: 404 });
    }
    matches.sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    const cur = matches[0] as any;

    // Combine previousVersions[] + current into a single descending list
    // (newest first feels right for review — most reviewers look at the
    // latest version they generated and work backward).
    const prev: VersionEntry[] = (cur.previousVersions || []).map((p: any) => ({
      version: p.version,
      imageUrl: p.imageUrl,
      createdAt: p.createdAt?.toDate?.()?.toISOString?.() ?? p.createdAt,
      provider: p.provider,
      isCurrent: false,
    }));
    const currentEntry: VersionEntry = {
      version: cur.version,
      imageUrl: cur.imageUrl,
      createdAt: cur.updatedAt?.toDate?.()?.toISOString?.() ?? cur.updatedAt ?? cur.createdAt,
      provider: cur.provider,
      isCurrent: true,
    };
    const versions = [currentEntry, ...prev]
      .filter(v => v.imageUrl || v.version)
      .sort((a, b) => (b.version || 0) - (a.version || 0));

    let modelName: string | undefined;
    if (job.modelId) {
      const m = await getModel(job.modelId) as any;
      modelName = m?.name || job.modelId;
    }

    return NextResponse.json({
      shotType,
      shotId: cur.id || cur.shotId,
      isWinner: cur.isWinner === true,
      status: cur.status,
      versions,
      job: {
        jobId: job.jobId || id,
        focusDesignNumber: job.focusDesignNumber,
        focusDesignName: job.focusDesignName,
        focusName: job.focusName,
        modelId: job.modelId,
        modelName,
      },
    });
  } catch (error) {
    console.error('[v2 contact sheet] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
