'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';

interface LabelAsset {
  id: string;
  type: 'leather' | 'pocket';
  displayName: string;
  imageUrl: string;
}

export default function LabelsPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<LabelAsset[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [addOpen, setAddOpen] = useState<'leather' | 'pocket' | null>(null);
  const [addName, setAddName] = useState('');
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPreview, setAddPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const user = session?.user as any;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/label-assets');
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openAdd(type: 'leather' | 'pocket') {
    setAddOpen(type);
    setAddName('');
    setAddFile(null);
    setAddPreview(null);
    setUploadError(null);
  }

  function closeAdd() {
    setAddOpen(null);
    setAddName('');
    setAddFile(null);
    setAddPreview(null);
    setUploadError(null);
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function submitAdd() {
    if (!addOpen || !addName.trim() || !addFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const imageBase64 = await fileToBase64(addFile);
      const res = await fetch('/api/label-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: addOpen, displayName: addName.trim(), imageBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Upload failed.');
        return;
      }
      // Refresh list, close form.
      await fetchItems();
      closeAdd();
    } catch (e: any) {
      setUploadError(e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  async function deleteItem(item: LabelAsset) {
    if (!confirm(`Delete label "${item.displayName}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/label-assets/${item.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      if (data.references) {
        alert(
          `Cannot delete — used by ${data.references.length} wardrobe item(s):\n` +
          data.references.map((r: any) => `• ${r.designNumber || r.id} (${r.field})`).join('\n') +
          '\n\nRe-map those items first, then try again.',
        );
      } else {
        alert(`Delete failed: ${data.error || 'unknown error'}`);
      }
      return;
    }
    setItems(prev => prev.filter(i => i.id !== item.id));
  }

  const leatherItems = items.filter(i => i.type === 'leather');
  const pocketItems = items.filter(i => i.type === 'pocket');

  return (
    <Shell user={user}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Label Library</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Canonical leather waistband + woven pocket label templates. Wardrobe items reference these
              for M04 / M05 generation and the manual warp tool.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <LabelColumn
              title="Leather labels"
              subtitle="Waistband patches"
              items={leatherItems}
              onAdd={() => openAdd('leather')}
              onDelete={deleteItem}
            />
            <LabelColumn
              title="Pocket labels"
              subtitle="Woven back-pocket patches"
              items={pocketItems}
              onAdd={() => openAdd('pocket')}
              onDelete={deleteItem}
            />
          </div>
        )}
      </div>

      {/* Add form modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={closeAdd}>
          <div className="bg-white shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-neutral-900">
              Add new {addOpen === 'leather' ? 'leather' : 'pocket'} label
            </h2>
            <p className="text-xs text-neutral-500">
              Upload a transparent PNG. If the file has no alpha channel, the server will auto-create
              transparency only when the background is uniformly white and the design contains no white pixels.
              Otherwise the upload is rejected — prepare the file in Photoshop/Photopea first.
            </p>

            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Display name</label>
              <input
                type="text"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder={addOpen === 'leather' ? 'e.g. Burgundy Patch' : 'e.g. Red/White Woven'}
                className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Image (PNG)</label>
              <input
                type="file"
                accept="image/png,image/tiff"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  setAddFile(f);
                  if (f) {
                    const reader = new FileReader();
                    reader.onload = () => setAddPreview(reader.result as string);
                    reader.readAsDataURL(f);
                  } else {
                    setAddPreview(null);
                  }
                }}
                className="text-sm"
              />
              {addPreview && (
                <div className="mt-3 border border-neutral-200 p-2 bg-[linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3),linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]">
                  <img src={addPreview} alt="preview" className="max-h-40 mx-auto" />
                </div>
              )}
            </div>

            {uploadError && (
              <div className="border border-red-300 bg-red-50 text-red-800 text-sm px-3 py-2">
                {uploadError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeAdd}
                disabled={uploading}
                className="px-4 py-2 text-sm border border-neutral-300 hover:border-neutral-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAdd}
                disabled={uploading || !addName.trim() || !addFile}
                className="px-4 py-2 text-sm bg-neutral-900 text-white hover:bg-black disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function LabelColumn({
  title, subtitle, items, onAdd, onDelete,
}: {
  title: string;
  subtitle: string;
  items: LabelAsset[];
  onAdd: () => void;
  onDelete: (item: LabelAsset) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 uppercase tracking-wider">{title}</h2>
          <p className="text-xs text-neutral-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="px-3 py-1.5 text-xs border border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white"
        >
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No templates yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {items.map(item => (
            <div key={item.id} className="border border-neutral-200 group">
              <div className="aspect-square bg-[linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3),linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] flex items-center justify-center p-2">
                <img src={item.imageUrl} alt={item.displayName} className="max-h-full max-w-full" />
              </div>
              <div className="p-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-neutral-900 truncate">{item.displayName}</p>
                  <p className="text-[10px] text-neutral-400 truncate">{item.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  className="text-xs text-neutral-400 hover:text-red-600 px-2"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
