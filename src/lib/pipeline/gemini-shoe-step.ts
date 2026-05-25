/**
 * DEPRECATED (2026-05-24, rev 30 architecture).
 *
 * This file is no longer imported anywhere — kept on disk only as
 * reference for the Tier-1 + Gemini extend-hem-over-shoe approach that
 * shipped briefly between 2026-05-22 and 2026-05-24. Rev 30 replaced it
 * with a one-pass Seedream paint over a Tier-2 (shoes-on) base + a
 * per-garment ECOM layering ref (wardrobe.layeringRefBackUrl) at slot 4
 * + a composite-back step (src/lib/pipeline/composite-back.ts) to undo
 * Gemini's drift-on-preservation in the pant region after strip-paint.
 *
 * Reason for deprecation: the Gemini hem-extend step hit ~50-67%
 * stability across silhouette classes and consistently softened pant
 * texture (LEARNING #102). Per-garment visual evidence via the layering
 * ref turned out to be the sharper authority and works in one Seedream
 * pass instead of two chained Gemini edits.
 *
 * To revive: re-import `geminiExtendHemOverShoe` + `classifyLength`
 * from matrix-paint.ts and re-add the call block (look for the comment
 * "Rev 30 architecture (2026-05-24): no Gemini hem-extend step" in
 * matrix-paint.ts).
 *
 * Original docstring follows below.
 *
 * ---
 *
 * Gemini extend-hem-over-shoe step for M02 bottom-focus.
 *
 * Runs after Seedream paint (barefoot v9), BEFORE the strip-paint tee step.
 * Inputs:
 *   - barefootPaintedBuffer: Seedream output (model + jeans, bare feet)
 *   - shoeWardrobeId: wardrobe.shoe.itemId (production source for shoe ref)
 *   - layeringRefUrl?: per-garment back-view layering reference (G-Star ECOM
 *     M02 of the same/closest-substitute trouser, populated via
 *     scripts/backfill-layering-refs.ts). Falls back to the legacy global
 *     hardcoded URL when missing (covers wardrobe items not yet backfilled).
 *   - mode: 'extend' (default — pant hem lengthened to drape over shoes) or
 *     'preserve' (rolled-cuff / cropped silhouettes — pant length stays as
 *     painted, shoes added below without lengthening). Caller decides via
 *     classifyLength() on the garment's silhouette text.
 *
 * Outputs the same image but with shoes added (and the hem extended OR
 * preserved depending on mode).
 *
 * Validated by LEARNING #104. Loafer case (chunky platform) renders the shoe
 * correctly but with the upper visible — acceptable per Bruno 2026-05-22.
 * Sneaker case shows clean cascade over the upper.
 *
 * 2026-05-24: added per-garment layering refs + preserve mode for cuffed /
 * cropped silhouettes (rolled-cuff Kate Boyfriend etc. — extending the hem
 * destroys the cuff by definition; preserve mode keeps it).
 */
import { generateImage } from '@/lib/vertex';
import { getWardrobeItem } from '@/lib/firestore';

/**
 * Legacy fallback layering reference: cream pant cascading over dark sneaker
 * (universal, front-ish 3/4 view). Used only when the caller did NOT pass a
 * per-garment layeringRefUrl. Public read on gstar-ai-studio-assets.
 *
 * New per-garment refs live at gs://gstar-ai-studio-assets/layering-refs/
 * {wardrobeId}.jpg — populated by scripts/backfill-layering-refs.ts and
 * resolved by matrix-paint.ts from wardrobe.layeringRefBackUrl.
 */
const FALLBACK_LAYERING_REF_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/test/reference-pant-over-shoe.png';

/**
 * Classify a garment's silhouette text into one of two layering modes.
 *
 * - 'preserve' — pant hem ends ABOVE the shoe (rolled cuff, cropped,
 *   ankle-grazer, mid-calf, culotte). Extending the hem would destroy the
 *   intended look. Add shoes below the existing hem; do not lengthen.
 * - 'extend'   — pant hem drapes OVER the shoe (loose / wide / barrel /
 *   flare / boyfriend with full length / floor-pooling). Lengthen the
 *   denim so the shoe is mostly hidden, only sole + back-heel visible.
 *
 * Keyword heuristic over the per-garment silhouette analysis text already
 * loaded in matrix-paint.ts (`bottomSilhouette`). Defaults to 'extend'
 * (the common case for G-Star wide-leg / loose garments).
 */
