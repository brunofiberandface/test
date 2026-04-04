/**
 * POST /api/qc — QC endpoint placeholder.
 * QC will be rebuilt later. For now returns a stub response.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'QC not yet implemented in v2 Pro pipeline',
    qc: { pass: true, score: 0 },
  });
}
