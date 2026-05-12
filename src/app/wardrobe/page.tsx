'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';
import { parseGarmentDisplay, styleCodeLabel } from '@/lib/garment-display';

type WardrobeCategory = 'shoes' | 'top' | 'bottom';

type WardrobeGender = 'male' | 'female' | 'unisex';

/** 6 labeled fit model camera angles — ordered: 45°L, center, 45°R per row */
const FIT_MODEL_SLOTS = [
  { key: 'front45Left', label: '45° Left', row: 'front' },
  { key: 'front', label: 'Front', row: 'front' },
  { key: 'front45Right', label: '45° Right', row: 'front' },
  { key: 'back45Left', label: 'Back 45° Left', row: 'back' },
  { key: 'back', label: 'Back', row: 'back' },
  { key: 'back45Right', label: 'Back 45° Right', row: 'back' },
] as const;

type FitModelKey = typeof FIT_MODEL_SLOTS[number]['key'];

interface FitModels {
  front: string;
  front45Left: string;
  front45Right: string;
  back: string;
  back45Left: string;
  back45Right: string;
}

interface WardrobeItem {
  id: string;
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category: WardrobeCategory | string; // string for legacy categories
  gender?: WardrobeGender;
  description: string;
  fitModels?: Partial<FitModels>;   // v2: labeled angles
  fitModelUrls?: string[];           // v1 legacy: flat array
  flatFrontUrl?: string;
  flatBackUrl?: string;
  thumbnailUrl: string;
  openShoes?: boolean;
  hasHeels?: boolean;
  /** Computed server-side for category=bottom items only. True when the
   *  item has either a leatherLabelTemplateId or a three-tier labelStyles
   *  config — meaning the warp tool will work. Undefined for non-bottoms. */
  labelReady?: boolean;
  leatherLabelTemplateId?: string;
  pocketLabelTemplateId?: string;
}

interface LabelAsset {
  id: string;
  type: 'leather' | 'pocket';
  displayName: string;
  imageUrl: string;
}

const GENDER_OPTIONS: { value: WardrobeGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unisex', label: 'Unisex' },
];

const CATEGORIES: { value: WardrobeCategory; label: string }[] = [
  { value: 'shoes', label: 'Shoes' },
  { value: 'top', label: 'Tops' },
  { value: 'bottom', label: 'Bottoms' },
];

/**
 * Extract the style-code prefix from a full design number.
 * e.g. "D15264-C052-D332" -> "D15264". Empty-safe.
 * Multiple colorways / fits of the same style share the same prefix, which
 * is what the style-code selector filters on.
 */
function extractStyleCode(designNumber?: string): string {
  if (!designNumber) return '';
  const firstSegment = designNumber.split('-')[0]?.trim();
  return firstSegment || '';
}