export function classifyLength(silhouetteText: string | undefined | null): 'extend' | 'preserve' {
  const s = (silhouetteText || '').toLowerCase();
  // Explicit "ends above the shoe" signals → preserve
  if (/rolled\s*cuff|cuffed\s*(at|hem)|ankle-?grazer/.test(s)) return 'preserve';
  if (/cropped|culotte|mid-?calf|above\s*the\s*ankle/.test(s)) return 'preserve';
  // Default: extend (G-Star wide/loose dominant case)
  return 'extend';
}

const PROMPT_EXTEND = `TASK: Add shoes to the model's feet AND extend the pant legs downward to cover the shoes. Two changes only — everything else stays identical to Image 1.

Image 1 is the base: a model wearing G-Star jeans, standing barefoot in a studio. Preserve from Image 1:
- Model identity, skin tone, body, hair, pose, stance, arms hanging at the sides
- The jeans wash, color, fading, construction seams, back pockets with G-Star arc stitching, leather brand patch, leg silhouette
- The studio background, floor, lighting, shadows, framing

Image 2 is the shoe: add these shoes to the model's feet, replacing the bare feet.

Image 3 is a back-view ECOM photograph of the SAME (or closest-substitute) trouser from G-Star's official catalog, worn from behind with shoes. Use Image 3 ONLY as a layering reference for the spatial relationship between pant and shoe — specifically, how the pant fabric cascades over and on top of the shoe from behind, with only the sole and back-heel visible below the cascading hem.

REQUIRED MODIFICATION TO IMAGE 1 — extend the pant legs:
The pant hem in Image 1 currently ends above the ankle, with bare feet visible below. This is wrong. In the output, the pant legs must be LONGER. The denim must extend downward from where it currently ends, continuing past the ankle, past the top of the shoe, and draping down over the shoe uppers. The new hem position is near floor level — just above the sole of the shoe.

Specifically, in the output:
- The bare ankles visible in Image 1 are NOT visible — they are covered by extended denim
- The top of each shoe (the upper, the laces if any, the ankle collar) is NOT visible — covered by extended denim
- Only the lower portion of each shoe is visible: the sole, a small portion of the back heel, and the front of the toe box if it protrudes
- The denim hem sits low, near where the sole meets the floor
- The new denim extending downward matches the wash, color, and texture of the rest of the jeans exactly
- The leg silhouette continues naturally downward — the leg shape follows the upper portion's profile to the new hem
- The fabric drapes naturally over the shoe shape, with subtle folds where the denim meets the top of the shoe

DO NOT keep the pant hem at its current position in Image 1.
DO NOT leave the shoes fully visible below a high hem.
DO NOT show the full shoe upper — most of the shoe is covered by extended denim.

The denim is the foreground layer at the foot. The shoes sit behind it. Only the sole and back-heel emerge below the hem at floor level.

OUTPUT: Image 1 modified so that (a) bare feet are replaced by the shoes from Image 2, and (b) the pant legs are extended downward to drape over the shoes with the hem near floor level. All other elements — model, arms, jeans construction, scene, lighting — identical to Image 1.`;

