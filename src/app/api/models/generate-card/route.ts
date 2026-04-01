import { NextRequest, NextResponse } from 'next/server';
import { generateModelCard } from '@/lib/vertex';

// POST /api/models/generate-card — generate a model card image wearing G-Star underwear
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
