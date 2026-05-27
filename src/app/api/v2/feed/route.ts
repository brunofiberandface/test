/**
 * GET /api/v2/feed
 *
 * Returns jobs enriched with everything the new chronological feed needs:
 *   - Job metadata (id, jobName, design code/name, drop-related fields, status)
 *   - Focus garment thumbnail + category
 *   - Model name + headshot/reference image URL
 *   - For each shotType (M01 / M02 / M03 / M05): current imageUrl, version,
 *     isWinner flag, status, total version count (current + previousVersions).
 *
 * Independent of /api/jobs (which the Classic dashboard uses). Lets the
 * Phase 1 v2 feed render without forking the legacy enrichment.
 *
 * Query params:
 *   limit=<n>           — default 100, cap 500.
 *   includeArchived=true
 *
 * 2026-05-27 (Phase 1 Slice 1B of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { listJobs, listShots, getModel, getWardrobeItem } from '@/lib/firestore';
import { APP_CONFIG } from '@/lib/config';

interface ShotSummary {
  shotType: string;
  shotId?: string;
  imageUrl?: string;
  version?: number;
  totalVersions?: number;
  status?: string;
  isWinner?: boolean;
}

interface FeedJob {
  id: string;
  jobId: string;
  jobName?: string;
  jobNumber?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  creatorEmail?: string;
  archived?: boolean;
  focusDesignNumber?: string;
  focusDesignName?: string;
  focusName?: string;
  focusCategory?: string;
  focusFitModelFrontUrl?: string;
  modelId?: string;
  modelName?: string;
  modelReferenceImageUrl?: string;
  shots: Record<string, ShotSummary>; // keyed by shotType
  winnerCount: number;
  totalShotTypes: number;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const limitParam = searchParams.get('limit');
    // Default 30 (fast first paint). Cap at 500 if the caller explicitly asks.
    const limit = Math.max(1, Math.min(500, limitParam ? Number(limitParam) : 30));

    // Date range filter — 7d / 30d / 90d / absent (no filter). Applied
    // on updatedAt with fallback to createdAt so in-progress jobs
    // surface in recent windows even if they were created earlier.
    const dateRange = searchParams.get('dateRange');
    const daysCutoff = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 0;
    const cutoffMs = daysCutoff > 0 ? Date.now() - daysCutoff * 24 * 60 * 60 * 1000 : 0;

    const { jobs: rawJobs } = await listJobs(undefined, { limit });
    let visible = includeArchived ? rawJobs : rawJobs.filter((j: any) => !j.archived);
    if (cutoffMs > 0) {
      visible = visible.filter((j: any) => {
        const ts = j.updatedAt || j.createdAt;
        if (!ts) return true;
        return new Date(ts).getTime() >= cutoffMs;
      });
    }

    const activeShotTypes = APP_CONFIG.shotTypes as readonly string[];

    // Small per-request caches to avoid refetching the same model / wardrobe
    // doc across N jobs that share them.
    const modelCache = new Map<string, any>();
    const wardrobeCache = new Map<string, any>();
    const getModelCached = async (id: string) => {
      if (modelCache.has(id)) return modelCache.get(id);
      const m = await getModel(id);
      modelCache.set(id, m);
      return m;
    };
    const getWardrobeCached = async (id: string) => {
      if (wardrobeCache.has(id)) return wardrobeCache.get(id);
      const w = await getWardrobeItem(id);
      wardrobeCache.set(id, w);
      return w;
    };

    const feed: FeedJob[] = await Promise.all(visible.map(async (job: any) => {
      const jobId = job.jobId || job.id;

      // Resolve focus garment + category from wardrobe.
      let focusDesignNumber = job.focusDesignNumber as string | undefined;
      let focusDesignName = job.focusDesignName as string | undefined;
      let focusName = job.focusName as string | undefined;
      let focusCategory = job.focusCategory as string | undefined;
      let focusFitModelFrontUrl = job.focusFitModelFrontUrl as string | undefined;

      const w = job.wardrobe;
      if (w && (!focusFitModelFrontUrl || !focusDesignNumber)) {
        const focusEntry =
          [w.shoe, w.top, w.bottom].find((slot: any) => slot?.isFocus) || w.bottom;
        if (focusEntry?.itemId) {
          const item = await getWardrobeCached(focusEntry.itemId) as any;
          if (item) {
            const fullName: string = item.name || '—';
            const m = fullName.match(/^(D\d+[-\w]+)\s+(.+)$/);
            if (m) {
              focusDesignNumber = focusDesignNumber || m[1];
              focusDesignName = focusDesignName || m[2];
            } else if (item.designNumber) {
              focusDesignNumber = focusDesignNumber || item.designNumber;
              focusDesignName = focusDesignName || fullName;
            } else {
              focusDesignName = focusDesignName || fullName;
            }
            focusName = focusName || fullName;
            focusCategory = focusCategory || item.category || '—';
            focusFitModelFrontUrl = focusFitModelFrontUrl
              || item.fitModels?.front
              || item.fitModelFrontUrl
              || item.thumbnailUrl
              || item.flatFrontUrl
              || (Array.isArray(item.fitModelUrls) ? item.fitModelUrls[0] : undefined)
              || '';
          }
        }
      }

      // Resolve model.
      let modelName = job.modelName as string | undefined;
      let modelReferenceImageUrl: string | undefined;
      if (job.modelId) {
        const m = await getModelCached(job.modelId) as any;
        if (m) {
          modelName = modelName || m.name || job.modelId;
          modelReferenceImageUrl = m.referenceImageUrl;
        }
      }

      // Build per-shot-type summary.
      const shotsRaw = await listShots(jobId);
      const shotsByType: Record<string, ShotSummary> = {};
      let winnerCount = 0;
      for (const st of activeShotTypes) {
        // Pick the most-recent shot doc for this type. listShots returns all
        // historical docs for the job; the one whose version is highest is
        // current. Defensive: fall back to first match if version is missing.
        const matches = shotsRaw.filter((s: any) => s.shotType === st);
        if (matches.length === 0) {
          shotsByType[st] = { shotType: st };
          continue;
        }
        matches.sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        const cur = matches[0] as any;
        const totalVersions = (cur.previousVersions?.length || 0) + 1;
        shotsByType[st] = {
          shotType: st,
          shotId: cur.id || cur.shotId,
          imageUrl: cur.imageUrl,
          version: cur.version,
          totalVersions,
          status: cur.status,
          isWinner: cur.isWinner === true,
        };
        if (cur.isWinner === true) winnerCount++;
      }

      const result: FeedJob = {
        id: job.id,
        jobId,
        jobName: job.jobName,
        jobNumber: job.jobNumber,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        creatorEmail: job.creatorEmail,
        archived: job.archived,
        focusDesignNumber,
        focusDesignName,
        focusName,
        focusCategory,
        focusFitModelFrontUrl,
        modelId: job.modelId,
        modelName,
        modelReferenceImageUrl,
        shots: shotsByType,
        winnerCount,
        totalShotTypes: activeShotTypes.length,
      };
      return result;
    }));

    return NextResponse.json({ jobs: feed });
  } catch (error) {
    console.error('[v2 feed] Failed:', error);
    return NextResponse.json({ error: 'Failed to load feed' }, { status: 500 });
  }
}
