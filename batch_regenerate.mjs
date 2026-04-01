#!/usr/bin/env node
/**
 * Batch regenerate model cards + dressed bases with updated ECOM guidelines.
 *
 * Usage:
 *   node batch_regenerate.mjs                    # regenerate everything
 *   node batch_regenerate.mjs --cards-only       # only model cards
 *   node batch_regenerate.mjs --dressed-only     # only dressed bases
 *   node batch_regenerate.mjs --model F1         # single model only
 *
 * Runs from your machine — calls the Cloud Run API sequentially.
 */

const API = 'https://gstar-ai-studio-674145888056.europe-west1.run.app';
const args = process.argv.slice(2);
const cardsOnly = args.includes('--cards-only');
const dressedOnly = args.includes('--dressed-only');
const singleModel = args.find(a => a.startsWith('--model'))
  ? args[args.indexOf(args.find(a => a.startsWith('--model'))) + 1]
  : null;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Step 1: Regenerate model cards ──────────────────────────────────────────
async function regenerateCards() {
  console.log('\n═══ REGENERATING MODEL CARDS ═══\n');

  // Get list of models
  const modelsRes = await fetch(`${API}/api/models`);
  if (!modelsRes.ok) {
    console.error('Failed to fetch models:', modelsRes.status);
    return;
  }
  const modelsData = await modelsRes.json();
  let models = modelsData.models || modelsData;

  if (singleModel) {
    models = models.filter(m => (m.modelId || m.id) === singleModel);
  }

  console.log(`Found ${models.length} models to regenerate\n`);

  for (const model of models) {
    const mid = model.modelId || model.id;
    const gender = model.gender;
    const desc = model.description;

    if (!desc || !gender) {
      console.log(`⏭  ${mid} — skipped (no description or gender)`);
      continue;
    }

    console.log(`🔄 ${mid} (${gender}) — generating...`);
    const start = Date.now();

    try {
      const res = await fetch(`${API}/api/models/generate-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, gender }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.image) {
          // Update the model with new card image
          const cardImageUrl = `data:image/png;base64,${data.image}`;
          const patchRes = await fetch(`${API}/api/models/${mid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cardImageUrl }),
          });
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          if (patchRes.ok) {
            console.log(`✅ ${mid} — regenerated (${elapsed}s)`);
          } else {
            console.log(`⚠️  ${mid} — generated but PATCH failed: ${patchRes.status} (${elapsed}s)`);
          }
        } else {
          console.log(`❌ ${mid} — no image returned`);
        }
      } else {
        const err = await res.text();
        console.log(`❌ ${mid} — ${res.status}: ${err.substring(0, 100)}`);
      }
    } catch (err) {
      console.log(`❌ ${mid} — error: ${err.message}`);
    }

    // Small delay between generations to avoid rate limits
    await sleep(2000);
  }
}

// ── Step 2: Regenerate dressed bases ────────────────────────────────────────
async function regenerateDressedBases() {
  console.log('\n═══ REGENERATING DRESSED BASES ═══\n');

  // Get all models first, then fetch dressed bases per model
  const modelsRes = await fetch(`${API}/api/models`);
  if (!modelsRes.ok) {
    console.error('Failed to fetch models:', modelsRes.status);
    return;
  }
  const modelsData = await modelsRes.json();
  let models = modelsData.models || modelsData;
  if (singleModel) {
    models = models.filter(m => (m.modelId || m.id) === singleModel);
  }

  let totalBases = 0;

  for (const model of models) {
    const mid = model.modelId || model.id;

    // Fetch dressed bases for this model
    const basesRes = await fetch(`${API}/api/models/generate-dressed?modelId=${mid}`);
    if (!basesRes.ok) {
      console.log(`⏭  ${mid} — no dressed bases (${basesRes.status})`);
      continue;
    }
    const basesData = await basesRes.json();
    const bases = basesData.bases || [];
    if (bases.length === 0) {
      console.log(`⏭  ${mid} — no dressed bases`);
      continue;
    }

    console.log(`\n── Model: ${mid} (${bases.length} bases) ──`);
    totalBases += bases.length;

    for (const base of bases) {
      const view = base.view || 'front';
      const hash = base.wardrobeHash || '?';
      console.log(`  🔄 ${view} view (hash=${hash}) — generating...`);
      const start = Date.now();

      try {
        // Delete old
        const docId = base.id || base.docId;
        if (docId) {
          const delRes = await fetch(`${API}/api/models/generate-dressed?id=${docId}`, {
            method: 'DELETE',
          });
          if (delRes.ok) {
            console.log(`  🗑  Deleted old: ${docId}`);
          }
        }

        // Regenerate
        const genRes = await fetch(`${API}/api/models/generate-dressed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: mid,
            wardrobeItemIds: base.wardrobeItemIds,
            view,
          }),
        });

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (genRes.ok) {
          const result = await genRes.json();
          console.log(`  ✅ ${view} — regenerated (QC=${result.qcScore}/10, ${elapsed}s)`);
        } else {
          const err = await genRes.text();
          console.log(`  ❌ ${view} — ${genRes.status}: ${err.substring(0, 100)} (${elapsed}s)`);
        }
      } catch (err) {
        console.log(`  ❌ ${view} — error: ${err.message}`);
      }

      // Delay between generations
      await sleep(3000);
    }
  }

  console.log(`\nProcessed ${totalBases} dressed bases total`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 G-Star AI Studio — Batch Regenerate');
  console.log(`   API: ${API}`);
  console.log(`   Mode: ${cardsOnly ? 'cards only' : dressedOnly ? 'dressed bases only' : 'cards + dressed bases'}`);
  if (singleModel) console.log(`   Filter: model ${singleModel}`);
  console.log('');

  if (!dressedOnly) {
    await regenerateCards();
  }

  if (!cardsOnly) {
    await regenerateDressedBases();
  }

  console.log('\n✨ Batch regeneration complete!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
