/**
 * Audit follow-up (after Option A fix on #184): how many wardrobe TOPS have a
 * topDescription that disagrees with the longer description on color/material?
 *
 * Heuristic: extract simple color/material tokens from each field and flag
 * disagreements. Print the count + show 3-5 example items.
 *
 * If 1-2 polluted: fix data per item, keep lookup chain as-is.
 * If 10+: lookup chain inversion (option B) becomes the right answer.
 *
 * Read-only. Writes nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';

const projectRoot = path.resolve(__dirname, '..');
const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));

// Simple color vocabulary — coarse but catches the #184 class of bug.
const COLORS = [
  'pink', 'blush', 'rose', 'magenta',
  'blue', 'navy', 'indigo', 'denim', 'cobalt',
  'black', 'charcoal', 'jet',
  'white', 'ivory', 'cream', 'ecru', 'off-white', 'offwhite',
  'beige', 'tan', 'khaki', 'sand', 'camel',
  'grey', 'gray', 'silver',
  'red', 'crimson', 'burgundy', 'wine',
  'green', 'olive', 'sage', 'mint', 'forest',
  'yellow', 'mustard', 'gold',
  'orange', 'rust', 'terracotta',
  'purple', 'lavender', 'lilac',
  'brown', 'chocolate', 'mocha', 'taupe',
];

const MATERIALS = [
  'cotton', 'denim', 'wool', 'silk', 'linen', 'polyester', 'nylon', 'spandex',
  'leather', 'suede', 'velvet', 'satin', 'jersey', 'knit', 'fleece',
  'microfibre', 'microfiber', 'cashmere', 'tweed', 'corduroy', 'poplin',
  'broadcloth', 'chiffon', 'organza', 'mesh', 'lace', 'twill',
  'stretch', // not strictly material but #184 confused this
];

function extractTokens(text: string, vocab: string[]): Set<string> {
  const t = text.toLowerCase();
  return new Set(vocab.filter(w => new RegExp(`\\b${w.replace(/-/g, '[- ]?')}\\b`).test(t)));
}

function symmetricDiff<T>(a: Set<T>, b: Set<T>): { onlyA: T[]; onlyB: T[]; both: T[] } {
  const onlyA = [...a].filter(x => !b.has(x));
  const onlyB = [...b].filter(x => !a.has(x));
  const both = [...a].filter(x => b.has(x));
  return { onlyA, onlyB, both };
}

async function main() {
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });
  const snap = await db.collection('wardrobe').where('category', '==', 'top').get();
  console.log(`Audit: ${snap.size} top items found.\n`);

  const polluted: Array<{ id: string; name: string; td: string; desc: string; colorDiff: ReturnType<typeof symmetricDiff<string>>; matDiff: ReturnType<typeof symmetricDiff<string>> }> = [];
  const noTopDesc: Array<{ id: string; name: string }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = doc.id;
    const name = data.name || '(unnamed)';
    const td = (data.topDescription as string) || '';
    const desc = (data.description as string) || '';

    if (!td && !desc) continue;
    if (!td) { noTopDesc.push({ id, name }); continue; }
    if (!desc) continue;

    const tdColors = extractTokens(td, COLORS);
    const descColors = extractTokens(desc, COLORS);
    const colorDiff = symmetricDiff(tdColors, descColors);

    const tdMaterials = extractTokens(td, MATERIALS);
    const descMaterials = extractTokens(desc, MATERIALS);
    const matDiff = symmetricDiff(tdMaterials, descMaterials);

    // Pollution = topDescription has a color the description does NOT have
    // AND description has a different color topDescription does NOT have.
    // (Symmetric color drift, not just unmentioned-extra-detail.)
    const colorPolluted = colorDiff.onlyA.length > 0 && colorDiff.onlyB.length > 0;

    // Material weaker signal — only flag if topDescription has a material that
    // contradicts (e.g. stretch vs suede). Just log as info.
    const matSuspect = matDiff.onlyA.length > 0 && matDiff.onlyB.length > 0;

    if (colorPolluted || (matSuspect && colorDiff.onlyA.length > 0)) {
      polluted.push({ id, name, td, desc, colorDiff, matDiff });
    }
  }

  console.log(`Polluted (color disagreement): ${polluted.length}/${snap.size}`);
  console.log(`No topDescription set:          ${noTopDesc.length}/${snap.size}\n`);

  // Show up to 8 examples
  console.log(`Examples (up to 8):\n`);
  for (const p of polluted.slice(0, 8)) {
    console.log(`─── ${p.name} (${p.id}) ───`);
    console.log(`  topDescription colors:  ${[...p.colorDiff.onlyA].join(', ') || '(none unique)'}`);
    console.log(`  description colors:     ${[...p.colorDiff.onlyB].join(', ') || '(none unique)'}`);
    console.log(`  shared colors:          ${p.colorDiff.both.join(', ') || '(none)'}`);
    console.log(`  topDesc material extras:${[...p.matDiff.onlyA].join(', ') || '(none)'}`);
    console.log(`  description mat extras: ${[...p.matDiff.onlyB].join(', ') || '(none)'}`);
    console.log(`  topDesc snippet: ${p.td.slice(0, 160).replace(/\n/g, ' ')}…`);
    console.log();
  }

  if (noTopDesc.length > 0) {
    console.log(`Items with no topDescription (rely on description fallback): ${noTopDesc.length}`);
    for (const n of noTopDesc.slice(0, 5)) console.log(`  - ${n.name} (${n.id})`);
  }

  console.log(`\nDecision rule from review:`);
  console.log(`  1-2 polluted → fix data per item, keep lookup chain.`);
  console.log(`  10+ polluted → lookup chain inversion (option B) is the right answer.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