const PROMPT_PRESERVE = `TASK: Add shoes to the model's feet, preserving the pant hem exactly as it is in Image 1. Two changes only — bare feet → shoes — everything else stays identical to Image 1.

Image 1 is the base: a model wearing G-Star pants, standing barefoot in a studio. The pant hem is INTENTIONALLY ABOVE the ankle (rolled cuff, cropped, ankle-grazer, or mid-calf length) — this is the correct, brand-spec length for this trouser. Preserve from Image 1:
- Model identity, skin tone, body, hair, pose, stance, arms hanging at the sides
- The pant wash, color, construction seams, back pockets with G-Star arc stitching, leather brand patch, leg silhouette
- The pant hem position and treatment — EXACTLY as shown (rolled cuff, raw edge, cropped break, whatever Image 1 shows). DO NOT lengthen the pant. DO NOT cover the hem with extra fabric.
- The studio background, floor, lighting, shadows, framing

Image 2 is the shoe: add these shoes to the model's feet, replacing the bare feet.

Image 3 is a back-view ECOM photograph of the SAME (or closest-substitute) trouser from G-Star's official catalog, worn from behind with shoes. Note in Image 3 that the pant hem ends ABOVE the shoe top and the shoe is FULLY VISIBLE below — that is the correct relationship for this trouser. Match that relationship in the output.

REQUIRED in the output:
- Bare feet from Image 1 are replaced by the shoes from Image 2
- Pant hem position UNCHANGED from Image 1 — same height, same treatment (cuff, raw edge, etc)
- The shoes are FULLY VISIBLE below the pant hem — upper, laces, ankle collar, sole, heel all visible
- The leg silhouette continues naturally to the existing hem in Image 1; no new fabric below the original hem
- A small natural gap (1–4 cm) is acceptable between the bottom of the hem and the top of the shoe — this is the correct look for a cropped / cuffed trouser

DO NOT extend the pant legs downward.
DO NOT cover the top or upper of the shoe with denim.
DO NOT add extra fabric below the existing hem.
The denim ends where it ends in Image 1; only the shoe is added.

OUTPUT: Image 1 modified so that bare feet are replaced by the shoes from Image 2, with the existing pant hem position preserved exactly. All other elements — model, arms, pant construction, hem, scene, lighting — identical to Image 1.`;

export interface GeminiShoeStepParams {
  /** Seedream barefoot M02 (4K PNG). */
  barefootPaintedBuffer: Buffer;
  /** Wardrobe shoe item id (from job.wardrobe.shoe.itemId). */
  shoeWardrobeId: string;
  /**
   * Per-garment layering reference URL (G-Star ECOM M02 of the same/closest
   * trouser, populated on the wardrobe doc as `layeringRefBackUrl` via
   * scripts/backfill-layering-refs.ts). When undefined, the legacy hardcoded
   * generic layering ref is used.
   */
  layeringRefUrl?: string;
  /**
   * 'extend' — lengthen the pant hem to drape over the shoes (default, used
   * for loose / wide / boyfriend / barrel / flare silhouettes).
   * 'preserve' — keep the existing hem position (rolled-cuff Kate Boyfriend,
   * cropped culotte, ankle-grazer). Caller determines via classifyLength()
   * over the garment's silhouette text.
   */
  mode?: 'extend' | 'preserve';
  /** Optional Gemini API key override (defaults to env). */
  apiKey?: string;
}

export interface GeminiShoeStepResult {
  /** True when Gemini ran and produced a usable buffer. */
  applied: boolean;
  /** Resulting image. When applied=false, equals the input buffer. */
  imageData: Buffer;
  /** MIME type of the output. */
  mimeType: string;
  /** Error message if the step ran but failed. */
  error?: string;
}

/**
 * Add shoes under an extended pant hem on a barefoot M02 image via Gemini.
 *
 * On any error (missing shoe ref, Gemini failure, etc) returns the input
 * buffer unchanged with applied=false + error set. The caller surfaces
 * this error and ships the barefoot image rather than failing the shot —
 * matches the strip-paint failure-mode policy (better degraded than dead).
 */
