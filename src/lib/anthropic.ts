/**
 * Anthropic Claude client for vision analysis.
 * Used for silhouette A/B testing against Gemini Flash Lite.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeAnalyzeParams {
  prompt: string;
  images: Array<{ buffer: Buffer; mimeType: string }>;
  model?: 'claude-sonnet-4-6' | 'claude-opus-4-6';
  temperature?: number;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Run vision analysis via Claude (Sonnet or Opus).
 * Same interface as analyzeWithFlashLite — takes images + text prompt, returns text.
 */
export async function analyzeWithClaude(params: ClaudeAnalyzeParams): Promise<string> {
  const {
    prompt,
    images,
    model = 'claude-sonnet-4-6',
    temperature = 0.3,
  } = params;

  const client = getClient();

  // Build content blocks: images first, then text prompt
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: img.buffer.toString('base64'),
      },
    });
  }

  content.push({ type: 'text', text: prompt });

  console.log(`[Claude] Analyzing: model=${model}, images=${images.length}`);
  const startMs = Date.now();

  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    temperature,
    messages: [{ role: 'user', content }],
  });

  const elapsed = Date.now() - startMs;
  console.log(`[Claude] ${model} responded in ${elapsed}ms`);

  // Extract text from response
  const textBlocks = message.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  return textBlocks.map(b => b.text).join('\n');
}
