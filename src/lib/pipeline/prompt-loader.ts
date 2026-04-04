/**
 * Prompt loader — reads active .md files from the golden vault
 * and extracts the silhouette + generation prompts.
 *
 * The .md files contain prompts in fenced code blocks.
 * The loader extracts:
 * - Step 1 prompt (silhouette analysis) — from "## Step 1 Prompt" section
 * - Step 2 prompt (generation) — from "## Step 2 Prompt" or "## Prompt" section
 *
 * The generation prompt contains {silhouette} placeholder that gets replaced
 * at generation time with the Flash Lite analysis output.
 */
import { getActivePrompt } from '@/lib/firestore';
import type { ShotType } from '@/types';

export interface LoadedPrompt {
  generationPrompt: string;
  silhouettePrompt: string | null;  // null for shots without silhouette (M05)
  revision: number;
  shotType: ShotType;
}

/**
 * Extract prompt text from a fenced code block in markdown.
 * Looks for the first ``` block after the given section header.
 */
function extractPromptFromSection(content: string, sectionHeader: string): string | null {
  const headerIdx = content.indexOf(sectionHeader);
  if (headerIdx === -1) return null;

  const afterHeader = content.substring(headerIdx);

  // Find the first code block after the header
  const codeStart = afterHeader.indexOf('```\n');
  if (codeStart === -1) return null;

  const contentAfterFence = afterHeader.substring(codeStart + 4);
  const codeEnd = contentAfterFence.indexOf('\n```');
  if (codeEnd === -1) return null;

  return contentAfterFence.substring(0, codeEnd).trim();
}

/**
 * Load and parse the active prompt for a shot type.
 * Falls back to pre-extracted prompts if parsing fails.
 */
export async function loadPrompt(shotType: ShotType, category?: string): Promise<LoadedPrompt> {
  const promptFile = await getActivePrompt(shotType, category);

  if (!promptFile) {
    throw new Error(`No active prompt found for shot type ${shotType}${category ? ` (category: ${category})` : ''}`);
  }

  const content = promptFile.content as string;

  // Try to extract from markdown structure
  let generationPrompt = extractPromptFromSection(content, '## Step 2 Prompt')
    || extractPromptFromSection(content, '## Prompt')
    || promptFile.generationPrompt;

  let silhouettePrompt = extractPromptFromSection(content, '## Step 1 Prompt')
    || promptFile.silhouettePrompt
    || null;

  if (!generationPrompt) {
    throw new Error(`Could not extract generation prompt from ${shotType} prompt file (revision ${promptFile.revision})`);
  }

  console.log(`[PromptLoader] Loaded ${shotType} rev${promptFile.revision}: gen=${generationPrompt.length}chars, sil=${silhouettePrompt?.length || 0}chars`);

  return {
    generationPrompt,
    silhouettePrompt,
    revision: promptFile.revision as number,
    shotType,
  };
}

/**
 * Load all 5 shot prompts at once. Returns a map keyed by shot type.
 */
export async function loadAllPrompts(category?: string): Promise<Record<ShotType, LoadedPrompt>> {
  const shotTypes: ShotType[] = ['M01', 'M02', 'M03', 'M04', 'M05'];

  const results = await Promise.all(
    shotTypes.map(st => loadPrompt(st, category))
  );

  const map: Record<string, LoadedPrompt> = {};
  for (const r of results) {
    map[r.shotType] = r;
  }
  return map as Record<ShotType, LoadedPrompt>;
}

/**
 * Inject silhouette analysis into a generation prompt.
 */
export function injectSilhouette(prompt: string, silhouette: string): string {
  return prompt.replace('{silhouette}', silhouette);
}
