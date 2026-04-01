'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';

type WardrobeCategory = 'shoes' | 'shirt' | 'jacket' | 'pants';

type WardrobeGender = 'male' | 'female' | 'unisex';

interface WardrobeItem {
  id: string;
  wardrobeId: string;
  name: string;
  category: WardrobeCategory;
  gender?: WardrobeGender;
  description: string;
  imageUrls: string[];
  fitModelUrls?: string[];
  flatImageUrl?: string;
  thumbnailUrl: string;
  isPrimary?: boolean;  // true = focus garment (step 1), false = styling item (step 3)
  openShoes?: boolean;  // true = open-toe shoes (sandals, slides) — triggers foot resize
  hasHeels?: boolean;   // true = heeled shoes — adjusts M01/M02 crop position higher
}

// Derive isPrimary default from category (shoes = styling, rest = focus)
function defaultIsPrimary(cat: WardrobeCategory): boolean {
  return cat !== 'shoes';
}

// Derive gender default from category (shoes = unisex, rest = unisex unless specified)
function defaultGender(cat: WardrobeCategory): WardrobeGender {
  return cat === 'shoes' ? 'unisex' : 'unisex';
}

const GENDER_OPTIONS: { value: WardrobeGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unisex', label: 'Unisex' },
];

const CATEGORIES: { value: WardrobeCategory; label: string }[] = [
  { value: 'shoes', label: 'Shoes' },
  { value: 'shirt', label: 'Shirts' },
  { value: 'jacket', label: 'Jackets' },
  { value: 'pants', label: 'Pants' },
];

