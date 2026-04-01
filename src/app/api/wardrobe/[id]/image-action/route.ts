import { NextRequest, NextResponse } from 'next/server';
import { getWardrobeItem, wardrobeCol } from '@/lib/firestore';
import { downloadGarmentImage } from '@/lib/gcs';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

const BUCKET_NAME = 'gstar-ai-studio-assets';

function getStorage(): Storage {
  return new Storage({ projectId: process.env.GCP_PROJECT_ID });
}

/**
 * POST /api/wardrobe/[id]/image-action
 * Body: { action: 'rotate' | 'delete', url: string, imageType: 'mannequin' | 'flat' | 'fitModel' }
 *
 * rotate: Downloads image from GCS, rotates 90° clockwise with Sharp, re-uploads.
 * delete: Removes URL from the appropriate array in Firestore. Does NOT delete from GCS (safe).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, url, imageType } = body;

    if (!action || !url) {
      return NextResponse.json({ error: 'action and url are required' }, { status: 400 });
    }

    const item = await getWardrobeItem(id);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    const itemData = item as any;

    // Strip query params (?v=...) for GCS operations — always use the clean base URL
    const cleanUrl = url.split('?')[0];

    if (action === 'rotate' || action === 'rotate-left') {
      // Download → rotate → re-upload to same path
      const degrees = action === 'rotate-left' ? 270 : 90; // 270° = 90° counter-clockwise
      const buffer = await downloadGarmentImage(cleanUrl);
      const rotated = await sharp(buffer).rotate(degrees).jpeg({ quality: 95 }).toBuffer();

      // Extract GCS path from clean URL (no query params)
      const gcsPath = cleanUrl.replace(`https://storage.googleapis.com/${BUCKET_NAME}/`, '');
      const storage = getStorage();
      const bucket = storage.bucket(BUCKET_NAME);
      const file = bucket.file(gcsPath);

      await file.save(rotated, {
        metadata: { contentType: 'image/jpeg' },
      });

      // Append cache-buster to URL so the browser fetches the new version
      const newUrl = `${cleanUrl}?v=${Date.now()}`;

      // Update Firestore URL with cache-buster
      if (imageType === 'flat') {
        await wardrobeCol.doc(id).update({ flatImageUrl: newUrl, updatedAt: new Date() });
      } else if (imageType === 'fitModel') {
        const urls = [...(itemData.fitModelUrls || [])];
        const idx = urls.findIndex((u: string) => u.split('?')[0] === url.split('?')[0]);
        if (idx >= 0) urls[idx] = newUrl;
        await wardrobeCol.doc(id).update({ fitModelUrls: urls, updatedAt: new Date() });
      } else {
        // mannequin (imageUrls)
        const urls = [...(itemData.imageUrls || [])];
        const idx = urls.findIndex((u: string) => u.split('?')[0] === url.split('?')[0]);
        if (idx >= 0) urls[idx] = newUrl;
        const updates: any = { imageUrls: urls, updatedAt: new Date() };
        // Update thumbnail if it was the first image
        if (idx === 0) updates.thumbnailUrl = newUrl;
        await wardrobeCol.doc(id).update(updates);
      }

      return NextResponse.json({ ok: true, newUrl });

    } else if (action === 'delete') {
      if (imageType === 'flat') {
        await wardrobeCol.doc(id).update({ flatImageUrl: '', updatedAt: new Date() });
      } else if (imageType === 'fitModel') {
        const urls = (itemData.fitModelUrls || []).filter(
          (u: string) => u.split('?')[0] !== cleanUrl
        );
        await wardrobeCol.doc(id).update({ fitModelUrls: urls, updatedAt: new Date() });
      } else {
        // mannequin
        const urls = (itemData.imageUrls || []).filter(
          (u: string) => u.split('?')[0] !== cleanUrl
        );
        const updates: any = { imageUrls: urls, updatedAt: new Date() };
        if (urls.length > 0) updates.thumbnailUrl = urls[0];
        await wardrobeCol.doc(id).update(updates);
      }

      return NextResponse.json({ ok: true });

    } else {
      return NextResponse.json({ error: 'Unknown action. Use "rotate", "rotate-left", or "delete".' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[Wardrobe Image Action]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
