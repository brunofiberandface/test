/**
 * Prompt Vault API — list prompts and upload new revisions.
 * Admin-only access.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listPromptFiles, uploadPromptFile } from '@/lib/firestore';
import { uploadGeneratedImage } from '@/lib/gcs';

// GET /api/prompt-vault — list all prompt files
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shotType = searchParams.get('shotType') || undefined;
    const prompts = await listPromptFiles(shotType);
    return NextResponse.json({ prompts });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list prompts', details: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/prompt-vault — upload a new prompt file
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const shotType = formData.get('shotType') as string;
    const category = formData.get('category') as string | null;
    const uploadedBy = formData.get('uploadedBy') as string;

    if (!file || !shotType || !uploadedBy) {
      return NextResponse.json(
        { error: 'Missing required fields: file, shotType, uploadedBy' },
        { status: 400 }
      );
    }

    // Read file content
    const content = await file.text();
    const filename = file.name;

    // Upload .md file to GCS as backup
    const gcsBuffer = Buffer.from(content, 'utf-8');
    const gcsUrl = await uploadGeneratedImage(
      'prompt-vault',
      `${shotType}_rev_${Date.now()}.md`,
      gcsBuffer
    );

    // Extract prompts from markdown (best effort)
    const silhouettePrompt = extractPromptSection(content, '## Step 1 Prompt');
    const generationPrompt = extractPromptSection(content, '## Step 2 Prompt')
      || extractPromptSection(content, '## Prompt');

    // Store in Firestore
    const result = await uploadPromptFile({
      filename,
      shotType,
      category: category || undefined,
      content,
      gcsUrl,
      uploadedBy,
      silhouettePrompt: silhouettePrompt || undefined,
      generationPrompt: generationPrompt || undefined,
    });

    return NextResponse.json({
      success: true,
      id: result.id,
      revision: result.revision,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to upload prompt', details: String(error) },
      { status: 500 }
    );
  }
}

function extractPromptSection(content: string, header: string): string | null {
  const idx = content.indexOf(header);
  if (idx === -1) return null;
  const after = content.substring(idx);
  const codeStart = after.indexOf('```\n');
  if (codeStart === -1) return null;
  const rest = after.substring(codeStart + 4);
  const codeEnd = rest.indexOf('\n```');
  if (codeEnd === -1) return null;
  return rest.substring(0, codeEnd).trim();
}
