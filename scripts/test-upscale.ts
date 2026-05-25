/**
 * Local upscale A/B test — Stability Creative vs Replicate Real-ESRGAN.
 *
 * Takes one or more source image URLs (typically GCS URLs from a real
 * gstar-ai-studio shot — final master, or any earlier pipeline-stage
 * intermediate from the debug viewer), downloads each, runs both upscale
 * APIs in parallel, and writes the outputs side-by-side to
 * `./test_outputs/upscale/{source-basename}_{provider}.png` for visual
 * comparison.
 *
 * Usage:
 *   STABILITY_API_KEY=sk-... \
 *   REPLICATE_API_TOKEN=r8_... \
 *   npx tsx scripts/test-upscale.ts \
 *     "https://storage.googleapis.com/gstar-ai-studio-assets/output/...png" \
 *     "https://storage.googleapis.com/gstar-ai-studio-assets/output/...png"
 *
 * Get API keys:
 *   Stability: https://platform.stability.ai/account/keys
 *   Replicate: https://replicate.com/account/api-tokens
 *
 * Cost per source image: ~$0.10 (Stability Creative) + ~$0.02 (Replicate).
 * Both APIs are pay-as-you-go and require billing setup.
 *
 * Both providers return 4× the input dimensions. Stability Creative is
 * generative (adds plausible fabric/skin detail); Replicate Real-ESRGAN is
 * conservative (sharpens existing pixels, no new detail invented).
 */
import * as fs from 'fs';
import * as path from 'path';

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!STABILITY_API_KEY && !REPLICATE_API_TOKEN) {
  console.error('Set STABILITY_API_KEY and/or REPLICATE_API_TOKEN in env. At least one required.');
  process.exit(1);
}

