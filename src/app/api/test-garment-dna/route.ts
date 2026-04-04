/**
 * TEST ENDPOINT — /api/test-garment-dna
 *
 * Runs the dynamic garment construction analysis on ALL pants in the wardrobe.
 * Returns the full analysis results as JSON for review before wiring into generation.
 *
 * GET /api/test-garment-dna — analyze all pants
 * GET /api/test-garment-dna?id=WARDROBE_ID — analyze a specific wardrobe item
 *
 * TODO: Remove this endpoint after validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { wardrobeCol } from '@/lib/firestore';
import { downloadGarmentImage } from '@/lib/gcs';
import { analyzeGarmentConstruction } from '@/lib/garment-dna';

export const maxDuration = 120; // 2 min — analysis takes 1-3s per garment

export async function GET(req: NextRequest) {
  try {
    const specificId = req.nextUrl.searchParams.get('id');

    // Fetch wardrobe items
    let items: Array<{ id: string; data: any }> = [];
    if (specificId) {
      const doc = await wardrobeCol.doc(specificId).get();
      if (doc.exists) {
        items.push({ id: doc.id, data: doc.data() });
      } else {
        return NextResponse.json({ error: `Wardrobe item ${specificId} not found` }, { status: 404 });
      }
    } else {
      // Get all pants
      const snap = await wardrobeCol.where('category', '==', 'pants').get();
      items = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }

    console.log(`[TestDNA] Found ${items.length} pants to analyze`);

    const results: Array<{
      id: string;
      name: string;
      description: string;
      fitModelCount: number;
      hasFlatFront: boolean;
      hasFlatBack: boolean;
      analysis: any;
      error?: string;
      durationMs: number;
    }> = [];

    for (const item of items) {
      const startTime = Date.now();
      const name = item.data?.name || 'Unknown';
      const description = item.data?.description || '';
      console.log(`[TestDNA] Analyzing: ${name} (${item.id})...`);

      try {
        // Download fit model images
        const fitModelUrls: string[] = item.data?.fitModelUrls || [];
        const fitModelBuffers: Buffer[] = [];
        for (const url of fitModelUrls) {
          try {
            const buf = await downloadGarmentImage(url.split('?')[0]);
            fitModelBuffers.push(buf);
          } catch (err) {
            console.warn(`[TestDNA] Failed to download fit model image: ${url}`, err);
          }
        }

        // Download flat images
        let flatFrontBuffer: Buffer | null = null;
        let flatBackBuffer: Buffer | null = null;

        const flatFrontUrl = item.data?.flatFrontUrl || item.data?.flatImageUrl;
        const flatBackUrl = item.data?.flatBackUrl;

        if (flatFrontUrl) {
          try {
            flatFrontBuffer = await downloadGarmentImage(flatFrontUrl.split('?')[0]);
          } catch (err) {
            console.warn(`[TestDNA] Failed to download flat front:`, err);
          }
        }
        if (flatBackUrl) {
          try {
            flatBackBuffer = await downloadGarmentImage(flatBackUrl.split('?')[0]);
          } catch (err) {
            console.warn(`[TestDNA] Failed to download flat back:`, err);
          }
        }

        // Run analysis
        const analysis = await analyzeGarmentConstruction(
          fitModelBuffers,
          flatFrontBuffer,
          flatBackBuffer,
          description,
        );

        results.push({
          id: item.id,
          name,
          description: description.slice(0, 200),
          fitModelCount: fitModelBuffers.length,
          hasFlatFront: !!flatFrontBuffer,
          hasFlatBack: !!flatBackBuffer,
          analysis,
          durationMs: Date.now() - startTime,
        });

        console.log(`[TestDNA] ✓ ${name} — ${Date.now() - startTime}ms`);
      } catch (err: any) {
        results.push({
          id: item.id,
          name,
          description: description.slice(0, 200),
          fitModelCount: 0,
          hasFlatFront: false,
          hasFlatBack: false,
          analysis: null,
          error: err.message || String(err),
          durationMs: Date.now() - startTime,
        });
        console.error(`[TestDNA] ✗ ${name}:`, err);
      }
    }

    return NextResponse.json({
      totalItems: items.length,
      analyzedAt: new Date().toISOString(),
      results,
    }, { status: 200 });

  } catch (err: any) {
    console.error('[TestDNA] Fatal error:', err);
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
