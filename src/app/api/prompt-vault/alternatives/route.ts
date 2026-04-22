/**
 * GET /api/prompt-vault/alternatives?shotType=M02
 * List alternative prompts available for rerun buttons.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAlternativePrompts } from '@/lib/firestore';

export async function GET(req: NextRequest) {
  try {
    const shotType = req.nextUrl.searchParams.get('shotType');
    const pipeline = req.nextUrl.searchParams.get('pipeline') as 'gemini' | 'seedream' | null;
    if (!shotType) {
      return NextResponse.json({ error: 'shotType is required' }, { status: 400 });
    }
    const alternatives = await listAlternativePrompts(shotType, pipeline || undefined);
    return NextResponse.json({ alternatives });
  } catch (err: any) {
    console.error('[Alternatives GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
