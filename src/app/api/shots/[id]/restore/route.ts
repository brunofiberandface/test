import { NextRequest, NextResponse } from 'next/server';
import { shotsCol } from '@/lib/firestore';

// POST /api/shots/[id]/restore
// Body: { version: number }  — the previous version number to restore
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { version: targetVersion } = await req.json();

    if (typeof targetVersion !== 'number') {
      return NextResponse.json({ error: 'version is required (number)' }, { status: 400 });
    }

    const shotDoc = await shotsCol.doc(id).get();
    if (!shotDoc.exists) {
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }

    const shot = shotDoc.data()!;
    const previousVersions: Array<{ imageUrl: string; version: number; createdAt: any }> =
      shot.previousVersions || [];

    // Find the target version in history
    const targetIdx = previousVersions.findIndex((pv) => pv.version === targetVersion);
    if (targetIdx === -1) {
      return NextResponse.json({ error: `Version ${targetVersion} not found in history` }, { status: 404 });
    }

    const target = previousVersions[targetIdx];

    // Push current version into history (so nothing is ever lost)
    const updatedHistory = [...previousVersions];
    updatedHistory.splice(targetIdx, 1); // Remove the one we're restoring
    updatedHistory.push({
      imageUrl: shot.imageUrl,
      version: shot.version,
      createdAt: shot.updatedAt || new Date(),
    });

    // Sort history by version ascending
    updatedHistory.sort((a, b) => a.version - b.version);

    // New version = max of all versions + 1
    const allVersions = [shot.version, ...updatedHistory.map((v) => v.version)];
    const newVersion = Math.max(...allVersions) + 1;

    await shotsCol.doc(id).update({
      imageUrl: target.imageUrl,
      version: newVersion,
      previousVersions: updatedHistory,
      status: 'done',
      updatedAt: new Date(),
    });

    console.log(`[Restore] Shot ${id}: restored v${targetVersion} as v${newVersion}`);

    return NextResponse.json({ success: true, restoredFrom: targetVersion, newVersion });
  } catch (error) {
    console.error('Error restoring shot version:', error);
    return NextResponse.json({ error: 'Failed to restore version' }, { status: 500 });
  }
}
