import { NextRequest, NextResponse } from 'next/server';
import { buildQCPrompt, buildLabelQCPrompt } from '@/lib/prompts';
import { downloadGarmentImage } from '@/lib/gcs';
import { shotsCol, jobsCol } from '@/lib/firestore';

// QC uses Gemini 2.5 Flash-Lite — cheapest model for structured image scoring
// Was gemini-2.5-pro ($1.25/M input) → flash-lite ($0.10/M input) = 12x cheaper
const QC_MODEL = 'gemini-2.5-flash-lite';

// QC v4 — 4 focused dimensions (added construction fidelity for seams, labels, details)
interface QCScores {
  color_match: { score: number; note: string };            // Is color/wash matching the original?
  waist_height: { score: number; note: string };           // Is waist height according to fit model?
  garment_length: { score: number; note: string };         // Is length according to fit model?
  construction_fidelity: { score: number; note: string };  // Are seams, labels, pockets, knee details preserved?
  weighted_score: number;
  pass: boolean;
  critical_issues: string[];
  summary: string;
}

// POST /api/qc — comprehensive QC audit on a generated shot
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shotId, labelQC } = body;

    // Get shot data
    const shotDoc = await shotsCol.doc(shotId).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }
    const shot = shotDoc.data()!;

    // Get job data for garment info
    const jobDoc = await jobsCol.doc(shot.jobId).get();
    const job = jobDoc.data()!;

    // ── Collect ALL reference images for QC audit ──
    const parts: Array<Record<string, unknown>> = [];

    // 1. Flat image reference (full resolution for detail inspection)
    if (job.flatImageUrl) {
      try {
        const flatBuf = await downloadGarmentImage(job.flatImageUrl);
        parts.push({
          inlineData: { mimeType: 'image/jpeg', data: flatBuf.toString('base64') },
        });
        parts.push({ text: 'REFERENCE IMAGE — FLAT GARMENT: Shows true proportions, color, and construction details of the focus product.\n\n' });
        console.log(`[QC] Loaded flat image reference`);
      } catch (e) {
        console.error('[QC] Failed to load flat image:', e);
      }
    }

    // 2. Key mannequin references — front + back + side (3 max, not all 9)
    // Saves ~6 image inputs per QC call. Front is COLOR ANCHOR, others for silhouette check.
    if (job.image360Urls?.length) {
      const totalAngles = job.image360Urls.length;
      // Pick front (0), back (~halfway), and side (~quarter) indices
      const qcIndices = [0];
      if (totalAngles >= 4) qcIndices.push(Math.round(totalAngles / 4)); // ~90° side
      if (totalAngles >= 2) qcIndices.push(Math.round(totalAngles / 2)); // ~180° back
      const maxRefs = qcIndices.length;
      for (const i of qcIndices) {
        try {
          const buf = await downloadGarmentImage(job.image360Urls[i]);
          parts.push({
            inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
          });
          const angleLabel = i === 0
            ? `REFERENCE IMAGE — MANNEQUIN FRONT (0°) — COLOR ANCHOR. This is the DEFINITIVE color/wash reference. All color scoring must compare against THIS image.`
            : `REFERENCE IMAGE — MANNEQUIN VIEW ${i + 1}/${maxRefs} (~${Math.round(i * 360 / maxRefs)}°). Use for construction, silhouette, and detail verification.`;
          parts.push({ text: angleLabel + '\n\n' });
        } catch (e) {
          console.error(`[QC] Failed to load 360° image ${i}:`, e);
        }
      }
      console.log(`[QC] Loaded ${maxRefs} mannequin reference images`);
    }

    // QC v3: wardrobe references REMOVED — we only check color, waist height, length now.
    // This saves ~3-5 image inputs per QC call (wardrobe items + their downloads).
    const wardrobeDescriptions: string[] = [];

    // 3. The AI-generated image to evaluate (LAST — so the model sees all refs first)
    const generatedImageUrl = shot.imageUrl || shot.driveFileId;
    if (generatedImageUrl) {
      try {
        let imgBuf: Buffer;
        if (generatedImageUrl.startsWith('http')) {
          imgBuf = await downloadGarmentImage(generatedImageUrl);
        } else {
          const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
          const imgResp = await fetch(`${baseUrl}/api/images/${generatedImageUrl}`);
          if (!imgResp.ok) throw new Error(`Image fetch failed: ${imgResp.status}`);
          imgBuf = Buffer.from(await imgResp.arrayBuffer());
        }
        parts.push({
          inlineData: { mimeType: 'image/png', data: imgBuf.toString('base64') },
        });
        parts.push({ text: 'AI-GENERATED IMAGE TO AUDIT — compare this image against ALL references above. Score each dimension carefully.\n\n' });
        console.log(`[QC] Loaded generated image for audit`);
      } catch (e) {
        console.error('[QC] Failed to load generated image:', e);
      }
    } else {
      console.error('[QC] No image URL found on shot — cannot evaluate');
    }

    // Build QC prompt (v3 — 3 dimensions only, no wardrobe check)
    const qcPrompt = labelQC
      ? buildLabelQCPrompt()
      : buildQCPrompt({
          shotType: shot.shotType,
          garmentCategory: job.garmentCategory,
          garmentDescription: job.description,
          metadata: job.metadata || {},
        });

    parts.push({ text: qcPrompt });

    // Call Gemini 2.5 Pro
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY env var not set');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${QC_MODEL}:generateContent?key=${apiKey}`;

    console.log(`[QC] Calling Gemini with ${parts.length} parts (refs + generated + prompt)`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`QC API error ${response.status}: ${error}`);
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];
    const textPart = candidate?.content?.parts?.find((p: Record<string, unknown>) => p.text);

    if (!textPart?.text) {
      throw new Error('No QC response from Gemini');
    }

    // Parse JSON response (handle markdown code blocks)
    let qcText = textPart.text.trim();
    if (qcText.startsWith('```')) {
      qcText = qcText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const qcScores = JSON.parse(qcText);

    // QC v4 scoring — simple average of 4 dimensions
    if (!labelQC && qcScores.color_match) {
      const ws = (
        (qcScores.color_match?.score || 0) +
        (qcScores.waist_height?.score || 0) +
        (qcScores.garment_length?.score || 0) +
        (qcScores.construction_fidelity?.score || 0)
      ) / 4;
      qcScores.weighted_score = Math.round(ws * 10) / 10;

      // Pass requires average >= 7.0 AND no dimension below 4
      const allScores = [
        qcScores.color_match?.score || 0,
        qcScores.waist_height?.score || 0,
        qcScores.garment_length?.score || 0,
        qcScores.construction_fidelity?.score || 0,
      ];
      const minScore = Math.min(...allScores);
      qcScores.pass = ws >= 7.0 && minScore >= 4;

      if (!qcScores.critical_issues) qcScores.critical_issues = [];
      const dimNames: Record<string, string> = {
        color_match: 'Color Match',
        waist_height: 'Waist Height',
        garment_length: 'Garment Length',
        construction_fidelity: 'Construction Fidelity',
      };
      for (const [key, label] of Object.entries(dimNames)) {
        const s = qcScores[key]?.score || 0;
        if (s < 4) {
          const note = qcScores[key]?.note || '';
          qcScores.critical_issues.push(`${label}: ${s}/10 — ${note}`);
        }
      }
    }

    // Store QC scores on the shot document
    const qcUpdate: Record<string, unknown> = {
      qcRunAt: new Date(),
      qcPass: qcScores.pass,
    };
    if (labelQC) {
      qcUpdate.labelQC = qcScores;
    } else {
      qcUpdate.qcScores = qcScores;
    }
    await shotsCol.doc(shotId).update(qcUpdate);

    console.log(`[QC] Shot ${shotId}: weighted=${qcScores.weighted_score}, pass=${qcScores.pass}, critical=${qcScores.critical_issues?.length || 0}`);

    return NextResponse.json({
      success: true,
      shotId,
      qcScores,
    });
  } catch (error) {
    console.error('QC error:', error);
    return NextResponse.json(
      { error: 'QC failed', details: String(error) },
      { status: 500 }
    );
  }
}
