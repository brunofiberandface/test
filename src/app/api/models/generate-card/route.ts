/**
 * POST /api/models/generate-card
 *
 * Generate a model card image from a text description (no identity anchor).
 * Used by /models/new to create the FIRST reference image for a brand-new
 * model. Returns base64-encoded PNG; the caller previews it and posts it
 * back through POST /api/models when the user clicks "Approve & Save".
 *
 * RESTORED 2026-05-10 from commit d2cb22c^ (deleted in d2cb22c "v2 Pro
 * pipeline" rewrite, April 4 2026). Every existing model in the system was
 * originally created via this path. Per Bruno: "i want the same as how they
 * were created."
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateModelCard } from '@/lib/vertex';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description, gender } = body;

    if (!description || !gender) {
      return NextResponse.json({ error: 'Description and gender required' }, { status: 400 });
    }

    const imageBase64 = await generateModelCard(description, gender);

    if (!imageBase64) {
      return NextResponse.json({ error: 'Image generation failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, image: imageBase64 });
  } catch (error) {
    console.error('Error generating model card:', error);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
