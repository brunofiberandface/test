/**
 * GET /api/label/templates/[templateId] → { template }
 */
import { NextResponse } from 'next/server';
import { getLabelTemplate } from '@/lib/firestore';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const { templateId } = await params;
    const template = await getLabelTemplate(templateId);
    if (!template) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (err: unknown) {
    console.error('[LabelTemplate GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
