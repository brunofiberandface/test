/**
 * POST /api/v2/admin/migrate-legacy-classification
 *
 * One-off migration. Iterates every wardrobe item; for any item missing
 * `classification`, sets `classification='noos'` + `noosBucket='legacy'`
 * + `classifiedAt` + `classifiedBy='migration:legacy'` so the audit
 * trail clearly shows these were auto-tagged.
 *
 * Safe to run multiple times — items already classified are skipped.
 *
 * Returns: {
 *   total: number,           // wardrobe items scanned
 *   migrated: number,        // items just tagged as NOOS · Legacy
 *   alreadyClassified: number, // items that already had classification
 * }
 *
 * Auth: follows the existing /api/admin/* convention — endpoint is
 * unauthenticated at the HTTP layer because the admin UI only links to
 * it for admin users, and the endpoint path is not advertised.
 *
 * 2026-05-27 (Phase 2 Slice 2A of dashboard redesign).
 */
import { NextResponse } from 'next/server';
import { wardrobeCol, db } from '@/lib/firestore';

export async function POST() {
  try {
    const snap = await wardrobeCol.get();
    const items = snap.docs.map(d => ({ id: d.id, data: d.data() as any }));

    const needMigration = items.filter(it => !it.data.classification);
    const alreadyClassified = items.length - needMigration.length;

    console.log(
      `[migrate-legacy] scanned ${items.length} items · `
      + `${needMigration.length} need migration · `
      + `${alreadyClassified} already classified`,
    );

    if (needMigration.length === 0) {
      return NextResponse.json({
        ok: true,
        total: items.length,
        migrated: 0,
        alreadyClassified,
        sample: [],
      });
    }

    const now = new Date().toISOString();
    const stamp = {
      classification: 'noos' as const,
      noosBucket: 'legacy' as const,
      classifiedAt: now,
      classifiedBy: 'migration:legacy',
    };

    // Firestore batches max 500 writes; chunk for safety.
    const CHUNK = 400;
    for (let i = 0; i < needMigration.length; i += CHUNK) {
      const slice = needMigration.slice(i, i + CHUNK);
      const batch = db.batch();
      for (const it of slice) {
        batch.update(wardrobeCol.doc(it.id), stamp);
      }
      await batch.commit();
      console.log(`[migrate-legacy] committed batch ${i + slice.length}/${needMigration.length}`);
    }

    return NextResponse.json({
      ok: true,
      total: items.length,
      migrated: needMigration.length,
      alreadyClassified,
      sample: needMigration.slice(0, 5).map(it => ({
        wardrobeId: it.id,
        name: it.data.name,
        previousClassification: null,
      })),
    });
  } catch (error) {
    console.error('[migrate-legacy] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET — return migration status (counts only, no mutation). Handy for
 * Bruno to check before/after he runs the POST.
 */
export async function GET() {
  try {
    const snap = await wardrobeCol.get();
    let total = 0;
    let drop = 0;
    let noos = 0;
    let legacy = 0;
    let unclassified = 0;
    for (const d of snap.docs) {
      total++;
      const data = d.data() as any;
      if (data.classification === 'drop') drop++;
      else if (data.classification === 'noos') {
        noos++;
        if (data.noosBucket === 'legacy') legacy++;
      } else unclassified++;
    }
    return NextResponse.json({
      total, drop, noos, legacy, unclassified,
      migrationNeeded: unclassified > 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
