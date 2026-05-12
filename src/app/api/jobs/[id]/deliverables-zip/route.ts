/**
 * GET /api/jobs/[id]/deliverables-zip?format=pdp|plp
 *
 * Streams a .zip of all deliverable images (M01, M02, M05, M06) for a job in
 * the requested format. Pulls the pdpUrl/plpUrl off each shot doc and fetches
 * the images from GCS.
 *
 * Filenames inside the zip: <jobName>_<shotType>_<format>.jpg
 *   e.g.  "CONTOR 3D EXTREME LOOSE WMN_M01_PDP.jpg"
 *
 * Returns 404 if no deliverables are available yet (e.g. job hasn't run, or
 * pre-deliverable-formatter shots that don't have the URLs cached). Returns
 * 400 on a bad format param.
 *
 * Implementation notes:
 *   - Uses the in-repo tiny-zip helper (no archiver dep — sandbox can't install).
 *   - STORED method (no compression). JPEGs are already entropy-compressed so
 *     DEFLATE buys ~0% and burns CPU/memory.
 *   - Buffers everything in memory before responding. For 4–6 deliverables at
 *     ~600 KB (PLP) or ~2 MB (PDP) each, that's a few MB total — well within
 *     Cloud Run limits. Streaming would be a future optimization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJob, listShots } from '@/lib/firestore';
import { buildZip } from '@/lib/tiny-zip';

const DELIVERABLE_TYPES = new Set(['M01', 'M02', 'M05', 'M06']);

function sanitizeForFilename(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: jobId } = await params;
    const format = (req.nextUrl.searchParams.get('format') || '').toLowerCase();
    if (format !== 'pdp' && format !== 'plp') {
      return NextResponse.json(
        { error: 'Query param "format" must be "pdp" or "plp"' },
        { status: 400 },
      );
    }
    const urlField = format === 'pdp' ? 'pdpUrl' : 'plpUrl';

    const job = await getJob(jobId) as any;
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    const shots = (await listShots(jobId)) as any[];

    // Filter to deliverable shots that have a URL for the requested format.
    const targets = shots.filter(
      s => DELIVERABLE_TYPES.has(s.shotType) && typeof s[urlField] === 'string' && s[urlField],
    );
    if (targets.length === 0) {
      return NextResponse.json(
        { error: `No ${format.toUpperCase()} deliverables available for this job yet. Run the deliverable-formatter pipeline first.` },
        { status: 404 },
      );
    }

    // Sort in canonical shot order so the zip lists shots in a predictable order.
    const order = ['M01', 'M02', 'M05', 'M06'];
    targets.sort((a, b) => order.indexOf(a.shotType) - order.indexOf(b.shotType));

    const jobName = sanitizeForFilename(job.jobName || job.designNumber || jobId);
    const formatLabel = format.toUpperCase();

    // Fetch all images in parallel.
    const downloads = await Promise.all(
      targets.map(async s => {
        const url = s[urlField] as string;
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const name = `${jobName}_${s.shotType}_${formatLabel}.jpg`;
        return { name, data: buf };
      }),
    );

    const zipBuf = buildZip(downloads);
    const zipFilename = `${jobName}_${formatLabel}.zip`;

    // Wrap the Buffer in a Blob so NextResponse's BodyInit overload accepts it
    // cleanly under both Node and Edge runtime type definitions.
    const body = new Blob([new Uint8Array(zipBuf)], { type: 'application/zip' });
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBuf.length),
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[DeliverablesZip GET]', err);
    return NextResponse.json(
      { error: 'Failed to build zip', details: err?.message || String(err) },
      { status: 500 },
    );
  }
}
