// DEPRECATED — backfill completed 2026-04-06. Safe to delete this file.
import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ error: 'Backfill already completed. Delete this endpoint.' }, { status: 410 });
}