export default function WardrobePage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<WardrobeCategory | 'all'>('all');
  const [filterGender, setFilterGender] = useState<'all' | 'male' | 'female' | 'unisex'>('all');
  const [filterStyleCode, setFilterStyleCode] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Detail panel
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesignNumber, setEditDesignNumber] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<WardrobeCategory>('shoes');
  const [editGender, setEditGender] = useState<WardrobeGender>('unisex');
  const [editOpenShoes, setEditOpenShoes] = useState<boolean>(false);
  const [editHasHeels, setEditHasHeels] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editFlatFrontFile, setEditFlatFrontFile] = useState<File | null>(null);
  const [editFlatFrontPreview, setEditFlatFrontPreview] = useState<string | null>(null);
  const [editFlatBackFile, setEditFlatBackFile] = useState<File | null>(null);
  const [editFlatBackPreview, setEditFlatBackPreview] = useState<string | null>(null);

  // Label-template selection (bottoms only). Empty string means "(none)" → backend deletes the field.
  const [editLeatherLabelId, setEditLeatherLabelId] = useState<string>('');
  const [editPocketLabelId, setEditPocketLabelId] = useState<string>('');
  const [labelAssets, setLabelAssets] = useState<LabelAsset[]>([]);

  // Add form state
  const [itemType, setItemType] = useState<'focus' | 'styling'>('focus');
  const [name, setName] = useState('');
  const [designNumberCreate, setDesignNumberCreate] = useState('');
  const [category, setCategory] = useState<WardrobeCategory>('top');
  const [genderCreate, setGenderCreate] = useState<WardrobeGender>('unisex');
  const [openShoesCreate, setOpenShoesCreate] = useState<boolean>(false);
  const [hasHeelsCreate, setHasHeelsCreate] = useState<boolean>(false);
  const [description, setDescription] = useState('');
  const [fitModelFiles, setFitModelFiles] = useState<Partial<Record<FitModelKey, File>>>({});
  const [fileFlatFront, setFileFlatFront] = useState<File | null>(null);
  const [fileFlatBack, setFileFlatBack] = useState<File | null>(null);
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
        setPreview(`Warning: Translation failed: ${data.error || 'unknown error'}`);
      }
    } catch (e) {
      setPreview(`Warning: Translation failed: ${String(e)}`);
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

  // Load label-asset library once on mount. Used by the bottom-item edit panel.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/label-assets')
      .then(r => r.json())
      .then(d => { if (!cancelled) setLabelAssets(d.items || []); })
      .catch(() => { /* non-fatal — dropdowns just stay empty */ });
    return () => { cancelled = true; };
  }, []);

  // Reset style-code filter whenever category changes — style codes are
  // category-scoped (bottoms have their own codes, tops have theirs).
  useEffect(() => { setFilterStyleCode('all'); }, [filterCategory]);

  // Client-side gender filter
  const itemsAfterGender = filterGender === 'all'
    ? items
    : items.filter(i => (i.gender || 'unisex') === filterGender || (i.gender || 'unisex') === 'unisex');

  // Unique style codes available in the current category + gender slice.
  // Sorted for stable dropdown ordering. Items without a designNumber are
  // skipped — they show up as "all" only.
  const availableStyleCodes = Array.from(
    new Set(
      itemsAfterGender
        .map(i => extractStyleCode(i.designNumber))
        .filter(Boolean)
    )
  ).sort();

  // Apply style-code filter
  const filteredItems = filterStyleCode === 'all'
    ? itemsAfterGender
    : itemsAfterGender.filter(i => extractStyleCode(i.designNumber) === filterStyleCode);

  // Count how many fit model images an item has
  function countFitImages(item: WardrobeItem): number {
    if (item.fitModels) {
      return Object.values(item.fitModels).filter(Boolean).length;
    }
    return item.fitModelUrls?.length || 0;
  }

  // Open detail panel
  function openItem(item: WardrobeItem) {
    setSelectedItem(item);
    setEditName(item.name);
    setEditDesignNumber(item.designNumber || '');
    setEditDescription(item.description);
    setEditCategory(item.category as WardrobeCategory);
    setEditGender(item.gender || 'unisex');
    setEditOpenShoes(item.openShoes || false);
    setEditHasHeels((item as any).hasHeels || false);
    setEditFlatFrontFile(null);
    setEditFlatFrontPreview(null);
    setEditFlatBackFile(null);
    setEditFlatBackPreview(null);
    setEditLeatherLabelId(item.leatherLabelTemplateId || '');
    setEditPocketLabelId(item.pocketLabelTemplateId || '');
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
      let flatFrontBase64: string | undefined;
      let flatBackBase64: string | undefined;
      if (editFlatFrontFile) flatFrontBase64 = await fileToBase64(editFlatFrontFile);
      if (editFlatBackFile) flatBackBase64 = await fileToBase64(editFlatBackFile);

      const patchBody: Record<string, any> = {
        name: editName, designNumber: editDesignNumber, description: editDescription, category: editCategory,
        gender: editGender, openShoes: editOpenShoes, hasHeels: editHasHeels,
      };
      if (flatFrontBase64) patchBody.flatFrontBase64 = flatFrontBase64;
      if (flatBackBase64) patchBody.flatBackBase64 = flatBackBase64;
      // Label-template selection — only relevant for bottoms. Empty string → backend deletes the field.
      if (editCategory === 'bottom') {
        patchBody.leatherLabelTemplateId = editLeatherLabelId;
        patchBody.pocketLabelTemplateId = editPocketLabelId;
      }

      const res = await fetch(`/api/wardrobe/${selectedItem.wardrobeId || selectedItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = {
          ...selectedItem, name: editName, designNumber: editDesignNumber, description: editDescription, category: editCategory,
          gender: editGender, openShoes: editOpenShoes, hasHeels: editHasHeels,
          ...(data.flatFrontUrl ? { flatFrontUrl: data.flatFrontUrl } : {}),
          ...(data.flatBackUrl ? { flatBackUrl: data.flatBackUrl } : {}),
          ...(editCategory === 'bottom' ? {
            leatherLabelTemplateId: editLeatherLabelId || undefined,
            pocketLabelTemplateId: editPocketLabelId || undefined,
            // Recompute badge optimistically — server logic considers leather only OR
            // a three-tier labelStyles config. We only know leather state here, so this
            // may underestimate (won't flip a three-tier-only item from amber to green
            // until next list refresh — minor).
            labelReady: !!editLeatherLabelId || selectedItem.labelReady,
          } : {}),
        } as any;
        setSelectedItem(updated);
        setItems(prev => prev.map(i => (i.id === selectedItem.id ? updated : i)));
        if (editFlatFrontFile) { setEditFlatFrontFile(null); setEditFlatFrontPreview(null); }
        if (editFlatBackFile) { setEditFlatBackFile(null); setEditFlatBackPreview(null); }
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
    const filledSlots = Object.values(fitModelFiles).filter(Boolean).length;
    const isFocusItem = itemType === 'focus';
    if (!name || !description) return;
    if (isFocusItem && filledSlots === 0) return;
    if (!isFocusItem && !fileFlatFront) return;
    setUploading(true);
    try {
      // Convert fit model files to base64 keyed by slot name
      const fitModelBase64: Record<string, string> = {};
      for (const [key, file] of Object.entries(fitModelFiles)) {
        if (file) fitModelBase64[key] = await fileToBase64(file);
      }

      let flatFrontBase64: string | undefined;
      let flatBackBase64: string | undefined;
      if (fileFlatFront) flatFrontBase64 = await fileToBase64(fileFlatFront);
      if (fileFlatBack) flatBackBase64 = await fileToBase64(fileFlatBack);

      const res = await fetch('/api/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, designNumber: designNumberCreate, category, description,
          fitModelBase64: Object.values(fitModelBase64), // Array for backward compat with API
          fitModelSlots: fitModelBase64, // Keyed by slot name for v2
          flatFrontBase64, flatBackBase64,
          gender: genderCreate,
          openShoes: openShoesCreate,
          hasHeels: hasHeelsCreate,
        }),
      });
      if (res.ok) {
        setName(''); setDesignNumberCreate(''); setDescription(''); setFitModelFiles({}); setFileFlatFront(null); setFileFlatBack(null); setShowForm(false);
        setGenderCreate('unisex'); setItemType('focus');
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

  // Get fit model images for the selected item (supports both v1 and v2)
  function getFitModelImages(item: WardrobeItem): { key: string; label: string; url: string }[] {
    if (item.fitModels) {
      return FIT_MODEL_SLOTS
        .filter(slot => item.fitModels?.[slot.key])
        .map(slot => ({ key: slot.key, label: slot.label, url: item.fitModels![slot.key]! }));
    }
    // Legacy v1: flat array
    return (item.fitModelUrls || []).map((url, i) => ({ key: `legacy-${i}`, label: `Photo ${i + 1}`, url }));
  }

  return (
    <Shell user={user ? { email: user.email, name: user.name || '', role: user.role || 'creator' } : undefined}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Wardrobe</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Stock items with 6 labeled fit model angles for AI generation.
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
          {/* Item type toggle */}
          <div>
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Item Type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setItemType('focus'); setFitModelFiles({}); }}
                className={`px-4 py-2 text-sm border transition-colors ${itemType === 'focus' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'}`}>
                Focus Item
              </button>
              <button type="button" onClick={() => { setItemType('styling'); setFitModelFiles({}); }}
                className={`px-4 py-2 text-sm border transition-colors ${itemType === 'styling' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'}`}>
                Styling Item
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              {itemType === 'focus'
                ? 'Focus items need 6 fit model angles + flat images for AI generation.'
                : 'Styling items only need flat front & back images. Used as outfit context, not as the main garment.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Name</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g., CONTOR 3D EXTREME LOOSE WMN"
                className="w-full border border-neutral-300 px-3 py-2 text-sm" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Design Number</label>
              <input
                type="text" value={designNumberCreate} onChange={(e) => setDesignNumberCreate(e.target.value)}
                placeholder="e.g., D27690-D315-001"
                className="w-full border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Category</label>
              <div className="flex gap-2">
                {CATEGORIES.map(c => (
                  <button key={c.value} type="button" onClick={() => setCategory(c.value)}
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
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">Description (for AI prompt) — <span className="text-red-500">English only</span></label>
              {description.trim() && !translatedCreate && (
                <button type="button" onClick={() => translateText(description, setTranslatingCreate, setTranslatedCreate)}
                  disabled={translatingCreate} className="text-xs text-neutral-500 hover:text-neutral-900 underline disabled:opacity-40">
                  {translatingCreate ? 'Translating...' : 'Translate to English'}
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

          {/* Shoe-specific toggles */}
          {category === 'shoes' && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Open shoes:</span>
                <button type="button" onClick={() => setOpenShoesCreate(!openShoesCreate)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${openShoesCreate ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                  {openShoesCreate ? 'Open heel' : 'Closed'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Heels:</span>
                <button type="button" onClick={() => setHasHeelsCreate(!hasHeelsCreate)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${hasHeelsCreate ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                  {hasHeelsCreate ? 'Heels' : 'Flat'}
                </button>
              </div>
            </div>
          )}

          {/* 6 Labeled Fit Model Angle Slots — only for focus items */}
          {itemType === 'focus' && (<div>
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
              Fit Model Photos — 6 Labeled Angles
            </label>
            <p className="text-xs text-neutral-400 mb-3">
              Upload photos of the garment on a fit model from each camera angle. Front row and back row of 3 positions each.
            </p>

            {/* Visual guide diagram */}
            <div className="bg-neutral-50 border border-neutral-200 p-4 mb-4">
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">Camera positions (top-down view)</p>
              <div className="flex justify-center gap-8">
                <div className="text-center">
                  <p className="text-[10px] text-neutral-400 mb-1">FRONT ROW</p>
                  <div className="flex gap-3">
                    <div className="text-center">
                      <div className="w-8 h-8 border border-neutral-300 rounded-full flex items-center justify-center text-[9px] text-neutral-500">45°L</div>
                      <p className="text-[9px] text-neutral-400 mt-0.5">Left</p>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-neutral-900 rounded-full flex items-center justify-center text-[9px] font-bold">F</div>
                      <p className="text-[9px] text-neutral-600 mt-0.5 font-medium">Front</p>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 border border-neutral-300 rounded-full flex items-center justify-center text-[9px] text-neutral-500">45°R</div>
                      <p className="text-[9px] text-neutral-400 mt-0.5">Right</p>
                    </div>
                  </div>
                </div>
                <div className="w-px bg-neutral-200" />
                <div className="text-center">
                  <p className="text-[10px] text-neutral-400 mb-1">BACK ROW</p>
                  <div className="flex gap-3">
                    <div className="text-center">
                      <div className="w-8 h-8 border border-neutral-300 rounded-full flex items-center justify-center text-[9px] text-neutral-500">45°L</div>
                      <p className="text-[9px] text-neutral-400 mt-0.5">Left</p>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-neutral-900 rounded-full flex items-center justify-center text-[9px] font-bold">B</div>
                      <p className="text-[9px] text-neutral-600 mt-0.5 font-medium">Back</p>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 border border-neutral-300 rounded-full flex items-center justify-center text-[9px] text-neutral-500">45°R</div>
                      <p className="text-[9px] text-neutral-400 mt-0.5">Right</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload slots — 2 rows of 3 */}
            <div className="space-y-3">
              {(['front', 'back'] as const).map(row => (
                <div key={row}>
                  <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">{row === 'front' ? 'Front angles' : 'Back angles'}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {FIT_MODEL_SLOTS.filter(s => s.row === row).map(slot => {
                      const file = fitModelFiles[slot.key];
                      return (
                        <div key={slot.key} className="relative">
                          <label className="block cursor-pointer">
                            <div className={`aspect-[3/4] border-2 border-dashed flex flex-col items-center justify-center transition-colors ${
                              file ? 'border-green-500 bg-green-50' : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400'
                            }`}>
                              {file ? (
                                <img src={URL.createObjectURL(file)} alt={slot.label} className="w-full h-full object-cover" />
                              ) : (
                                <>
                                  <svg className="w-5 h-5 text-neutral-300 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span className="text-[10px] text-neutral-400">{slot.label}</span>
                                </>
                              )}
                            </div>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setFitModelFiles(prev => ({ ...prev, [slot.key]: f }));
                              e.target.value = '';
                            }} />
                          </label>
                          {file && (
                            <button type="button"
                              onClick={() => setFitModelFiles(prev => { const n = { ...prev }; delete n[slot.key]; return n; })}
                              className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white text-[10px] flex items-center justify-center hover:bg-red-700">
                              x
                            </button>
                          )}
                          <p className="text-[10px] text-neutral-500 mt-1 text-center">{slot.label}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-neutral-400 mt-2">
              {Object.values(fitModelFiles).filter(Boolean).length}/6 angles uploaded
            </p>
          </div>)}

          {/* Flat images */}
          <div>
            {itemType === 'styling' && (
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                Flat Product Images {itemType === 'styling' && <span className="text-red-500 normal-case">*required</span>}
              </label>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">
                  Flat Front {itemType === 'styling' && <span className="text-red-500">*</span>}
                </label>
                {fileFlatFront && (
                  <div className="mb-2 relative inline-block">
                    <img src={URL.createObjectURL(fileFlatFront)} alt="Flat front preview" className="h-32 w-32 object-contain border border-neutral-200 bg-white" />
                    <button type="button" onClick={() => setFileFlatFront(null)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white text-[10px] flex items-center justify-center hover:bg-red-700">x</button>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => setFileFlatFront(e.target.files?.[0] || null)} className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Flat Back</label>
                {fileFlatBack && (
                  <div className="mb-2 relative inline-block">
                    <img src={URL.createObjectURL(fileFlatBack)} alt="Flat back preview" className="h-32 w-32 object-contain border border-neutral-200 bg-white" />
                    <button type="button" onClick={() => setFileFlatBack(null)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white text-[10px] flex items-center justify-center hover:bg-red-700">x</button>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => setFileFlatBack(e.target.files?.[0] || null)} className="w-full text-sm" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={uploading || !name || !description || (itemType === 'focus' ? Object.values(fitModelFiles).filter(Boolean).length === 0 : !fileFlatFront)}
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
        {/* Style-code filter — only shown once a specific category is picked. */}
        {filterCategory !== 'all' && availableStyleCodes.length > 0 && (
          <>
            <div className="w-px h-6 bg-neutral-300" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Style</span>
              <select
                value={filterStyleCode}
                onChange={(e) => setFilterStyleCode(e.target.value)}
                className="px-3 py-1.5 text-sm border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 focus:outline-none focus:border-neutral-900"
              >
                <option value="all">All styles ({availableStyleCodes.length})</option>
                {availableStyleCodes.map(code => (
                  <option key={code} value={code}>{styleCodeLabel(code, itemsAfterGender)}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Items grid */}
      {loading ? (
        <p className="text-sm text-neutral-400">Loading wardrobe...</p>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <p className="text-lg mb-2">No items yet</p>
          <p className="text-sm">Add stock items with labeled fit model angles for AI-generated product shots.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredItems.map(item => (
            <div key={item.id} onClick={() => openItem(item)}
              className="bg-white border border-neutral-200 overflow-hidden group cursor-pointer hover:border-neutral-400 hover:shadow-sm transition-all">
              <div className="aspect-square bg-neutral-100 relative">
                {item.thumbnailUrl ? (
                  // object-contain (not object-cover) so the full garment fits in
                  // the tile — the fit-model angle photos are 3:4 portrait, so
                  // a square crop with object-cover hid the waistband and ankle
                  // (style/cut became unreadable per Bruno 2026-05-07). Letter-
                  // boxing on the sides is fine; bg-neutral-100 keeps it clean.
                  <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">No image</div>
                )}
                {filterCategory === 'all' && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-neutral-900 text-white text-xs uppercase">
                    {item.category}
                  </span>
                )}
                {countFitImages(item) > 1 && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 text-white text-xs">
                    {countFitImages(item)} angles
                  </span>
                )}
                {/* Label-readiness badge — only on bottoms. Green = warp tool
                    will work (templateId set OR three-tier config exists);
                    amber = needs setup before warp. */}
                {item.category === 'bottom' && item.labelReady !== undefined && (
                  <span
                    className={
                      item.labelReady
                        ? 'absolute bottom-2 left-2 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-medium uppercase tracking-wide'
                        : 'absolute bottom-2 left-2 px-2 py-0.5 bg-amber-500 text-white text-[10px] font-medium uppercase tracking-wide'
                    }
                    title={
                      item.labelReady
                        ? 'Leather label is mapped — warp tool will work for this garment'
                        : 'Leather label NOT mapped — open this garment and run label-setup before generating'
                    }
                  >
                    {item.labelReady ? 'Label ✓' : 'Label needed'}
                  </span>
                )}
              </div>
              <div className="p-3">
                {/* Two-line identity: design number on top, design name on second
                    line. Replaces the old "designNumber + truncated description"
                    treatment per Bruno 2026-05-07 — name beats description for
                    quick scanning. */}
                {(() => {
                  const d = parseGarmentDisplay(item);
                  return (
                    <>
                      <h3 className="text-sm font-medium text-neutral-900 truncate">{d.designNumber || '—'}</h3>
                      <p className="text-xs text-neutral-700 mt-0.5 truncate">{d.designName}</p>
                    </>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel (slide-in from right) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closePanel} />

          <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 flex-shrink-0">
              <span className="px-2 py-0.5 bg-neutral-900 text-white text-xs uppercase">{selectedItem.category}</span>
              <button onClick={closePanel} className="text-neutral-400 hover:text-neutral-900 text-xl leading-none">x</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Fit model images — labeled grid */}
              <div>
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                  Fit Model Angles ({countFitImages(selectedItem)}/6)
                </p>
                {(() => {
                  const images = getFitModelImages(selectedItem);
                  if (images.length === 0) return <p className="text-xs text-neutral-400 italic">No fit model photos uploaded yet.</p>;
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      {images.map(img => (
                        <div key={img.key} className="relative group">
                          <div className="aspect-[3/4] bg-neutral-100 overflow-hidden cursor-pointer hover:ring-2 hover:ring-neutral-500 transition-all">
                            <img src={img.url} alt={img.label} onClick={() => setLightboxUrl(img.url)}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-1 text-center">{img.label}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

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
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Design Number</label>
                  <input
                    type="text" value={editDesignNumber} onChange={(e) => setEditDesignNumber(e.target.value)}
                    placeholder="e.g., D27690-D315-001"
                    className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
                  />
                  {/* Leather label setup link — only for bottoms with a parseable design number */}
                  {editCategory === 'bottom' && /^[^_\s-]+-[^_\s-]+-/.test(editDesignNumber.trim()) && selectedItem?.id && (
                    <a
                      href={`/wardrobe/${selectedItem.id}/label-setup`}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-300 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white transition-colors"
                    >
                      Configure leather label →
                    </a>
                  )}
                  {/* Angle setup — available for any item with fit model photos, v1 or v2 */}
                  {selectedItem?.id && (
                    <a
                      href={`/wardrobe/${selectedItem.id}/angle-setup`}
                      className="mt-2 ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-300 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white transition-colors"
                    >
                      Configure fit angles →
                    </a>
                  )}
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
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Gender:</span>
                    {GENDER_OPTIONS.map(g => (
                      <button key={g.value} type="button" onClick={() => setEditGender(g.value)}
                        className={`px-2.5 py-1 text-xs border transition-colors ${editGender === g.value ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                  {editCategory === 'shoes' && (<>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-neutral-500">Open shoes:</span>
                      <button type="button" onClick={() => setEditOpenShoes(!editOpenShoes)}
                        className={`px-2.5 py-1 text-xs border transition-colors ${editOpenShoes ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                        {editOpenShoes ? 'Open heel' : 'Closed shoe'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-neutral-500">Heels:</span>
                      <button type="button" onClick={() => setEditHasHeels(!editHasHeels)}
                        className={`px-2.5 py-1 text-xs border transition-colors ${editHasHeels ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'}`}>
                        {editHasHeels ? 'Heels' : 'Flat shoe'}
                      </button>
                    </div>
                  </>)}
                </div>

                {/* Labels — bottoms only. Pulls from labelAssets library. */}
                {editCategory === 'bottom' && (
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">Labels</label>
                      <a href="/labels" className="text-xs text-neutral-500 hover:text-neutral-900 underline">Manage library →</a>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] text-neutral-500 mb-1">Leather (waistband)</p>
                        <select
                          value={editLeatherLabelId}
                          onChange={(e) => setEditLeatherLabelId(e.target.value)}
                          className="w-full border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-900"
                        >
                          <option value="">(none)</option>
                          {labelAssets.filter(a => a.type === 'leather').map(a => (
                            <option key={a.id} value={a.id}>{a.displayName}</option>
                          ))}
                        </select>
                        {editLeatherLabelId && (() => {
                          const asset = labelAssets.find(a => a.id === editLeatherLabelId);
                          return asset ? (
                            <div className="mt-2 border border-neutral-200 p-1 inline-block bg-[linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3),linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
                              <img src={asset.imageUrl} alt={asset.displayName} className="h-16 w-auto" />
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <div>
                        <p className="text-[11px] text-neutral-500 mb-1">Pocket (back patch)</p>
                        <select
                          value={editPocketLabelId}
                          onChange={(e) => setEditPocketLabelId(e.target.value)}
                          className="w-full border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-900"
                        >
                          <option value="">(none)</option>
                          {labelAssets.filter(a => a.type === 'pocket').map(a => (
                            <option key={a.id} value={a.id}>{a.displayName}</option>
                          ))}
                        </select>
                        {editPocketLabelId && (() => {
                          const asset = labelAssets.find(a => a.id === editPocketLabelId);
                          return asset ? (
                            <div className="mt-2 border border-neutral-200 p-1 inline-block bg-[linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3),linear-gradient(45deg,#f3f3f3_25%,transparent_25%,transparent_75%,#f3f3f3_75%,#f3f3f3)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
                              <img src={asset.imageUrl} alt={asset.displayName} className="h-16 w-auto" />
                            </div>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">Description (used in AI prompt) — <span className="text-red-500">English only</span></label>
                    {editDescription.trim() && !translatedEdit && (
                      <button type="button" onClick={() => translateText(editDescription, setTranslatingEdit, setTranslatedEdit)}
                        disabled={translatingEdit} className="text-xs text-neutral-500 hover:text-neutral-900 underline disabled:opacity-40">
                        {translatingEdit ? 'Translating...' : 'Translate to English'}
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

                {/* Flat images */}
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                    Flat Images <span className="text-neutral-400 normal-case">(product-on-white — front &amp; back)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-neutral-500 mb-1">Front</p>
                      {(selectedItem?.flatFrontUrl || editFlatFrontPreview) && (
                        <div className="mb-2 relative inline-block">
                          <img src={editFlatFrontPreview || selectedItem?.flatFrontUrl} alt="Flat front"
                            className="h-24 w-24 object-contain border border-neutral-200 bg-white cursor-pointer"
                            onClick={() => setLightboxUrl(editFlatFrontPreview || selectedItem?.flatFrontUrl || null)} />
                          {editFlatFrontPreview && <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] px-1 rounded">NEW</span>}
                        </div>
                      )}
                      <label className="cursor-pointer px-3 py-1.5 text-xs border border-neutral-300 hover:border-neutral-500 transition-colors bg-white text-neutral-600">
                        {selectedItem?.flatFrontUrl ? 'Replace' : 'Upload front'}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0]; if (f) { setEditFlatFrontFile(f); setEditFlatFrontPreview(URL.createObjectURL(f)); } e.target.value = '';
                        }} />
                      </label>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500 mb-1">Back</p>
                      {(selectedItem?.flatBackUrl || editFlatBackPreview) && (
                        <div className="mb-2 relative inline-block">
                          <img src={editFlatBackPreview || selectedItem?.flatBackUrl} alt="Flat back"
                            className="h-24 w-24 object-contain border border-neutral-200 bg-white cursor-pointer"
                            onClick={() => setLightboxUrl(editFlatBackPreview || selectedItem?.flatBackUrl || null)} />
                          {editFlatBackPreview && <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] px-1 rounded">NEW</span>}
                        </div>
                      )}
                      <label className="cursor-pointer px-3 py-1.5 text-xs border border-neutral-300 hover:border-neutral-500 transition-colors bg-white text-neutral-600">
                        {selectedItem?.flatBackUrl ? 'Replace' : 'Upload back'}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0]; if (f) { setEditFlatBackFile(f); setEditFlatBackPreview(URL.createObjectURL(f)); } e.target.value = '';
                        }} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200 flex-shrink-0 bg-white">
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

              <button onClick={saveEdit} disabled={saving}
                className="px-6 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40 transition-colors">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl hover:text-neutral-300" onClick={() => setLightboxUrl(null)}>x</button>
          <img src={lightboxUrl} alt="Full view"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Shell>
  );
}
