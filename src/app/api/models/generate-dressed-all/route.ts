import { NextRequest } from 'next/server';
import { listDressedBases, deleteDressedBase, type DressedView } from '@/lib/firestore';

/**
 * POST /api/models/generate-dressed-all
 *
 * Server-side auto-generation of all 4 dressed base views.
 * Streams progress via Server-Sent Events so the frontend can show live status.
 * Uses localhost loopback to call generate-dressed (bypasses Cloud Run IAM).
 *
 * Body: { modelId: string, wardrobeItemIds: Record<string, string>, replaceExisting?: boolean }
 */

const VIEWS_ORDER: DressedView[] = ['front', 'right', 'back', 'left'];

// Internal loopback base URL — Cloud Run sets PORT, Next.js dev uses 3000
function getInternalBase(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export async function POST(req: NextRequest) {
  let body: { modelId?: string; wardrobeItemIds?: Record<string, string>; replaceExisting?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { modelId, wardrobeItemIds, replaceExisting } = body;

  if (!modelId) {
    return new Response(JSON.stringify({ error: 'modelId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!wardrobeItemIds || Object.keys(wardrobeItemIds).length === 0) {
    return new Response(JSON.stringify({ error: 'wardrobeItemIds required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const internalBase = getInternalBase();

  // Forward auth cookies from the original request
  const cookieHeader = req.headers.get('cookie') || '';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream may have been closed by client
        }
      };

      // Log for Cloud Run debugging
      console.log(`[GenerateDressedAll] Starting all 4 views for model=${modelId} via ${internalBase}`);

      const results: Record<string, { status: string; qcScore?: number; qcPass?: boolean; error?: string; elapsed?: number }> = {};

      // 1. If replaceExisting, delete existing dressed bases for this model
      if (replaceExisting) {
        try {
          send({ status: 'cleanup', message: 'Removing existing dressed bases...' });
          const existing = await listDressedBases(modelId);
          for (const base of existing) {
            const baseData = base as { id?: string };
            if (baseData.id) {
              await deleteDressedBase(baseData.id);
            }
          }
          send({ status: 'cleanup_done', removed: existing.length });
          console.log(`[GenerateDressedAll] Cleaned up ${existing.length} existing bases`);
        } catch (err) {
          send({ status: 'cleanup_error', error: String(err).substring(0, 200) });
          console.error(`[GenerateDressedAll] Cleanup error:`, err);
        }
      }

      // 2. Generate each view sequentially — cascade completed views as color anchors
      // Front is generated first from wardrobe refs only, then each subsequent view
      // receives all previously completed views as color references to ensure
      // consistent garment shades across all 4 angles.
      const sharedSeed = Math.floor(Math.random() * 2147483647) + 1;
      console.log(`[GenerateDressedAll] Using shared seed ${sharedSeed} + cascading color anchors for cross-view consistency`);

      // Track completed view image URLs to pass as color anchors to subsequent views
      const completedViews: Array<{ url: string; view: string }> = [];

      for (const view of VIEWS_ORDER) {
        const startTime = Date.now();
        send({ view, status: 'generating', colorAnchors: completedViews.length });
        console.log(`[GenerateDressedAll] Starting ${view} view (${completedViews.length} color anchors)...`);

        try {
          const genUrl = `${internalBase}/api/models/generate-dressed`;
          const abortCtrl = new AbortController();
          const timeoutId = setTimeout(() => abortCtrl.abort(), 540_000);
          const genResponse = await fetch(genUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
            },
            signal: abortCtrl.signal,
            body: JSON.stringify({
              modelId,
              wardrobeItemIds,
              view,
              seed: sharedSeed,
              // Pass all previously completed views as color anchors
              ...(completedViews.length > 0 ? { previousViewImages: completedViews } : {}),
            }),
          });
          clearTimeout(timeoutId);

          const elapsed = Math.round((Date.now() - startTime) / 1000);

          if (genResponse.ok) {
            const genResult = await genResponse.json();
            results[view] = {
              status: 'done',
              qcScore: genResult.qcScore,
              qcPass: genResult.qcPass,
              elapsed,
            };
            // Add this view's image URL to the cascade for subsequent views
            if (genResult.imageUrl) {
              completedViews.push({ url: genResult.imageUrl, view });
            }
            send({ view, status: 'done', qcScore: genResult.qcScore, qcPass: genResult.qcPass, elapsed });
            console.log(`[GenerateDressedAll] ${view} done (QC=${genResult.qcScore}, ${elapsed}s) — now ${completedViews.length} color anchors`);
          } else {
            let errMsg = `HTTP ${genResponse.status}`;
            try {
              const errData = await genResponse.json();
              errMsg = errData.error || errMsg;
            } catch {
              try { errMsg += ': ' + (await genResponse.text()).substring(0, 200); } catch { /* */ }
            }
            results[view] = { status: 'failed', error: errMsg, elapsed };
            send({ view, status: 'failed', error: errMsg, elapsed });
            console.error(`[GenerateDressedAll] ${view} failed: ${errMsg}`);
            // Failed views don't get added to the cascade — next view still gets previous successes
          }
        } catch (err) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const errMsg = String(err).substring(0, 200);
          results[view] = { status: 'failed', error: errMsg, elapsed };
          send({ view, status: 'failed', error: errMsg, elapsed });
          console.error(`[GenerateDressedAll] ${view} error:`, err);
        }
      }

      // 3. Final summary
      const succeeded = Object.values(results).filter(r => r.status === 'done').length;
      const failed = Object.values(results).filter(r => r.status === 'failed').length;
      send({
        status: 'complete',
        succeeded,
        failed,
        total: VIEWS_ORDER.length,
        results,
      });

      console.log(`[GenerateDressedAll] Complete: ${succeeded}/${VIEWS_ORDER.length} succeeded`);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
