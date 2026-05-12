/**
 * /api/label-assets/[id]
 * DELETE → remove a label template, but only if no wardrobe item references it.
 *
 * Guard: queries wardrobeItems for any doc where leatherLabelTemplateId == id
 *        OR pocketLabelTemplateId == id. If any match exists, returns 409 with
 *        the list of referencing items so the caller can re-map them first.
 *
 * If safe, deletes the GCS file + Firestore doc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { labelAssetsCol, wardrobeCol } from '@/lib/firestore';
import { Storage } from '@google-cloud/storage';

const BUCKET = 'gstar-ai-studio-assets';

let _storage: Storage | null = null;
function gcs(): Storage {
  if (!_storage) _storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
  return _storage;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const doc = await labelAssetsCol.doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const data = doc.data() as { type?: string; imageUrl?: string };

    // Reference guard — block delete if any wardrobe item points at this template.
    const [leatherRefs, pocketRefs] = await Promise.all([
      wardrobeCol.where('leatherLabelTemplateId', '==', id).get(),
      wardrobeCol.where('pocketLabelTemplateId', '==', id).get(),
    ]);
    const refs: { id: string; designNumber?: string; field: 'leather' | 'pocket' }[] = [];
    leatherRefs.forEach(d => refs.push({ id: d.id, designNumber: d.data()?.designNumber, field: 'leather' }));
    pocketRefs.forEach(d => refs.push({ id: d.id, designNumber: d.data()?.designNumber, field: 'pocket' }));

    if (refs.length > 0) {
      return NextResponse.json(
        {
          error: `Template is in use by ${refs.length} wardrobe item(s). Re-map them before deleting.`,
          references: refs,
        },
        { status: 409 },
      );
    }

    // Safe to delete. Try GCS first, then Firestore.
    if (data.imageUrl) {
      const prefix = `https://storage.googleapis.com/${BUCKET}/`;
      if (data.imageUrl.startsWith(prefix)) {
        const gcsPath = data.imageUrl.substring(prefix.length);
        try {
          await gcs().bucket(BUCKET).file(gcsPath).delete();
        } catch (e) {
          // Don't block on GCS — orphan file is recoverable, but blocking the Firestore delete isn't worth it.
          console.warn(`Failed to delete GCS file ${gcsPath}:`, e);
        }
      }
    }
    await labelAssetsCol.doc(id).delete();

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
