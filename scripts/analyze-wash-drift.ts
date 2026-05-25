#!/usr/bin/env tsx
/**
 * Ask Gemini Pro to analyze the wash drift between the truth (flat front
 * + back fit-model) and our generated M04 v4. Goal: pinpoint WHY our
 * Pass 2 still drifts lighter even with the flat front as a 3rd ref.
 *
 * Run:
 *   npx tsx scripts/analyze-wash-drift.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { analyzeWithFlashLite } from '@/lib/vertex';

const TMP = '/var/folders/qy/93t3dnf17q3chn_gvqc_nf080000gp/T/tmp.ZalawfBYBc';
const FILES = {
  flatFront: `${TMP}/bowey_flat_front.jpg`,
  fitBack: `${TMP}/bowey_fitmodel_back.jpg`,
  m04v4: `${TMP}/j7RnJwgH_M04_v4.png`,
  m03v2: `${TMP}/j7RnJwgH_M03_v2.png`,
};

async function main() {
  // Load all 4 images
  const flatBuf = await readFile(FILES.flatFront);
  const fitBuf = await readFile(FILES.fitBack);
  const m04Buf = await readFile(FILES.m04v4);
  const m03Buf = await readFile(FILES.m03v2);

  const prompt = `You are a denim color expert. I will show you 4 images of the same product (G-Star Bowey Barrel jeans 53, a vintage-washed light-medium blue jean).

Images in order:
1. PRODUCT TRUTH — flat front studio photo (the canonical color reference)
2. PRODUCT TRUTH — back fit-model studio photo
3. AI GENERATED — M03 (front view, on a model) — this one looks correct
4. AI GENERATED — M04 (back view, on a model) — this one Bruno (CEO) says looks "horrendous" compared to the truth

Please:

A) DESCRIBE THE WASH of the actual product (images 1 + 2):
   - Overall wash level (light / medium / dark blue?)
   - Saturation (vivid / muted)?
   - Whisker / fade pattern strength
   - Any specific characteristics

B) ASSESS M03 (image 3) vs the actual product:
   - Wash match score 1-10
   - What's right, what's wrong

C) ASSESS M04 (image 4) vs the actual product:
   - Wash match score 1-10
   - What's wrong specifically — too light? too saturated? wrong hue? lost detail?
   - How does M04 differ from M03 even though both should be the same jean?

D) ROOT CAUSE HYPOTHESIS:
   M04 is generated via a TWO-PASS process:
   - Pass 1: render the model in bare-legs base (bra + briefs + shoes, no jeans)
   - Pass 2: paint the jeans on top of Pass 1 base, with 3 reference images:
       (i) the Pass 1 base
       (ii) the actual back fit-model (image 2 here)
       (iii) the actual flat front (image 1 here)
   Pass 2 prompt explicitly says "MATCH the jean wash, color, fade pattern EXACTLY to the FIT MODEL BACK reference — do NOT lighten, do NOT desaturate".

   Despite this, M04 drifts LIGHTER than the source. Why might that be? Specifically:
   - Is M04 just averaging skin tone into the denim?
   - Is the bare-leg base biasing the denoise toward lighter pixels?
   - Could the studio lighting in the fit-model ref (bright key light on whiskers) be misinterpreted as "this product is light"?
   - Other hypotheses?

E) FIX RECOMMENDATIONS:
   What would you change to lock the wash to the actual product? Be concrete.

Be terse and direct. No corporate fluff.`;

  console.log('Sending 4 images to Gemini for analysis…\n');
  const result = await analyzeWithFlashLite({
    prompt,
    images: [
      { buffer: flatBuf, mimeType: 'image/jpeg' },
      { buffer: fitBuf, mimeType: 'image/jpeg' },
      { buffer: m03Buf, mimeType: 'image/png' },
      { buffer: m04Buf, mimeType: 'image/png' },
    ],
    model: 'gemini-2.5-pro',
    temperature: 0.2,
  });
  console.log(result);
  await writeFile(`${TMP}/wash-analysis.txt`, result);
  console.log(`\n(also saved to ${TMP}/wash-analysis.txt)`);
}

main().catch(e => { console.error(e); process.exit(1); });
