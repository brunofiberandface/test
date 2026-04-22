/**
 * One-time cleanup: remove unnecessary image fields from shoe wardrobe items.
 * Keeps: flatFrontUrl, flatBackUrl, thumbnailUrl, and metadata.
 * Removes: fitModelUrls, imageUrls, fitModels.
 *
 * POST /api/wardrobe/cleanup-shoes
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/firestore';
import { FieldValue } from '@google-cloud/firestore';

export async function POST() {
  try {
    const wardrobeCol = db.collection('wardrobe');
    const snap = await wardrobeCol.where('category', '==', 'shoes').get();

    const results: Array<{ id: string; name: string; removed: string[] }> = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const removed: string[] = [];
      const updates: Record<string, any> = {};

      if (data.fitModelUrls) {
        updates.fitModelUrls = FieldValue.delete();
        removed.push(`fitModelUrls (${Array.isArray(data.fitModelUrls) ? data.fitModelUrls.length : '?'} items)`);
      }
      if (data.imageUrls) {
        updates.imageUrls = FieldValue.delete();
        removed.push(`imageUrls (${Array.isArray(data.imageUrls) ? data.imageUrls.length : '?'} items)`);
      }
      if (data.fitModels) {
        updates.fitModels = FieldValue.delete();
        removed.push('fitModels');
      }

      if (removed.length > 0) {
        updates.updatedAt = new Date();
        await doc.ref.update(updates);
      }

      results.push({
        id: doc.id,
        name: data.name || '',
        removed: removed.length > 0 ? removed : ['nothing to remove'],
      });
    }

    return NextResponse.json({
      success: true,
      total: snap.docs.length,
      cleaned: results.filter(r => r.removed[0] !== 'nothing to remove').length,
      results,
    });
  } catch (error) {
    console.error('[CleanupShoes] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
