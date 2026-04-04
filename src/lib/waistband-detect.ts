/**
 * Smart waistband detection using Gemini Flash Lite.
 *
 * Replaces fixed-percentage crops for M01/M02 (cropped shots).
 * Detects the actual waistband position in a full-body image,
 * then returns a crop Y position with a configurable margin above.
 *
 * Cost: ~$0.002 per call (Gemini Flash Lite).
 * Latency: <1 second.
 */

import sharp from 'sharp';

const DETECT_MODEL = 'gemini-2.5-flash-lite';

/**
 * Detect the Y-position of the top of the garment waistband in a full-body image.
 *
 * @param imageBuffer Full-body image (Phase 1 template or dressed base)
 * @param marginAbove Fraction of image height to keep above the waistband (default 0.03 = 3%)
 * @returns Fractional Y position to crop from (0 = top, 1 = bottom), or null if detection fails
 */
export async function detectWaistbandCropY(
  imageBuffer: Buffer,
  marginAbove: number = 0.03,
): Promise<number | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[WaistbandDetect] No GEMINI_API_KEY — falling back to fixed %');
    return null;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DETECT_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `Look at this full-body photograph of a person wearing jeans/pants.

Find the NAVEL (belly button) position. The navel is the anatomical landmark where the crop should happen — it stays in the same place regardless of waist height, shoe height, or pose.

If the navel is not visible (covered by clothing), estimate its position based on body proportions — it's roughly at the narrowest point of the torso, where the natural waist is.

Return the Y position as a number from 0 to 1000, where:
- 0 = very top of the image
- 1000 = very bottom of the image

For example, if the navel is at 40% from the top of the image, return 400.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"found":true,"waistband_y":NUMBER}

If no person is visible:
{"found":false,"waistband_y":0}`;

  try {
    // Downscale for detection — we only need the Y position, not pixel precision
    const smallBuf = await sharp(imageBuffer)
      .resize(800, 800, { fit: 'inside' })
      .jpeg({ quality: 75 })
      .toBuffer();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: smallBuf.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      console.error(`[WaistbandDetect] API error: ${response.status}`);
      return null;
    }

    const result = await response.json();
    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
    if (!textPart?.text) {
      console.error('[WaistbandDetect] No text in response');
      return null;
    }

    let jsonText = textPart.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);
    if (!parsed.found) {
      console.warn('[WaistbandDetect] Waistband not found in image');
      return null;
    }

    // Convert 0-1000 scale to 0-1 fraction
    let waistbandFrac = parsed.waistband_y / 1000;

    // Sanity check: waistband should be in the 20%-60% range for a full-body shot
    if (waistbandFrac < 0.15 || waistbandFrac > 0.65) {
      console.warn(`[WaistbandDetect] Waistband position ${(waistbandFrac * 100).toFixed(1)}% seems unlikely — clamping to safe range`);
      waistbandFrac = Math.max(0.25, Math.min(0.55, waistbandFrac));
    }

    // Crop position = waistband position minus margin above
    const cropY = Math.max(0, waistbandFrac - marginAbove);

    console.log(`[WaistbandDetect] Waistband at ${(waistbandFrac * 100).toFixed(1)}%, crop at ${(cropY * 100).toFixed(1)}% (margin ${(marginAbove * 100).toFixed(1)}% above)`);
    return cropY;

  } catch (err) {
    console.error('[WaistbandDetect] Detection failed:', err);
    return null;
  }
}

/**
 * Smart crop an image from the waistband down.
 *
 * Detects the waistband position via Gemini, then crops with margin.
 * Falls back to a fixed percentage if detection fails.
 *
 * @param imageBuffer Full-body image to crop
 * @param fallbackFrac Fallback crop fraction from top if detection fails (default 0.35)
 * @param marginAbove Margin above waistband to include (default 0.03 = 3%)
 * @returns Cropped image buffer
 */
export async function smartCropFromWaistband(
  imageBuffer: Buffer,
  fallbackFrac: number = 0.35,
  marginAbove: number = 0.03,
): Promise<{ buffer: Buffer; cropFrac: number; detected: boolean }> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1800;
  const height = meta.height || 2400;

  // Try smart detection
  const detectedCropY = await detectWaistbandCropY(imageBuffer, marginAbove);

  const cropFrac = detectedCropY ?? fallbackFrac;
  const detected = detectedCropY !== null;
  const cropFromTop = Math.round(height * cropFrac);

  if (!detected) {
    console.log(`[WaistbandDetect] Using fallback crop: ${(fallbackFrac * 100).toFixed(0)}% from top`);
  }

  const croppedBuffer = await sharp(imageBuffer)
    .extract({ left: 0, top: cropFromTop, width, height: height - cropFromTop })
    .jpeg({ quality: 95 })
    .toBuffer();

  return { buffer: croppedBuffer, cropFrac, detected };
}
