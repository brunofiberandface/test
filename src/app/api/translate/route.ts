import { NextRequest, NextResponse } from 'next/server';

// POST /api/translate
// Translates + proofreads garment description text into English using Gemini text API
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text: string };
    if (!text?.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_TEXT_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_TEXT_API_KEY or GEMINI_API_KEY not set' }, { status: 500 });

    const prompt = `You are a fashion copywriter. Translate the following garment description to English and lightly proofread it (fix grammar, improve clarity). Output ONLY the translated/proofread text — no preamble, no explanation, no quotes.

Input:
${text}

Output (English only):`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Gemini error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    // Gemini 2.5 Flash is a thinking model — filter out thought parts, join remaining text
    const allParts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts || [];
    const translated = allParts
      .filter(p => !p.thought && typeof p.text === 'string')
      .map(p => p.text)
      .join('')
      .trim();
    if (!translated) {
      return NextResponse.json({ error: 'No translation returned' }, { status: 500 });
    }

    return NextResponse.json({ translated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
