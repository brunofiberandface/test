/**
 * v2 migration: Fix base prompts to use {top_description} and {shoes_description}
 * only in standalone styling lines. Inline references get clean generic text.
 *
 * This rebuilds the active base prompts from their rev 1 (original) copies,
 * then applies clean, surgical replacements.
 *
 * POST /api/prompt-vault/migrate-styling
 */
import { NextResponse } from 'next/server';
import { promptVaultCol, db } from '@/lib/firestore';

// Surgical replacements: [pattern, replacement]
// Only replace text that makes grammatical sense with the placeholder
const REPLACEMENTS: Array<[string | RegExp, string]> = [
  // Standalone styling lines (these get the placeholder)
  ['* Top: Light grey heather cropped baby t-shirt, completely tucked into the pants to reveal the full waistband.', '* Top: {top_description}'],
  ['* Top: Light grey heather cropped baby t-shirt matching the top reference.', '* Top: {top_description}'],
  ['* Top: Light grey heather cropped baby t-shirt', '* Top: {top_description}'],
  ['* Top: {top_description}, completely tucked into the pants to reveal the full waistband.', '* Top: {top_description}'],
  ['* Top: {top_description} matching the top reference.', '* Top: {top_description}'],

  ['* Footwear: White leather sneakers matching the shoe reference.', '* Footwear: {shoes_description}'],
  ['* Footwear: White leather sneakers matching the shoe reference', '* Footwear: {shoes_description}'],
  ['* Footwear: White leather sneakers', '* Footwear: {shoes_description}'],
  ['* Footwear: {shoes_description} matching the shoe reference.', '* Footwear: {shoes_description}'],
  ['* Footwear: {shoes_description} (Image 6).', '* Footwear: {shoes_description} (Image 6).'], // keep as-is if already good

  // Table rows — keep short
  ['| 2000 | Grey cropped baby t-shirt |', '| 2000 | Selected top |'],
  ['| 2000 | {top_description} |', '| 2000 | Selected top |'],
  ['| 2000 | White leather sneakers |', '| 2000 | Selected shoes |'],
  ['| 2000 | {shoes_description} |', '| 2000 | Selected shoes |'],

  // Reference image labels
  ['Top Reference (Grey Baby T-shirt)', 'Top Reference'],
  ['Top Reference (Grey baby T-shirt)', 'Top Reference'],
  ['Top Reference (see selected top)', 'Top Reference'],
  ['Shoes Reference (White Sneakers)', 'Shoes Reference'],
  ['Shoes Reference (white sneakers)', 'Shoes Reference'],
  ['Shoes Reference (see selected shoes)', 'Shoes Reference'],

  // Inline framing references — keep natural language, no placeholder
  ['A sliver of the {top_description} hem visible', 'A sliver of the top hem visible'],
  ['A sliver of the grey t-shirt hem visible', 'A sliver of the top hem visible'],
  ['A sliver of the {top_description} visible', 'A sliver of the top visible'],

  // Bottom frame — shoes inline
  ['complete {shoes_description} visible', 'complete shoes visible'],
  ['complete white sneakers visible', 'complete shoes visible'],
  ['complete White leather sneakers visible', 'complete shoes visible'],

  // The hardcoded color reference that shouldn't be there
  ['- Same dark raw indigo color', '- Same color as Image 1'],
];

export async function POST() {
  try {
    // Get ALL prompts (base + alternatives)
    const snap = await promptVaultCol.get();
    const batch = db.batch();
    const changes: string[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      let content = data.content as string;
      let changed = false;

      for (const [pattern, replacement] of REPLACEMENTS) {
        if (typeof pattern === 'string' && content.includes(pattern)) {
          content = content.split(pattern).join(replacement);
          changed = true;
        } else if (pattern instanceof RegExp && pattern.test(content)) {
          content = content.replace(pattern, replacement);
          changed = true;
        }
      }

      if (changed) {
        batch.update(doc.ref, { content });
        changes.push(`${data.shotType} rev${data.revision} ${data.isAlternative ? '(alt: ' + data.label + ')' : '(base)'}`);
      }
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      updated: changes.length,
      changes,
    });
  } catch (error) {
    console.error('[Migrate v2] Error:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: String(error) },
      { status: 500 }
    );
  }
}
