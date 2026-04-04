/**
 * Prompt Vault — single prompt operations.
 * GET: view a specific prompt file
 * PATCH: set as active revision (revert)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPromptFile, setActivePromptRevision } from '@/lib/firestore';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prompt = await getPromptFile(id);
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }
    return NextResponse.json({ prompt });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get prompt', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    if (body.action === 'activate') {
      await setActivePromptRevision(id);
      return NextResponse.json({ success: true, message: 'Prompt revision activated' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update prompt', details: String(error) },
      { status: 500 }
    );
  }
}
