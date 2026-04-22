/**
 * GET  /api/label/templates                → { templates: LabelTemplate[] }
 * POST /api/label/templates  { template }  → { ok: true }
 *
 * Tier 1 of the three-tier hybrid-label schema.
 * See ADR-001 in /label_POC/ADR-001-leather-label.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  listLabelTemplates,
  upsertLabelTemplate,
} from '@/lib/firestore';

export async function GET() {
  try {
    const templates = await listLabelTemplates();
    return NextResponse.json({ templates });
  } catch (err: unknown) {
    console.error('[LabelTemplates GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const t = body?.template;
    if (
      !t ||
      typeof t.templateId !== 'string' ||
      typeof t.artworkUrl !== 'string' ||
      typeof t.aspectRatio !== 'number' ||
      !t.materialTileUrls ||
      typeof t.materialTileUrls !== 'object'
    ) {
      return NextResponse.json(
        {
          error:
            'body.template must be { templateId, artworkUrl, aspectRatio, materialTileUrls, name? }',
        },
        { status: 400 },
      );
    }
    await upsertLabelTemplate({
      templateId: t.templateId,
      name: t.name,
      artworkUrl: t.artworkUrl,
      materialTileUrls: t.materialTileUrls,
      aspectRatio: t.aspectRatio,
    });
    return NextResponse.json({ ok: true, templateId: t.templateId });
  } catch (err: unknown) {
    console.error('[LabelTemplates POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
