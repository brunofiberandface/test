/**
 * GET /api/label/image-proxy?url=...
 *
 * Server-side image proxy so the client can read pixels off a GCS-hosted
 * wardrobe photo via canvas without tripping CORS. Only used by the
 * label-setup UI — not a general purpose bypass.
 *
 * Restricts to http(s) URLs. No redirects, no caching headers — the
 * browser can cache as normal based on upstream.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'only http(s) URLs allowed' }, { status: 400 });
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status} ${upstream.statusText}` },
        { status: upstream.status },
      );
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: unknown) {
    console.error('[LabelImageProxy]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