const sourceUrls = process.argv.slice(2);
if (sourceUrls.length === 0) {
  console.error('Usage: npx tsx scripts/test-upscale.ts <url1> [<url2> ...]');
  console.error('Open the Pipeline Stages viewer on a shot and copy any stage URL.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), 'test_outputs', 'upscale');
fs.mkdirSync(OUT_DIR, { recursive: true });

function basenameFromUrl(url: string): string {
  const cleanUrl = url.split('?')[0];
  const last = cleanUrl.split('/').pop() || 'image';
  return last.replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

async function downloadAsBuffer(url: string): Promise<Buffer> {
  const cleanUrl = url.split('?')[0];
  const r = await fetch(cleanUrl);
  if (!r.ok) throw new Error(`fetch ${cleanUrl} → ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// ─── Stability Conservative Upscale ──────────────────────────────────────────
// docs: https://platform.stability.ai/docs/api-reference#tag/Upscale
// SDXL-based, generative-but-conservative. Tested 2026-05-13: stitches looked
// soft / smoothed. Worse than source for fashion fabric.
async function stabilityConservativeUpscale(srcBuffer: Buffer, baseName: string): Promise<Buffer> {
  if (!STABILITY_API_KEY) throw new Error('STABILITY_API_KEY missing');
  const t0 = Date.now();

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(srcBuffer)]), `${baseName}.png`);
  form.append('prompt', 'high resolution photorealistic e-commerce studio photograph of a fashion model wearing G-Star denim, sharp fabric weave, accurate stitch detail');
  form.append('creativity', '0.2');
  form.append('output_format', 'png');

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/upscale/conservative', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'image/*' },
    body: form,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Stability Conservative ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const out = Buffer.from(await resp.arrayBuffer());
  console.log(`[StabilityConservative] ${baseName}: ${((Date.now() - t0) / 1000).toFixed(1)}s (${(out.length / 1024).toFixed(0)} KB)`);
  return out;
}

// ─── Helper: auto-downsample a buffer to ≤1MP for endpoints that cap there ──
async function downsampleTo1MP(srcBuffer: Buffer, label: string): Promise<Buffer> {
  const sharp = (await import('sharp') as unknown as { default: typeof import('sharp') }).default;
  const meta = await sharp(srcBuffer).metadata();
  const w = meta.width || 2048;
  const h = meta.height || 2048;
  if (w * h <= 1_048_576) return srcBuffer;
  const scale = Math.sqrt(1_048_576 / (w * h));
  const newW = Math.floor(w * scale);
  const newH = Math.floor(h * scale);
  console.log(`[${label}] downsampled ${w}×${h} → ${newW}×${newH} for 1MP cap`);
  return sharp(srcBuffer).resize(newW, newH, { kernel: 'lanczos3' }).png().toBuffer();
}

// ─── Stability Fast Upscale ──────────────────────────────────────────────────
// docs: https://platform.stability.ai/docs/api-reference#tag/Upscale
// Endpoint: POST /v2beta/stable-image/upscale/fast
// Cheapest Stability tier — ESRGAN-style 4× upscale.
// CAP: 1,048,576 pixels (1MP) input. We auto-downsample 2K → 1K first.
// This means the path is: 2K Seedream → 1K downsample → 4K Fast output.
// Net effect: lose info at the downsample step before upscaling. Worth
// comparing against Conservative anyway (different model family — Fast is
// non-generative GAN, Conservative is SDXL-based).
// Cost: 1 credit = $0.01 per call.
async function stabilityFastUpscale(srcBuffer: Buffer, baseName: string): Promise<Buffer> {
  if (!STABILITY_API_KEY) throw new Error('STABILITY_API_KEY missing');
  const t0 = Date.now();
  const inputBuf = await downsampleTo1MP(srcBuffer, 'StabilityFast');

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(inputBuf)]), `${baseName}.png`);
  form.append('output_format', 'png');

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/upscale/fast', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'image/*' },
    body: form,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Stability Fast ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const out = Buffer.from(await resp.arrayBuffer());
  console.log(`[StabilityFast] ${baseName}: ${((Date.now() - t0) / 1000).toFixed(1)}s (${(out.length / 1024).toFixed(0)} KB)`);
  return out;
}

// ─── Stability Creative Upscale (with auto-downsample) ──────────────────────
// docs: https://platform.stability.ai/docs/api-reference#tag/Upscale
// Endpoint: POST /v2beta/stable-image/upscale/creative
// Generative — adds detail. BUT caps input at 1,048,576 pixels (1MP). We
// auto-downsample 2K input → 1024-max before calling, then Creative outputs
// 4× = back to ~4K. The downsample loses info, so this is a gamble:
// Creative's generative regen has to recover MORE detail than the downsample
// loses. Worth testing for "is the generative model just better than sharpening".
// Cost: 40 credits = $0.40. The most expensive option.
async function stabilityCreativeUpscale(srcBuffer: Buffer, baseName: string): Promise<Buffer> {
  if (!STABILITY_API_KEY) throw new Error('STABILITY_API_KEY missing');
  const t0 = Date.now();
  const inputBuf = await downsampleTo1MP(srcBuffer, 'StabilityCreative');

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(inputBuf)]), `${baseName}.png`);
  form.append('prompt', 'high resolution photorealistic e-commerce studio photograph of a fashion model wearing G-Star denim, sharp fabric weave, accurate stitch detail, crisp seam stitching, photo-quality denim texture');
  form.append('creativity', '0.3'); // Higher than Conservative — we WANT generative recovery here
  form.append('output_format', 'png');

  const startResp = await fetch('https://api.stability.ai/v2beta/stable-image/upscale/creative', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'application/json' },
    body: form,
  });
  if (!startResp.ok) {
    const txt = await startResp.text();
    throw new Error(`Stability Creative start ${startResp.status}: ${txt.slice(0, 500)}`);
  }
  const { id } = await startResp.json() as { id: string };

  // Poll. Creative is async — 202 while processing, 200 on completion.
  // Accept header: `*/*` — the v2beta poll endpoint rejects `image/*` for the
  // creative results path (it returns JSON on error states, image on success).
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollResp = await fetch(`https://api.stability.ai/v2beta/results/${id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: '*/*' },
    });
    if (pollResp.status === 202) { process.stdout.write('.'); continue; }
    if (pollResp.status === 200) {
      const out = Buffer.from(await pollResp.arrayBuffer());
      console.log(`\n[StabilityCreative] ${baseName}: ${((Date.now() - t0) / 1000).toFixed(1)}s (${(out.length / 1024).toFixed(0)} KB)`);
      return out;
    }
    const txt = await pollResp.text();
    throw new Error(`Stability Creative poll ${pollResp.status}: ${txt.slice(0, 500)}`);
  }
  throw new Error('Stability Creative: timeout 5min');
}

// ─── Generic Replicate prediction runner ─────────────────────────────────────
// Submits a prediction by version SHA + input, polls until done, returns the
// first output URL fetched as a Buffer. All Replicate-hosted upscalers share
// the same predictions API so this helper is reused across models.
async function runReplicatePrediction(
  version: string,
  input: Record<string, unknown>,
  label: string,
  baseName: string,
): Promise<Buffer> {
  if (!REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN missing');
  const t0 = Date.now();

  // Submit with 429-retry. Replicate enforces a 6-req/min cap + 1-burst on
  // free tier (< $5 credit) — when multiple methods run in parallel, all but
  // the first hit 429. Honor retry_after.
  let startResp: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    startResp = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version, input }),
    });
    if (startResp.status !== 429) break;
    const body = await startResp.json().catch(() => ({} as { retry_after?: number }));
    const waitS = (body as { retry_after?: number }).retry_after ?? 15;
    console.log(`[${label}] 429 — retry in ${waitS}s (attempt ${attempt + 1}/6)`);
    await new Promise(r => setTimeout(r, (waitS + 1) * 1000));
  }
  if (!startResp || !startResp.ok) {
    const txt = startResp ? await startResp.text() : 'no response';
    throw new Error(`${label} start ${startResp?.status}: ${txt.slice(0, 500)}`);
  }
  const prediction = await startResp.json() as { id: string; urls: { get: string } };

  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollResp = await fetch(prediction.urls.get, {
      method: 'GET',
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    if (!pollResp.ok) {
      const txt = await pollResp.text();
      throw new Error(`${label} poll ${pollResp.status}: ${txt.slice(0, 500)}`);
    }
    const result = await pollResp.json() as {
      status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
      output?: string | string[];
      error?: string;
    };
    if (result.status === 'succeeded') {
      const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      if (!outputUrl) throw new Error(`${label} succeeded but no output URL`);
      const outResp = await fetch(outputUrl);
      if (!outResp.ok) throw new Error(`${label} output fetch ${outResp.status}`);
      const out = Buffer.from(await outResp.arrayBuffer());
      console.log(`\n[${label}] ${baseName}: ${((Date.now() - t0) / 1000).toFixed(1)}s (${(out.length / 1024).toFixed(0)} KB)`);
      return out;
    }
    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`${label} ${result.status}: ${result.error || '(no error)'}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`${label}: timed out after 4min`);
}

// ─── Replicate Real-ESRGAN (A100 variant) ────────────────────────────────────
// Tested 2026-05-13: "ugly painting, washed out" per Bruno.
// docs: https://replicate.com/cjwbw/real-esrgan
async function replicateRealESRGAN(srcUrl: string, baseName: string): Promise<Buffer> {
  return runReplicatePrediction(
    'd0ee3d708c9b911f122a4ad90046c5d26a0293b99476d697f6bb7f2e251ce2d4',
    { image: srcUrl, scale: 4, face_enhance: false },
    'RealESRGAN',
    baseName,
  );
}

// ─── Replicate Clarity Upscaler ──────────────────────────────────────────────
// docs: https://replicate.com/philz1337x/clarity-upscaler
// The de facto "Magnific clone" on Replicate. Stable Diffusion + ControlNet
// approach, tuned for photorealism. Used by pro fashion / product retouchers.
// Different model family than Real-ESRGAN — generative, adds detail, photo
// realism oriented (denim, fabric, stitching).
// Cost: ~$0.05 per call (T4 GPU, ~30-60s).
async function replicateClarityUpscaler(srcUrl: string, baseName: string): Promise<Buffer> {
  return runReplicatePrediction(
    // philz1337x/clarity-upscaler — pinning a stable version.
    'dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e',
    {
      image: srcUrl,
      scale_factor: 2,           // 2× is the safe default — preserves more of the original
      dynamic: 6,                // HDR — 6 default
      creativity: 0.35,          // 0.35 default — controls how much it changes
      resemblance: 0.6,          // 0.6 default — controls fidelity to source
      tiling_width: 112,
      tiling_height: 144,
      sd_model: 'juggernaut_reborn.safetensors [338b85bc4f]',
      scheduler: 'DPM++ 3M SDE Karras',
      num_inference_steps: 18,
      seed: 1337,
      downscaling: false,
      downscaling_resolution: 768,
      sharpen: 0,
      handfix: 'disabled',
      output_format: 'png',
    },
    'Clarity',
    baseName,
  );
}

// ─── Replicate SWIN2SR ───────────────────────────────────────────────────────
// docs: https://replicate.com/mv-lab/swin2sr
// Transformer-based super-resolution (not diffusion). Different style than
// the ESRGAN/Real-ESRGAN family — often sharper without painterly artifacts,
// closer to "computational sharpening" than "generative invention".
// Cost: ~$0.03 per call.
async function replicateSwin2SR(srcUrl: string, baseName: string): Promise<Buffer> {
  return runReplicatePrediction(
    'a01b0512004918ca55d02e554914a9eca63909fa83a29ff0f115c78a7045574f',
    // task options: "classical_sr" | "real_sr" | "compressed_sr".
    // real_sr is the right one for photographs (vs classical for line art / clean images).
    { image: srcUrl, task: 'real_sr' },
    'Swin2SR',
    baseName,
  );
}

// ─── Driver ──────────────────────────────────────────────────────────────────
async function processOne(srcUrl: string) {
  const baseName = basenameFromUrl(srcUrl);
  console.log(`\n=== ${baseName} ===`);
  console.log(`Source: ${srcUrl}`);

  // Save the source locally for direct comparison
  const srcBuf = await downloadAsBuffer(srcUrl);
  const srcOut = path.join(OUT_DIR, `${baseName}_source.png`);
  fs.writeFileSync(srcOut, srcBuf);
  console.log(`Source saved: ${srcOut} (${(srcBuf.length / 1024).toFixed(0)} KB)`);

  // Run both in parallel
  const tasks: Array<Promise<void>> = [];

  // Each method runs in parallel; failures are logged but don't break others.
  function runMethod(suffix: string, fn: () => Promise<Buffer>) {
    tasks.push((async () => {
      try {
        const out = await fn();
        const outPath = path.join(OUT_DIR, `${baseName}_${suffix}.png`);
        fs.writeFileSync(outPath, out);
        console.log(`Saved ${suffix}: ${outPath} (${(out.length / 1024).toFixed(0)} KB)`);
      } catch (e) {
        console.error(`${suffix} FAILED for ${baseName}:`, e instanceof Error ? e.message : e);
      }
    })());
  }

  if (STABILITY_API_KEY) {
    runMethod('stability_conservative', () => stabilityConservativeUpscale(srcBuf, baseName));
    runMethod('stability_fast',         () => stabilityFastUpscale(srcBuf, baseName));
    runMethod('stability_creative',     () => stabilityCreativeUpscale(srcBuf, baseName));
  } else {
    console.log('[Stability] skipped (no STABILITY_API_KEY)');
  }

  if (REPLICATE_API_TOKEN) {
    runMethod('realesrgan', () => replicateRealESRGAN(srcUrl, baseName));
    runMethod('clarity',    () => replicateClarityUpscaler(srcUrl, baseName));
    runMethod('swin2sr',    () => replicateSwin2SR(srcUrl, baseName));
  } else {
    console.log('[Replicate] skipped (no REPLICATE_API_TOKEN)');
  }

  await Promise.all(tasks);
}

async function main() {
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Sources: ${sourceUrls.length}`);
  console.log(`Stability: ${STABILITY_API_KEY ? 'enabled' : 'SKIPPED'}`);
  console.log(`Replicate: ${REPLICATE_API_TOKEN ? 'enabled' : 'SKIPPED'}`);

  for (const url of sourceUrls) {
    await processOne(url);
  }

  console.log(`\nDone. Open ${OUT_DIR} to compare side-by-side.`);
  console.log(`On macOS: open "${OUT_DIR}"`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
