/**
 * GET /api/v2/search?q=<query>
 *
 * Global cmd-K search across jobs, wardrobe, and models.
 *
 * Strategy: pull bounded slices of each collection and filter in
 * memory. Firestore lacks full-text search natively and the datasets
 * are small enough that an in-memory filter on each request is fine
 * (~200 jobs, ~124 wardrobe, ~21 models — all well under one second).
 * Swap for Algolia / Typesense when the data grows past a few thousand.
 *
 * Response shape:
 *   {
 *     query: string,
 *     jobs:   [{ jobId, title, subtitle, href }],
 *     wardrobe: [{ wardrobeId, title, subtitle, href }],
 *     models: [{ modelId, title, subtitle, href }],
 *   }
 *
 * Each result has a uniform shape so the UI can render groups without
 * branching on entity type.
 *
 * 2026-05-27 (Phase 3 Slice 3C of dashboard redesign).
 */
import { NextRequest, NextResponse } from 'next/server';
import { jobsCol, wardrobeCol, modelsCol } from '@/lib/firestore';

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  rank: number;
}

interface SearchResponse {
  query: string;
  jobs: SearchHit[];
  wardrobe: SearchHit[];
  models: SearchHit[];
}

function matchRank(haystack: string | undefined, needle: string): number {
  // Higher = better. 0 = no match.
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  const idx = h.indexOf(n);
  if (idx === 0) return 70;
  if (idx > 0) return 50 - Math.min(idx, 40); // 10-50 based on position
  return 0;
}

function bestRank(values: Array<string | undefined>, needle: string): number {
  let best = 0;
  for (const v of values) {
    const r = matchRank(v, needle);
    if (r > best) best = r;
  }
  return best;
}

const LIMIT_PER_GROUP = 8;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return NextResponse.json<SearchResponse>({ query: q, jobs: [], wardrobe: [], models: [] });
    }

    // Pull bounded slices in parallel.
    const [jobsSnap, wardrobeSnap, modelsSnap] = await Promise.all([
      jobsCol.orderBy('createdAt', 'desc').limit(300).get(),
      wardrobeCol.limit(300).get(),
      modelsCol.limit(100).get(),
    ]);

    // Jobs — match against focusDesignNumber + focusDesignName + jobName + jobId.
    const jobs: SearchHit[] = [];
    for (const d of jobsSnap.docs) {
      const data = d.data() as any;
      if (data.archived) continue;
      const rank = bestRank(
        [data.focusDesignNumber, data.focusDesignName, data.focusName, data.jobName, d.id],
        q,
      );
      if (rank === 0) continue;
      const title = data.focusDesignNumber || data.jobName || d.id;
      const subtitle = data.focusDesignName || data.focusName || '';
      jobs.push({
        id: d.id,
        title,
        subtitle: subtitle ? `${subtitle} · job` : 'job',
        href: `/v2/jobs/${d.id}`,
        rank,
      });
    }

    // Wardrobe — match against name + designNumber + category.
    const wardrobe: SearchHit[] = [];
    for (const d of wardrobeSnap.docs) {
      const data = d.data() as any;
      const rank = bestRank(
        [data.name, data.designNumber, data.category, d.id],
        q,
      );
      if (rank === 0) continue;
      wardrobe.push({
        id: d.id,
        title: data.name || d.id,
        subtitle: [data.category, data.gender, data.designNumber].filter(Boolean).join(' · '),
        href: `/v2/wardrobe/${d.id}`,
        rank,
      });
    }

    // Models — match against modelId + name.
    const models: SearchHit[] = [];
    for (const d of modelsSnap.docs) {
      const data = d.data() as any;
      const rank = bestRank([d.id, data.name, data.modelId], q);
      if (rank === 0) continue;
      models.push({
        id: d.id,
        title: data.modelId || d.id,
        subtitle: [data.name, data.gender].filter(Boolean).join(' · '),
        href: `/models/${d.id}`,
        rank,
      });
    }

    const byRank = (a: SearchHit, b: SearchHit) => b.rank - a.rank;

    return NextResponse.json<SearchResponse>({
      query: q,
      jobs:     jobs.sort(byRank).slice(0, LIMIT_PER_GROUP),
      wardrobe: wardrobe.sort(byRank).slice(0, LIMIT_PER_GROUP),
      models:   models.sort(byRank).slice(0, LIMIT_PER_GROUP),
    });
  } catch (error) {
    console.error('[v2 search] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