export async function geminiExtendHemOverShoe(
  params: GeminiShoeStepParams,
): Promise<GeminiShoeStepResult> {
  const { barefootPaintedBuffer, shoeWardrobeId, layeringRefUrl, mode = 'extend', apiKey } = params;
  const effectiveLayeringRef = (layeringRefUrl && layeringRefUrl.length > 0)
    ? layeringRefUrl.split('?')[0]
    : FALLBACK_LAYERING_REF_URL;
  const prompt = mode === 'preserve' ? PROMPT_PRESERVE : PROMPT_EXTEND;
  console.log(`[GeminiShoeStep] mode=${mode} layeringRef=${effectiveLayeringRef.slice(-80)}`);

  // Resolve shoe ref URL: prefer flatBackUrl (back view of shoe), fall back
  // to flatFrontUrl when no back exists.
  let shoeRefUrl: string | undefined;
  try {
    const shoeItem = await getWardrobeItem(shoeWardrobeId) as Record<string, unknown> | null;
    if (!shoeItem) {
      const err = `geminiExtendHemOverShoe: shoe item ${shoeWardrobeId} not found`;
      console.warn(`[GeminiShoeStep] ${err}`);
      return { applied: false, imageData: barefootPaintedBuffer, mimeType: 'image/png', error: err };
    }
    shoeRefUrl = (shoeItem.flatBackUrl as string) || (shoeItem.flatFrontUrl as string) || undefined;
    if (!shoeRefUrl) {
      const err = `geminiExtendHemOverShoe: shoe item ${shoeWardrobeId} has no flat ref (back or front)`;
      console.warn(`[GeminiShoeStep] ${err}`);
      return { applied: false, imageData: barefootPaintedBuffer, mimeType: 'image/png', error: err };
    }
  } catch (e) {
    const err = `geminiExtendHemOverShoe: shoe fetch failed: ${(e as Error).message}`;
    console.error(`[GeminiShoeStep] ${err}`);
    return { applied: false, imageData: barefootPaintedBuffer, mimeType: 'image/png', error: err };
  }

  // Fetch shoe + layering ref images.
  let shoeBuf: Buffer;
  let shoeMime: string;
  let layeringBuf: Buffer;
  let layeringMime: string;
  try {
    const [shoeResp, layeringResp] = await Promise.all([
      fetch(shoeRefUrl.split('?')[0]),
      fetch(effectiveLayeringRef),
    ]);
    if (!shoeResp.ok) throw new Error(`shoe ref fetch ${shoeResp.status}`);
    if (!layeringResp.ok) throw new Error(`layering ref fetch ${layeringResp.status}`);
    shoeBuf = Buffer.from(await shoeResp.arrayBuffer());
    shoeMime = shoeResp.headers.get('content-type') || 'image/jpeg';
    layeringBuf = Buffer.from(await layeringResp.arrayBuffer());
    layeringMime = layeringResp.headers.get('content-type') || 'image/png';
  } catch (e) {
    const err = `geminiExtendHemOverShoe: ref image fetch failed: ${(e as Error).message}`;
    console.error(`[GeminiShoeStep] ${err}`);
    return { applied: false, imageData: barefootPaintedBuffer, mimeType: 'image/png', error: err };
  }

  // Run Gemini.
  try {
    const t0 = Date.now();
    const result = await generateImage({
      prompt,
      referenceImages: [
        { buffer: barefootPaintedBuffer, mimeType: 'image/png', label: mode === 'preserve' ? 'IMAGE 1 — barefoot painted M02 (preserve everything including the hem position; only add shoes to bare feet)' : 'IMAGE 1 — barefoot painted M02 (preserve everything except feet+hem)' },
        { buffer: shoeBuf, mimeType: shoeMime, label: 'IMAGE 2 — shoe back/flat reference' },
        { buffer: layeringBuf, mimeType: layeringMime, label: 'IMAGE 3 — layering reference (spatial-relationship guidance)' },
      ],
      aspectRatio: '1:1',
      imageSize: '4K',
      model: 'gemini-3-pro-image-preview',
      apiKey,
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[GeminiShoeStep] applied in ${dt}s (${(result.imageData.length / 1024).toFixed(0)}KB)`);
    return {
      applied: true,
      imageData: result.imageData,
      mimeType: result.mimeType,
    };
  } catch (e) {
    const err = `geminiExtendHemOverShoe: Gemini call failed: ${(e as Error).message}`;
    console.error(`[GeminiShoeStep] ${err}`);
    return { applied: false, imageData: barefootPaintedBuffer, mimeType: 'image/png', error: err };
  }
}
