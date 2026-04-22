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
import { getActivePrompt, getPromptFile } from '@/lib/firestore';
import type { ShotType } from '@/types';

export interface LoadedPrompt {
  generationPrompt: string;
  silhouettePrompt: string | null;  // null for shots without silhouette (M05)
  revision: number;
  shotType: ShotType;
  modelOverride?: string;  // Alternative can override the generation model
  aspectOverride?: string; // Alternative can override the aspect ratio (e.g. '3:4' instead of '9:16')
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
export async function loadPrompt(shotType: ShotType, category?: string, pipeline?: 'gemini' | 'seedream'): Promise<LoadedPrompt> {
  const promptFile = await getActivePrompt(shotType, category, pipeline);

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
 * Load a specific prompt by its Firestore document ID (for alternative prompt reruns).
 */
export async function loadPromptById(promptId: string): Promise<LoadedPrompt> {
  const promptFile = await getPromptFile(promptId) as any;

  if (!promptFile) {
    throw new Error(`Prompt not found: ${promptId}`);
  }

  const content = promptFile.content as string;

  const generationPrompt = extractPromptFromSection(content, '## Step 2 Prompt')
    || extractPromptFromSection(content, '## Prompt')
    || promptFile.generationPrompt;

  const silhouettePrompt = extractPromptFromSection(content, '## Step 1 Prompt')
    || promptFile.silhouettePrompt
    || null;

  if (!generationPrompt) {
    throw new Error(`Could not extract generation prompt from alternative prompt ${promptId}`);
  }

  console.log(`[PromptLoader] Loaded alternative prompt ${promptId} (${promptFile.label || promptFile.filename}): gen=${generationPrompt.length}chars`);

  return {
    generationPrompt,
    silhouettePrompt,
    revision: promptFile.revision as number,
    shotType: promptFile.shotType,
    ...(promptFile.modelOverride ? { modelOverride: promptFile.modelOverride } : {}),
    ...(promptFile.aspectOverride ? { aspectOverride: promptFile.aspectOverride } : {}),
  };
}

/**
 * Load all 5 shot prompts at once. Returns a map keyed by shot type.
 */
export async function loadAllPrompts(category?: string, pipeline?: 'gemini' | 'seedream'): Promise<Record<ShotType, LoadedPrompt>> {
  const shotTypes: ShotType[] = ['M01', 'M02', 'M03', 'M04', 'M05'];

  const results = await Promise.all(
    shotTypes.map(st => loadPrompt(st, category, pipeline))
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

/**
 * Inject styling descriptions (top + shoes) into a generation prompt.
 * Replaces {top_description} and {shoes_description} placeholders.
 * If no description is provided, falls back to "match the Top/Shoes Reference image".
 * Keep fallbacks short — they may appear inline in sentences.
 */
export function injectStylingDescriptions(
  prompt: string,
  topDescription: string,
  shoesDescription: string,
): string {
  const topText = topDescription || 'as shown in the Top Reference image';
  const shoesText = shoesDescription || 'as shown in the Shoes Reference image';
  return prompt
    .replace(/{top_description}/g, topText)
    .replace(/{shoes_description}/g, shoesText);
}

/**
 * Inject gender-specific language into a generation prompt.
 * Replaces {gender}, {gender_pronoun}, {gender_possessive}, and {gender_pose} placeholders.
 */
export function injectGender(prompt: string, gender: 'male' | 'female'): string {
  const isMale = gender === 'male';
  return prompt
    .replace(/{gender}/g, isMale ? 'Male' : 'Female')
    .replace(/{gender_pronoun}/g, isMale ? 'he' : 'she')
    .replace(/{gender_possessive}/g, isMale ? 'his' : 'her')
    .replace(/{gender_pose}/g, isMale
      ? 'E-commerce standard masculine stance. Relaxed, confident posture with weight on one leg. Hands naturally at sides. Shoulders square. Expression neutral and composed.'
      : 'E-commerce standard feminine stance. Slight hip tilt, soft bend in one knee, weight shifted to one leg. Hands relaxed at sides or lightly resting on the hip. Ensure a slight 3/4 body angle to display the garment\'s 3D fit. Expression is confident, relaxed, with lips together.');
}

/**
 * Inject garment type into a generation prompt.
 * Replaces {garment_type} placeholder with the actual garment category.
 */
export function injectGarmentType(prompt: string, garmentType: string): string {
  return prompt.replace(/{garment_type}/g, garmentType || 'Pants');
}