export default function WardrobePage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<WardrobeCategory | 'all'>('all');
  const [filterGender, setFilterGender] = useState<'all' | 'male' | 'female' | 'unisex'>('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Detail panel
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<WardrobeCategory>('shoes');
  const [editGender, setEditGender] = useState<WardrobeGender>('unisex');
  const [editIsPrimary, setEditIsPrimary] = useState<boolean>(false);
  const [editOpenShoes, setEditOpenShoes] = useState<boolean>(false);
  const [editHasHeels, setEditHasHeels] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [imageActionLoading, setImageActionLoading] = useState<string | null>(null); // URL being acted on
  const [editFlatFile, setEditFlatFile] = useState<File | null>(null);
  const [editFlatPreview, setEditFlatPreview] = useState<string | null>(null);

  // Add form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<WardrobeCategory>('shoes');
  const [genderCreate, setGenderCreate] = useState<WardrobeGender>('unisex');
  const [isPrimaryCreate, setIsPrimaryCreate] = useState<boolean>(false); // shoes default = false
  const [openShoesCreate, setOpenShoesCreate] = useState<boolean>(false);
  const [hasHeelsCreate, setHasHeelsCreate] = useState<boolean>(false);
  const [description, setDescription] = useState('');
  const [files360, setFiles360] = useState<File[]>([]);
  const [fileFlat, setFileFlat] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Translation state — create form
  const [translatingCreate, setTranslatingCreate] = useState(false);
  const [translatedCreate, setTranslatedCreate] = useState('');
  // Translation state — edit panel
  const [translatingEdit, setTranslatingEdit] = useState(false);
  const [translatedEdit, setTranslatedEdit] = useState('');

  const translateText = async (text: string, setTranslating: (v: boolean) => void, setPreview: (v: string) => void) => {
    if (!text.trim()) return;
    setTranslating(true);
    setPreview('');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.translated) {
        setPreview(data.translated);
      } else {
        setPreview(`⚠ Translation failed: ${data.error || 'unknown error'}`);
      }
    } catch (e) {
      setPreview(`⚠ Translation failed: ${String(e)}`);
    } finally {
      setTranslating(false);
    }
  };

  const user = session?.user as any;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const url = filterCategory === 'all' ? '/api/wardrobe' : `/api/wardrobe?category=${filterCategory}`;
    const res = await fetch(url);
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }, [filterCategory]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Client-side gender filter
  const filteredItems = filterGender === 'all'
    ? items
    : items.filter(i => (i.gender || 'unisex') === filterGender || (i.gender || 'unisex') === 'unisex');

  // Open detail panel
  function openItem(item: WardrobeItem) {
    setSelectedItem(item);
    setEditName(item.name);
    setEditDescription(item.description);
    setEditCategory(item.category);
    setEditGender(item.gender || defaultGender(item.category));
    setEditIsPrimary(item.isPrimary !== undefined ? item.isPrimary : defaultIsPrimary(item.category));
    setEditOpenShoes(item.openShoes || false);
    setEditHasHeels((item as any).hasHeels || false);
    setEditFlatFile(null);
    setEditFlatPreview(null);
    setDeleteConfirm(false);
  }

  function closePanel() {
    setSelectedItem(null);
    setLightboxUrl(null);
    setDeleteConfirm(false);
  }

  async function saveEdit() {
    if (!selectedItem) return;
    setSaving(true);
    try {
      // Convert flat image to base64 if a new one was selected
      let flatImageBase64: string | undefined;
      if (editFlatFile) {
        flatImageBase64 = await fileToBase64(editFlatFile);
      }

      const patchBody: Record<string, any> = {
        name: editName, description: editDescription, category: editCategory,
        isPrimary: editIsPrimary, gender: editGender, openShoes: editOpenShoes, hasHeels: editHasHeels,
      };
      if (flatImageBase64) patchBody.flatImageBase64 = flatImageBase64;

      const res = await fetch(`/api/wardrobe/${selectedItem.wardrobeId || selectedItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (res.ok) {
        const data = await res.json();
        // Update local state — include new flatImageUrl if returned
        const updated = {
          ...selectedItem, name: editName, description: editDescription, category: editCategory,
          isPrimary: editIsPrimary, gender: editGender, openShoes: editOpenShoes, hasHeels: editHasHeels,
          ...(data.flatImageUrl ? { flatImageUrl: data.flatImageUrl } : {}),
        } as any;
        setSelectedItem(updated);
        setItems(prev => prev.map(i => (i.id === selectedItem.id ? updated : i)));
        // Clear flat file state after successful upload
        if (editFlatFile) {
          setEditFlatFile(null);
          setEditFlatPreview(null);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem() {
    if (!selectedItem) return;
    const res = await fetch(`/api/wardrobe/${selectedItem.wardrobeId || selectedItem.id}`, { method: 'DELETE' });
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== selectedItem.id));
      closePanel();
    }
  }

  async function handleImageAction(action: 'rotate' | 'rotate-left' | 'delete', url: string, imageType: 'mannequin' | 'flat' | 'fitModel') {
    if (!selectedItem || imageActionLoading) return;
    if (action === 'delete' && !confirm('Delete this image?')) return;
    setImageActionLoading(url);
    try {
      const res = await fetch(`/api/wardrobe/${selectedItem.wardrobeId || selectedItem.id}/image-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, url, imageType }),
      });
      if (res.ok) {
        // Refresh item data
        const itemRes = await fetch(`/api/wardrobe/${selectedItem.wardrobeId || selectedItem.id}`);
        if (itemRes.ok) {
          const { item: updatedItem } = await itemRes.json();
          setSelectedItem(updatedItem);
          // Update in the main list too
          setItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));
        }
      } else {
        const err = await res.json();
        alert(`Action failed: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setImageActionLoading(null);
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 2048;
          if (img.width <= MAX && img.height <= MAX) { resolve(reader.result as string); return; }
          const scale = MAX / Math.max(img.width, img.height);
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !description || files360.length === 0) return;
    setUploading(true);
    try {
      const images360Base64 = await Promise.all(files360.map(f => fileToBase64(f)));
      let flatImageBase64: string | undefined;
      if (fileFlat) flatImageBase64 = await fileToBase64(fileFlat);
      const res = await fetch('/api/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, description, images360Base64, flatImageBase64, isPrimary: isPrimaryCreate, gender: genderCreate, openShoes: openShoesCreate, hasHeels: hasHeelsCreate }),
      });
      if (res.ok) {
        setName(''); setDescription(''); setFiles360([]); setFileFlat(null); setShowForm(false);
        setIsPrimaryCreate(false);
        setGenderCreate('unisex');
        fetchItems();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  // All images for selected item (360° + flat + fit model)
  const mannequinImages = selectedItem?.imageUrls || [];
  const fitModelImages = selectedItem?.fitModelUrls || [];
  const allImages = selectedItem
    ? [...mannequinImages, ...(selectedItem.flatImageUrl ? [selectedItem.flatImageUrl] : [])]
    : [];

  return (
    <Shell user={user ? { email: user.email, name: user.name || '', role: user.role || 'creator' } : undefined}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Wardrobe</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Stock items for dressing AI models. Click any item to view and edit.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Item'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 bg-white border border-neutral-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Name</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Black Chelsea Boot"
                className="w-full border border-neutral-300 px-3 py-2 text-sm" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Category</label>
              <div className="flex gap-2">
                {CATEGORIES.map(c => (
                  <button key={c.value} type="button" onClick={() => {
                    setCategory(c.value);
                    setIsPrimaryCreate(defaultIsPrimary(c.value));
                    setGenderCreate(defaultGender(c.value));
                  }}
                    className={`px-3 py-2 text-sm border transition-colors ${category === c.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
              {/* Gender selector */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-500">Gender:</span>
                {GENDER_OPTIONS.map(g => (
                  <button key={g.value} type="button" onClick={() => setGenderCreate(g.value)}
                    className={`px-2.5 py-1 text-xs border transition-colors ${genderCreate === g.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
              {/* Role toggle — auto-set from category, overridable */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-500">Used as:</span>
                <button type="button" onClick={() => setIsPrimaryCreate(true)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${isPrimaryCreate ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                  Focus garment
                </button>
                <button type="button" onClick={() => setIsPrimaryCreate(false)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${!isPrimaryCreate ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                  Styling item
                </button>
                <span className="text-xs text-neutral-400">
                  {isPrimaryCreate ? '→ selectable in step 1' : '→ selectable in outfit step'}
                </span>
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">Description (for AI prompt) — <span className="text-red-500">English only</span></label>
              {description.trim() && !translatedCreate && (
                <button type="button" onClick={() => translateText(description, setTranslatingCreate, setTranslatedCreate)}
                  disabled={translatingCreate} className="text-xs text-neutral-500 hover:text-neutral-900 underline disabled:opacity-40">
                  {translatingCreate ? 'Translating…' : 'Translate to English'}
                </button>
              )}
            </div>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setTranslatedCreate(''); }}
              placeholder="English only. e.g.: Black leather Chelsea boots with elastic side panels, low block heel, rounded toe"
              className="w-full border border-neutral-300 px-3 py-2 text-sm h-20" required
            />
            {translatedCreate && (
              <div className="mt-1 border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Translated — approve to use</p>
                <p className="text-neutral-700 whitespace-pre-wrap">{translatedCreate}</p>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => { setDescription(translatedCreate); setTranslatedCreate(''); }}
                    className="px-3 py-1 bg-neutral-900 text-white text-xs hover:bg-neutral-700">Use this</button>
                  <button type="button" onClick={() => setTranslatedCreate('')}
                    className="px-3 py-1 border border-neutral-300 text-xs hover:border-neutral-900">Keep original</button>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">360° Photos</label>
              <input type="file" multiple accept="image/*" onChange={(e) => setFiles360(Array.from(e.target.files || []))} className="w-full text-sm" />
              {files360.length > 0 && <p className="text-xs text-neutral-400 mt-1">{files360.length} photos selected</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Flat Image (optional)</label>
              <input type="file" accept="image/*" onChange={(e) => setFileFlat(e.target.files?.[0] || null)} className="w-full text-sm" />
            </div>
          </div>
          <button type="submit" disabled={uploading || !name || !description || files360.length === 0}
            className="px-6 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40 transition-colors">
            {uploading ? 'Uploading...' : 'Save to Wardrobe'}
          </button>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex gap-2">
          {[{ value: 'all', label: 'All' }, ...CATEGORIES].map(c => (
            <button key={c.value} onClick={() => setFilterCategory(c.value as any)}
              className={`px-3 py-1.5 text-sm border transition-colors ${filterCategory === c.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-neutral-300" />
        <div className="flex gap-2">
          {[{ value: 'all', label: 'All' }, { value: 'male', label: 'Men' }, { value: 'female', label: 'Women' }].map(g => (
            <button key={g.value} onClick={() => setFilterGender(g.value as any)}
              className={`px-3 py-1.5 text-sm border transition-colors ${filterGender === g.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300'}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Items grid */}
      {loading ? (
        <p className="text-sm text-neutral-400">Loading wardrobe...</p>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <p className="text-lg mb-2">No items yet</p>
          <p className="text-sm">Add stock items to dress your AI models with matching shoes, shirts, jackets, and pants.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredItems.map(item => (
            <div key={item.id} onClick={() => openItem(item)}
              className="bg-white border border-neutral-200 overflow-hidden group cursor-pointer hover:border-neutral-400 hover:shadow-sm transition-all">
              <div className="aspect-square bg-neutral-100 relative">
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">No image</div>
                )}
                {/* Category badge — only show when viewing "All" */}
                {filterCategory === 'all' && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-neutral-900 text-white text-xs uppercase">
                    {item.category}
                  </span>
                )}
                <span className={`absolute top-2 right-2 px-1.5 py-0.5 text-[9px] uppercase font-medium ${
                  (item.isPrimary !== undefined ? item.isPrimary : defaultIsPrimary(item.category))
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-500 text-white'
                }`}>
                  {(item.isPrimary !== undefined ? item.isPrimary : defaultIsPrimary(item.category)) ? 'focus' : 'styling'}
                  {item.openShoes && <span className="ml-1 text-[9px] text-orange-500">open</span>}
                                  {(item as any).hasHeels && <span className="ml-1 text-[9px] text-purple-500">heels</span>}
                </span>
                {item.imageUrls?.length > 1 && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 text-white text-xs">
                    {item.imageUrls.length + (item.flatImageUrl ? 1 : 0)} imgs
                  </span>
                )}
              </div>
              <div className="p-3">
                <h3 className="text-sm font-medium text-neutral-900 truncate">{item.name}</h3>
                <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel (slide-in from right) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/40" onClick={closePanel} />

          {/* Panel */}
          <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 flex-shrink-0">
              <span className="px-2 py-0.5 bg-neutral-900 text-white text-xs uppercase">{selectedItem.category}</span>
              <button onClick={closePanel} className="text-neutral-400 hover:text-neutral-900 text-xl leading-none">✕</button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Mannequin / 360° image thumbnails */}
              <div>
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                  Mannequin / 360° ({allImages.length})
                </p>
                {allImages.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {allImages.map((url, i) => {
                      const isFlat = selectedItem.flatImageUrl && url.split('?')[0] === selectedItem.flatImageUrl.split('?')[0];
                      const imgType = isFlat ? 'flat' as const : 'mannequin' as const;
                      const isLoading = imageActionLoading?.split('?')[0] === url.split('?')[0];
                      return (
                        <div key={`m-${i}-${url}`}
                          className="aspect-square bg-neutral-100 overflow-hidden cursor-pointer hover:ring-2 hover:ring-neutral-900 transition-all relative group">
                          <img src={url} alt={`View ${i + 1}`} onClick={() => setLightboxUrl(url)}
                            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ${isLoading ? 'opacity-40' : ''}`} />
                          {isFlat && (
                            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-0.5">flat</span>
                          )}
                          {/* Rotate + Delete overlay */}
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('rotate-left', url, imgType); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-black/70 text-white text-xs flex items-center justify-center hover:bg-black/90 disabled:opacity-40"
                              title="Rotate 90° left"
                            >↺</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('rotate', url, imgType); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-black/70 text-white text-xs flex items-center justify-center hover:bg-black/90 disabled:opacity-40"
                              title="Rotate 90° right"
                            >↻</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('delete', url, imgType); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-red-600/80 text-white text-xs flex items-center justify-center hover:bg-red-700 disabled:opacity-40"
                              title="Delete image"
                            >✕</button>
                          </div>
                          {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <span className="text-white text-xs animate-pulse">...</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-400">No images</p>
                )}
              </div>

              {/* Fit model images */}
              {fitModelImages.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                    Fit Model ({fitModelImages.length})
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {fitModelImages.map((url, i) => {
                      const isLoading = imageActionLoading?.split('?')[0] === url.split('?')[0];
                      return (
                        <div key={`fit-${i}-${url}`}
                          className="aspect-square bg-neutral-100 overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all relative group">
                          <img src={url} alt={`Fit ${i + 1}`} onClick={() => setLightboxUrl(url)}
                            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ${isLoading ? 'opacity-40' : ''}`} />
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-emerald-600 text-white text-[9px] uppercase">fit</span>
                          {/* Rotate + Delete overlay */}
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('rotate-left', url, 'fitModel'); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-black/70 text-white text-xs flex items-center justify-center hover:bg-black/90 disabled:opacity-40"
                              title="Rotate 90° left"
                            >↺</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('rotate', url, 'fitModel'); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-black/70 text-white text-xs flex items-center justify-center hover:bg-black/90 disabled:opacity-40"
                              title="Rotate 90° right"
                            >↻</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageAction('delete', url, 'fitModel'); }}
                              disabled={!!imageActionLoading}
                              className="w-6 h-6 bg-red-600/80 text-white text-xs flex items-center justify-center hover:bg-red-700 disabled:opacity-40"
                              title="Delete image"
                            >✕</button>
                          </div>
                          {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <span className="text-white text-xs animate-pulse">...</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Editable fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Name</label>
                  <input
                    type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Category</label>
                  <div className="flex gap-2 flex-wrap">
                    {CATEGORIES.map(c => (
                      <button key={c.value} type="button" onClick={() => setEditCategory(c.value)}
                        className={`px-3 py-1.5 text-sm border transition-colors ${editCategory === c.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {/* Gender selector */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Gender:</span>
                    {GENDER_OPTIONS.map(g => (
                      <button key={g.value} type="button" onClick={() => setEditGender(g.value)}
                        className={`px-2.5 py-1 text-xs border transition-colors ${editGender === g.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                  {/* Role toggle */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Used as:</span>
                    <button type="button" onClick={() => setEditIsPrimary(true)}
                      className={`px-2.5 py-1 text-xs border transition-colors ${editIsPrimary ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                      Focus garment
                    </button>
                    <button type="button" onClick={() => setEditIsPrimary(false)}
                      className={`px-2.5 py-1 text-xs border transition-colors ${!editIsPrimary ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                      Styling item
                    </button>
                    <span className="text-xs text-neutral-400">
                      {editIsPrimary ? '→ step 1' : '→ outfit step'}
                    </span>
                  </div>
                  {editCategory === 'shoes' && (<>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Open shoes:</span>
                    <button type="button" onClick={() => setEditOpenShoes(!editOpenShoes)}
                      className={`px-2.5 py-1 text-xs border transition-colors ${editOpenShoes ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                      {editOpenShoes ? 'Open toe ✓' : 'Closed shoe'}
                    </button>
                    <span className="text-[10px] text-neutral-400">{editOpenShoes ? '→ foot resize active' : '→ no foot resize'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Heels:</span>
                    <button type="button" onClick={() => setEditHasHeels(!editHasHeels)}
                      className={`px-2.5 py-1 text-xs border transition-colors ${editHasHeels ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                      {editHasHeels ? 'Heels ✓' : 'Flat shoe'}
                    </button>
                    <span className="text-[10px] text-neutral-400">{editHasHeels ? '→ crop adjusts higher' : '→ standard crop'}</span>
                  </div>
                  </>)}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">Description (used in AI prompt) — <span className="text-red-500">English only</span></label>
                    {editDescription.trim() && !translatedEdit && (
                      <button type="button" onClick={() => translateText(editDescription, setTranslatingEdit, setTranslatedEdit)}
                        disabled={translatingEdit} className="text-xs text-neutral-500 hover:text-neutral-900 underline disabled:opacity-40">
                        {translatingEdit ? 'Translating…' : 'Translate to English'}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={editDescription} onChange={(e) => { setEditDescription(e.target.value); setTranslatedEdit(''); }}
                    rows={5}
                    placeholder="English only — this text is sent directly to the AI model."
                    className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 resize-none"
                  />
                  {translatedEdit && (
                    <div className="mt-1 border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Translated — approve to use</p>
                      <p className="text-neutral-700 whitespace-pre-wrap">{translatedEdit}</p>
                      <div className="flex gap-2 mt-2">
                        <button type="button" onClick={() => { setEditDescription(translatedEdit); setTranslatedEdit(''); }}
                          className="px-3 py-1 bg-neutral-900 text-white text-xs hover:bg-neutral-700">Use this</button>
                        <button type="button" onClick={() => setTranslatedEdit('')}
                          className="px-3 py-1 border border-neutral-300 text-xs hover:border-neutral-900">Keep original</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Flat image (product-on-white) — used for accurate color extraction */}
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">
                    Flat Image <span className="text-neutral-400 normal-case">(product-on-white — used for color extraction)</span>
                  </label>
                  {(selectedItem?.flatImageUrl || editFlatPreview) && (
                    <div className="mb-2 relative inline-block">
                      <img
                        src={editFlatPreview || selectedItem?.flatImageUrl}
                        alt="Flat image"
                        className="h-24 w-24 object-contain border border-neutral-200 bg-white cursor-pointer"
                        onClick={() => setLightboxUrl(editFlatPreview || selectedItem?.flatImageUrl || null)}
                      />
                      {editFlatPreview && (
                        <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] px-1 rounded">NEW</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer px-3 py-1.5 text-xs border border-neutral-300 hover:border-neutral-500 transition-colors bg-white text-neutral-600">
                      {selectedItem?.flatImageUrl ? 'Replace flat image' : 'Upload flat image'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setEditFlatFile(f);
                            setEditFlatPreview(URL.createObjectURL(f));
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {editFlatFile && (
                      <span className="text-xs text-green-600">{editFlatFile.name} — will upload on Save</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200 flex-shrink-0 bg-white">
              {/* Delete */}
              {!deleteConfirm ? (
                <button onClick={() => setDeleteConfirm(true)}
                  className="px-4 py-2 text-sm text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600">Sure?</span>
                  <button onClick={deleteItem} className="px-3 py-1.5 text-sm bg-red-600 text-white hover:bg-red-700">Yes, delete</button>
                  <button onClick={() => setDeleteConfirm(false)} className="px-3 py-1.5 text-sm border border-neutral-300 hover:bg-neutral-50">Cancel</button>
                </div>
              )}

              {/* Save */}
              <button onClick={saveEdit} disabled={saving}
                className="px-6 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40 transition-colors">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox for full image view */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl hover:text-neutral-300" onClick={() => setLightboxUrl(null)}>✕</button>
          <img src={lightboxUrl} alt="Full view"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Shell>
  );
}
