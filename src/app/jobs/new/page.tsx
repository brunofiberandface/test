'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';
import { CATEGORY_FIELDS, type GarmentCategory, type WardrobeCategory } from '@/types';

// ── Stable model card image — memoized so selection toggles don't re-render the <img> ──
const ModelCardImage = memo(function ModelCardImage({ src, modelId }: { src: string; modelId: string }) {
  return (
    <img
      src={src}
      alt={modelId}
      className="w-full h-full object-cover"
      style={{ objectPosition: 'top center', transform: 'scale(1.8)', transformOrigin: 'top center' }}
      loading="eager"
      decoding="sync"
    />
  );
});

const CATEGORIES: { value: GarmentCategory; label: string }[] = [
  { value: 'pants', label: 'Pants / Jeans' },
  { value: 'jackets', label: 'Jackets' },
  { value: 'tops', label: 'Tops' },
  { value: 'knitwear', label: 'Knitwear' },
  { value: 'dresses', label: 'Dresses / Skirts' },
  { value: 'accessories', label: 'Accessories' },
];

interface DbModel {
  id: string;
  modelId: string;
  name: string;
  gender: 'male' | 'female';
  cardImageUrl: string;
  description: string;
  active: boolean;
}

function NewJobContent() {
  const { data: session } = useSession();
  const user = session?.user ? {
    email: session.user.email || '',
    name: session.user.name || '',
    role: 'admin' as const,
  } : { email: '', name: '', role: 'admin' as const };
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedModelId = searchParams.get('modelId');

  const [step, setStep] = useState(1);
  const [jobName, setJobName] = useState('');
  const [designNumber, setDesignNumber] = useState('');
  const [category, setCategory] = useState<GarmentCategory>('pants');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Translation state
  const [translating, setTranslating] = useState(false);
  const [translatedPreview, setTranslatedPreview] = useState('');

  const handleTranslate = async () => {
    if (!description.trim()) return;
    setTranslating(true);
    setTranslatedPreview('');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description }),
      });
      const data = await res.json();
      if (data.translated) {
        setTranslatedPreview(data.translated);
      } else {
        setTranslatedPreview(`⚠ Translation failed: ${data.error || 'unknown error'}`);
      }
    } catch (e) {
      setTranslatedPreview(`⚠ Translation failed: ${String(e)}`);
    } finally {
      setTranslating(false);
    }
  };

  // Wardrobe source picker (step 1 — select existing item instead of uploading)
  const [wardrobeSourceItem, setWardrobeSourceItem] = useState<any | null>(null);
  const [allWardrobeItems, setAllWardrobeItems] = useState<any[]>([]); // primary items only — for step 1 picker
  const [allWardrobeItemsRaw, setAllWardrobeItemsRaw] = useState<any[]>([]); // all items — for outfit generation picker
  const [wardrobeSourceLoading, setWardrobeSourceLoading] = useState(true);

  // Models loaded from DB
  const [dbModels, setDbModels] = useState<DbModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Wardrobe state — selectedWardrobe is populated from dressed base selection
  const [selectedWardrobe, setSelectedWardrobe] = useState<Record<WardrobeCategory, string | null>>({
    shoes: null, shirt: null, jacket: null, pants: null,
  });

  // Dressed bases per model — { modelId: DressedBase[] }
  const [dressedBasesMap, setDressedBasesMap] = useState<Record<string, any[]>>({});
  // Selected dressed base per model — { modelId: base | null }
  const [selectedDressedBase, setSelectedDressedBase] = useState<Record<string, any | null>>({});

  // Step 4 — outfit generation per model
  const [outfitPickerModel, setOutfitPickerModel] = useState<string | null>(null);
  const [perModelWardrobeSelection, setPerModelWardrobeSelection] = useState<Record<string, Record<string, string>>>({});
  const [dressedGeneratingModel, setDressedGeneratingModel] = useState<string | null>(null);
  const [dressedGenerateStatus, setDressedGenerateStatus] = useState<Record<string, string>>({});

  // ── Persist wizard state to sessionStorage so browser Back doesn't lose data ──
  const SESSION_KEY = 'gstar_job_wizard';

  // Restore on mount (text-only fields — files can't be serialized)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const s = JSON.parse(saved);
      // Always start at step 1 — restore other fields but not step position
      if (s.jobName) setJobName(s.jobName);
      if (s.designNumber) setDesignNumber(s.designNumber);
      if (s.category) setCategory(s.category);
      if (s.description) setDescription(s.description);
      if (s.metadata) setMetadata(s.metadata);
      if (s.selectedModels) setSelectedModels(s.selectedModels);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every relevant state change
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        step,
        jobName,
        designNumber,
        category,
        description,
        metadata,
        selectedModels,
        wardrobeSourceItemId: wardrobeSourceItem?.id || null,
      }));
    } catch { /* ignore */ }
  }, [step, jobName, designNumber, category, description, metadata, selectedModels, wardrobeSourceItem]);

  // Fetch models from DB on mount
  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          const models: DbModel[] = data.models || [];
          setDbModels(models);
          // Pre-select model from ?modelId= query param
          if (preselectedModelId) {
            const match = models.find(m => m.modelId === preselectedModelId);
            if (match) setSelectedModels([preselectedModelId]);
          }
        }
      } catch (e) {
        console.error('Failed to fetch models:', e);
      } finally {
        setModelsLoading(false);
      }
    }
    fetchModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch dressed bases for all models (once models are loaded)
  useEffect(() => {
    if (dbModels.length === 0) return;
    async function fetchDressedBases() {
      const map: Record<string, any[]> = {};
      await Promise.all(dbModels.map(async (model) => {
        try {
          const res = await fetch(`/api/models/generate-dressed?modelId=${model.modelId}`);
          if (res.ok) {
            const data = await res.json();
            map[model.modelId] = data.bases || [];
          }
        } catch { /* non-blocking */ }
      }));
      setDressedBasesMap(map);
    }
    fetchDressedBases();
  }, [dbModels]);

  // Fetch all wardrobe items on mount
  useEffect(() => {
    async function fetchAllWardrobe() {
      try {
        const res = await fetch('/api/wardrobe');
        if (res.ok) {
          const data = await res.json();
          const allItems: any[] = data.items || [];
          setAllWardrobeItemsRaw(allItems); // all items — for outfit generation
          // Filter to focus garments only for step 1 picker
          const primaryItems = allItems.filter((item: any) => {
            if (item.isPrimary !== undefined) return item.isPrimary === true;
            return item.category !== 'shoes'; // legacy: shoes are always styling
          });
          setAllWardrobeItems(primaryItems);
          // Restore wardrobeSourceItem from sessionStorage if we have the ID
          try {
            const saved = sessionStorage.getItem(SESSION_KEY);
            if (saved) {
              const s = JSON.parse(saved);
              if (s.wardrobeSourceItemId) {
                const match = primaryItems.find((i: any) => i.id === s.wardrobeSourceItemId);
                if (match) setWardrobeSourceItem(match);
              }
            }
          } catch { /* ignore */ }
        }
      } catch { /* non-blocking */ }
      finally { setWardrobeSourceLoading(false); }
    }
    fetchAllWardrobe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleModel = (id: string) => {
    setSelectedModels(prev =>
      prev.includes(id) ? [] : [id]
    );
  };

  // Generate a dressed base inline from the wizard (Step 4)
  const handleGenerateDressedFromWizard = useCallback(async (modelId: string) => {
    const selections = perModelWardrobeSelection[modelId] || {};
    const activeItems = Object.fromEntries(Object.entries(selections).filter(([, v]) => v));
    if (Object.keys(activeItems).length === 0) return;

    setDressedGeneratingModel(modelId);
    const startedAt = Date.now();

    const tick = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setDressedGenerateStatus(prev => ({ ...prev, [modelId]: prev[modelId]?.replace(/\d+s$/, `${elapsed}s`) || '' }));
    }, 1000);

    try {
      setDressedGenerateStatus(prev => ({ ...prev, [modelId]: 'Generating front base… 0s' }));
      await fetch('/api/models/generate-dressed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, wardrobeItemIds: activeItems, view: 'front' }),
      });

      setDressedGenerateStatus(prev => ({ ...prev, [modelId]: 'Generating back base… 0s' }));
      await fetch('/api/models/generate-dressed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, wardrobeItemIds: activeItems, view: 'back' }),
      });

      // Refresh dressed bases for this model
      const r = await fetch(`/api/models/generate-dressed?modelId=${modelId}`);
      const d = await r.json();
      setDressedBasesMap(prev => ({ ...prev, [modelId]: d.bases || [] }));
      setOutfitPickerModel(null);
      setPerModelWardrobeSelection(prev => ({ ...prev, [modelId]: {} }));
      setDressedGenerateStatus(prev => ({ ...prev, [modelId]: '' }));
    } catch (e) {
      setDressedGenerateStatus(prev => ({ ...prev, [modelId]: `Error: ${String(e)}` }));
    } finally {
      clearInterval(tick);
      setDressedGeneratingModel(null);
    }
  }, [perModelWardrobeSelection]);

  const fields = CATEGORY_FIELDS[category] || [];

  // ── Progress indicator ──────────────────────────────────────────────────────
  const STEPS = [
    { n: 1, label: 'Garment' },
    { n: 2, label: 'Details' },
    { n: 3, label: 'Model' },
    { n: 4, label: 'Outfit' },
    { n: 5, label: 'Review' },
  ];

  return (
    <Shell user={user}>
      <div className="max-w-3xl">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map(s => (
            <div key={s.n} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { if (s.n <= step) setStep(s.n); }}
                className={`w-7 h-7 flex items-center justify-center text-xs font-medium transition-colors ${
                  step >= s.n ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'
                } ${s.n <= step ? 'cursor-pointer hover:bg-neutral-700' : ''}`}
              >
                {s.n}
              </button>
              <span
                onClick={() => { if (s.n <= step) setStep(s.n); }}
                className={`text-sm ${step >= s.n ? 'text-neutral-900' : 'text-neutral-400'} ${s.n <= step ? 'cursor-pointer hover:underline' : ''}`}
              >
                {s.label}
              </span>
              {s.n < 5 && <div className="w-8 h-px bg-neutral-200 mx-1" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Select Focus Garment ──────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Focus Garment</h2>
              <p className="text-sm text-neutral-500 mt-1">Pick the product to shoot from your wardrobe.</p>
            </div>

            {/* Job Name */}
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Job Name <span className="text-neutral-400 normal-case font-normal">(your reference)</span>
              </label>
              <input
                type="text"
                value={jobName}
                onChange={e => setJobName(e.target.value)}
                placeholder="e.g., Spring 2026 wide leg test"
                className="w-full border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>

            {/* Wardrobe Picker */}
            <div>
              {wardrobeSourceLoading ? (
                <p className="text-sm text-neutral-400">Loading wardrobe...</p>
              ) : allWardrobeItems.length === 0 ? (
                <div className="border-2 border-dashed border-neutral-300 p-8 text-center">
                  <p className="text-sm text-neutral-500">No focus garments in wardrobe yet.</p>
                  <a href="/wardrobe" className="inline-block mt-3 px-4 py-2 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors">
                    Go to Wardrobe
                  </a>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Group by gender, then by category */}
                  {(['female', 'male', 'unisex'] as const).map(gender => {
                    const genderItems = allWardrobeItems.filter((i: any) => (i.gender || 'unisex') === gender);
                    if (genderItems.length === 0) return null;

                    // Group by category within gender
                    const categories = [...new Set(genderItems.map((i: any) => i.category as string))];

                    return (
                      <div key={gender}>
                        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                          {gender === 'female' ? 'Women' : gender === 'male' ? 'Men' : 'Unisex'}
                        </p>
                        {categories.map(cat => {
                          const catItems = genderItems.filter((i: any) => i.category === cat);
                          return (
                            <div key={`${gender}-${cat}`} className="mb-3">
                              <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5 ml-0.5">{cat}</p>
                              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                                {catItems.map((item: any) => {
                                  const isSelected = wardrobeSourceItem?.id === item.id;
                                  const totalPhotos = (item.imageUrls?.length || 0) + ((item as any).fitModelUrls?.length || 0) + (item.flatImageUrl ? 1 : 0);
                                  return (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() => {
                                        if (isSelected) {
                                          setWardrobeSourceItem(null);
                                          setDesignNumber('');
                                        } else {
                                          setWardrobeSourceItem(item);
                                          setDesignNumber(item.name);
                                          if (item.category) setCategory(item.category);
                                          if (item.description) setDescription(item.description);
                                        }
                                      }}
                                      className={`border text-left transition-all ${isSelected ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}
                                    >
                                      <div className="aspect-square bg-neutral-100 relative overflow-hidden">
                                        {item.thumbnailUrl ? (
                                          <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">?</div>
                                        )}
                                        {isSelected && (
                                          <div className="absolute top-1 right-1 w-4 h-4 bg-neutral-900 flex items-center justify-center">
                                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                          </div>
                                        )}
                                      </div>
                                      <div className="p-1.5">
                                        <p className="text-xs font-medium text-neutral-900 truncate">{item.name}</p>
                                        <p className="text-[10px] text-neutral-400">{totalPhotos} photos</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
              {wardrobeSourceItem && (
                <div className="mt-3 p-3 bg-neutral-50 border border-neutral-200 flex items-center gap-3">
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-neutral-700">Using <strong>{wardrobeSourceItem.name}</strong> ({(wardrobeSourceItem.imageUrls?.length || 0) + ((wardrobeSourceItem as any).fitModelUrls?.length || 0) + (wardrobeSourceItem.flatImageUrl ? 1 : 0)} photos)</span>
                  <button type="button" onClick={() => { setWardrobeSourceItem(null); setDesignNumber(''); }} className="ml-auto text-xs text-neutral-400 hover:text-neutral-700">Clear</button>
                </div>
              )}
              {!wardrobeSourceItem && allWardrobeItems.length > 0 && (
                <p className="mt-3 text-xs text-neutral-400">
                  Need to add a new garment? <a href="/wardrobe" className="underline hover:text-neutral-700">Go to Wardrobe</a>
                </p>
              )}
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!wardrobeSourceItem}
              className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step 2: Description & Metadata ─────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-neutral-900">Product Details</h2>

            {/* ── Pre-filled from wardrobe ── */}
            <div className="border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">From wardrobe</p>
              <div className="flex items-start gap-3">
                <span className="px-2 py-1 bg-neutral-900 text-white text-xs font-medium flex-shrink-0 mt-0.5">
                  {CATEGORIES.find(c => c.value === category)?.label || category}
                </span>
                <p className="text-sm text-neutral-700 flex-1">{description || 'No description'}</p>
              </div>
            </div>

            {/* Category — only show full picker when NOT from wardrobe (legacy fallback) */}
            {!wardrobeSourceItem && (
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => { setCategory(cat.value); setMetadata({}); }}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        category === cat.value
                          ? 'bg-neutral-900 text-white'
                          : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Description — only show full editor when NOT from wardrobe */}
            {!wardrobeSourceItem && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Product Description <span className="text-red-400 normal-case font-normal">— English only</span>
                  </label>
                  {description.trim() && !translatedPreview && (
                    <button
                      type="button"
                      onClick={handleTranslate}
                      disabled={translating}
                      className="text-xs text-neutral-500 hover:text-neutral-900 underline disabled:opacity-40"
                    >
                      {translating ? 'Translating…' : 'Translate to English'}
                    </button>
                  )}
                </div>
                <textarea
                  value={description}
                  onChange={e => { setDescription(e.target.value); setTranslatedPreview(''); }}
                  rows={4}
                  placeholder="Describe the garment in detail: fit, color, construction, hero details, material..."
                  className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900 resize-none"
                />
                {translatedPreview && (
                  <div className="mt-2 border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">Translated — approve to use</p>
                    <p className="text-neutral-700 whitespace-pre-wrap">{translatedPreview}</p>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => { setDescription(translatedPreview); setTranslatedPreview(''); }}
                        className="px-3 py-1.5 bg-neutral-900 text-white text-xs hover:bg-neutral-700"
                      >
                        Use this
                      </button>
                      <button
                        type="button"
                        onClick={() => setTranslatedPreview('')}
                        className="px-3 py-1.5 border border-neutral-300 text-xs hover:border-neutral-900"
                      >
                        Keep original
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Category-specific fields */}
            {fields.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  {category} Details
                </p>
                {fields.map(field => (
                  <div key={field.key}>
                    <label className="block text-sm text-neutral-600 mb-1.5">{field.label}</label>
                    {field.type === 'select' ? (
                      <div className="flex flex-wrap gap-2">
                        {field.options?.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setMetadata(prev => ({ ...prev, [field.key]: opt }))}
                            className={`px-3 py-1.5 text-sm transition-colors ${
                              metadata[field.key] === opt
                                ? 'bg-neutral-900 text-white'
                                : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={metadata[field.key] || ''}
                        onChange={e => setMetadata(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-900"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!description}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Select Models ───────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Models</h2>
              <p className="text-sm text-neutral-500 mt-1">Select one model. Generates 7 shots.</p>
            </div>

            {modelsLoading ? (
              <div className="flex items-center gap-2 py-8">
                <div className="w-5 h-5 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                <span className="text-sm text-neutral-400">Loading models...</span>
              </div>
            ) : (
              ['female', 'male'].map(gender => {
                const genderModels = dbModels.filter(m => m.gender === gender);
                if (genderModels.length === 0) return null;
                return (
                  <div key={gender}>
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                      {gender === 'female' ? 'Women' : 'Men'}
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                      {genderModels.map(model => {
                        const selected = selectedModels.includes(model.modelId);
                        return (
                          <button
                            key={model.modelId}
                            onClick={() => toggleModel(model.modelId)}
                            className={`border text-left transition-all ${
                              selected
                                ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50'
                                : 'border-neutral-200 hover:border-neutral-400'
                            }`}
                          >
                            <div className="aspect-[3/4] bg-neutral-100 relative overflow-hidden">
                              {model.cardImageUrl ? (
                                <ModelCardImage src={model.cardImageUrl} modelId={model.modelId} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">
                                  {model.modelId}
                                </div>
                              )}
                              {selected && (
                                <div className="absolute top-1 right-1 w-5 h-5 bg-neutral-900 flex items-center justify-center">
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="p-1.5">
                              <p className="text-xs font-bold text-neutral-900">{model.modelId}</p>
                              <p className="text-[10px] text-neutral-400 truncate">{model.name}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {selectedModels.length > 0 && (
              <p className="text-sm text-neutral-600 font-medium">
                {selectedModels[0]} selected — 7 shots
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={selectedModels.length === 0}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Select Wardrobe per Model ──────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Outfits</h2>
              <p className="text-sm text-neutral-500 mt-1">Choose a pre-generated dressed base for each model — or generate a new one. Skip to use no outfit.</p>
            </div>

            {selectedModels.map(modelId => {
              const model = dbModels.find(m => m.modelId === modelId);
              if (!model) return null;
              const bases = dressedBasesMap[modelId] || [];
              const chosenBase = selectedDressedBase[modelId];
              const isPickerOpen = outfitPickerModel === modelId;
              const isGenerating = dressedGeneratingModel === modelId;
              const genStatus = dressedGenerateStatus[modelId] || '';
              const modelSelections = perModelWardrobeSelection[modelId] || {};

              return (
                <div key={modelId} className="border border-neutral-200 bg-white p-4 space-y-3">
                  <div className="flex gap-4">
                    {/* Model thumbnail */}
                    <div className="w-20 flex-shrink-0">
                      <div className="aspect-[3/4] bg-neutral-100 overflow-hidden relative">
                        {model.cardImageUrl ? (
                          <ModelCardImage src={model.cardImageUrl} modelId={model.modelId} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">{model.modelId}</div>
                        )}
                      </div>
                      <p className="text-xs font-bold text-neutral-900 mt-1">{model.modelId}</p>
                      <p className="text-[10px] text-neutral-400 truncate">{model.name}</p>
                    </div>

                    {/* Dressed bases */}
                    <div className="flex-1 min-w-0">
                      {bases.length === 0 ? (
                        <p className="text-xs text-neutral-400 py-2">
                          No dressed bases yet.{' '}
                          <button type="button" onClick={() => setOutfitPickerModel(isPickerOpen ? null : modelId)} className="underline text-neutral-600 hover:text-neutral-900">
                            Generate one
                          </button>
                        </p>
                      ) : (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {/* No outfit option */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDressedBase(prev => ({ ...prev, [modelId]: null }));
                              setSelectedWardrobe({ shoes: null, shirt: null, jacket: null, pants: null });
                            }}
                            className={`flex-shrink-0 w-16 border p-1 transition-all ${
                              selectedDressedBase.hasOwnProperty(modelId) && !chosenBase
                                ? 'border-neutral-900 ring-1 ring-neutral-900'
                                : 'border-dashed border-neutral-300 hover:border-neutral-400'
                            }`}
                          >
                            <div className="aspect-[9/16] bg-neutral-50 flex items-center justify-center">
                              <span className="text-[9px] text-neutral-400 text-center px-1 leading-tight">No outfit</span>
                            </div>
                          </button>

                          {/* Dressed base cards */}
                          {bases.map((base: any) => {
                            const isChosen = chosenBase?.wardrobeHash === base.wardrobeHash;
                            const itemNames = base.wardrobeItemNames || base.wardrobeItemIds || {};
                            const label = Object.values(itemNames).join(' + ');
                            return (
                              <button
                                key={base.wardrobeHash}
                                type="button"
                                onClick={() => {
                                  setSelectedDressedBase(prev => ({ ...prev, [modelId]: base }));
                                  if (base.wardrobeItemIds) {
                                    setSelectedWardrobe(prev => ({ ...prev, ...base.wardrobeItemIds }));
                                  }
                                }}
                                className={`flex-shrink-0 w-16 border p-1 transition-all ${
                                  isChosen
                                    ? 'border-neutral-900 ring-1 ring-neutral-900'
                                    : 'border-neutral-200 hover:border-neutral-400'
                                }`}
                              >
                                <div className="aspect-[9/16] bg-neutral-100 relative overflow-hidden">
                                  {base.imageUrl ? (
                                    <img src={base.imageUrl} alt="dressed" className="w-full h-full object-cover" loading="lazy" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">?</div>
                                  )}
                                  {(base as any).view === 'back' && (
                                    <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center py-0.5">back</span>
                                  )}
                                </div>
                                <p className="text-[9px] text-neutral-500 mt-0.5 truncate leading-tight" title={label}>
                                  {Object.entries(itemNames).map(([k]) => k).join(' + ')}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Generate new outfit trigger */}
                      {!isPickerOpen && !isGenerating && (
                        <button
                          type="button"
                          onClick={() => setOutfitPickerModel(modelId)}
                          className="mt-2 text-xs text-neutral-400 hover:text-neutral-900 underline transition-colors"
                        >
                          + Generate New Outfit
                        </button>
                      )}

                      {/* Inline outfit picker */}
                      {isPickerOpen && (
                        <div className="mt-3 border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                          <p className="text-xs font-medium text-neutral-600">Select wardrobe items for new outfit:</p>
                          {allWardrobeItemsRaw.length === 0 ? (
                            <p className="text-xs text-neutral-400">No wardrobe items. <a href="/wardrobe" className="underline">Add to wardrobe</a> first.</p>
                          ) : (
                            (['shoes', 'shirt', 'jacket', 'pants'] as const).map(cat => {
                              const items = allWardrobeItemsRaw.filter((i: any) => i.category === cat);
                              if (items.length === 0) return null;
                              const selectedId = modelSelections[cat] || '';
                              return (
                                <div key={cat}>
                                  <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                                    {cat === 'shirt' ? 'Shirt / Top' : cat === 'jacket' ? 'Jacket / Outerwear' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                                    {selectedId && <span className="text-neutral-900 ml-2 normal-case">✓</span>}
                                  </p>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {items.map((item: any) => {
                                      const isSel = selectedId === item.id;
                                      return (
                                        <button
                                          key={item.id}
                                          type="button"
                                          onClick={() => setPerModelWardrobeSelection(prev => ({
                                            ...prev,
                                            [modelId]: { ...(prev[modelId] || {}), [cat]: isSel ? '' : item.id },
                                          }))}
                                          className={`border p-1 w-16 text-left transition-all ${isSel ? 'border-neutral-900 ring-1 ring-neutral-900 bg-white' : 'border-neutral-200 hover:border-neutral-400 bg-white'}`}
                                        >
                                          <div className="aspect-square bg-neutral-100 mb-1 overflow-hidden">
                                            {item.thumbnailUrl
                                              ? <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                                              : <div className="w-full h-full flex items-center justify-center text-neutral-300 text-[9px]">?</div>
                                            }
                                          </div>
                                          <p className="text-[9px] text-neutral-700 truncate leading-tight">{item.name}</p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          )}

                          {genStatus && <p className="text-xs text-neutral-600">{genStatus}</p>}

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleGenerateDressedFromWizard(modelId)}
                              disabled={isGenerating || Object.values(modelSelections).filter(Boolean).length === 0}
                              className="px-4 py-1.5 bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 disabled:opacity-30 transition-colors"
                            >
                              {isGenerating ? 'Generating…' : 'Generate (Front + Back)'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setOutfitPickerModel(null); setPerModelWardrobeSelection(prev => ({ ...prev, [modelId]: {} })); }}
                              disabled={isGenerating}
                              className="px-4 py-1.5 border border-neutral-300 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {isGenerating && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="w-3 h-3 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                          <span className="text-xs text-neutral-500">{genStatus}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(5)}
                disabled={!!dressedGeneratingModel}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue to Review
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Review & Submit ─────────────────────────────────────────── */}
        {step === 5 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-neutral-900">Review & Generate</h2>

            <div className="border border-neutral-200 bg-white divide-y divide-neutral-100">
              {jobName && (
                <div className="px-5 py-3 flex justify-between">
                  <span className="text-sm text-neutral-500">Job Name</span>
                  <span className="text-sm font-medium text-neutral-900">{jobName}</span>
                </div>
              )}
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Design Number</span>
                <span className="text-sm font-medium text-neutral-900">{designNumber}</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Category</span>
                <span className="text-sm font-medium text-neutral-900 capitalize">{category}</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Models</span>
                <span className="text-sm font-medium text-neutral-900">{selectedModels.join(', ')}</span>
              </div>
              {Object.values(selectedDressedBase).some(b => b) && (
                <div className="px-5 py-3">
                  <span className="text-sm text-neutral-500">Outfits</span>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {Object.entries(selectedDressedBase)
                      .filter(([, base]) => base)
                      .map(([modelId, base]: [string, any]) => {
                        const itemNames = base?.wardrobeItemNames || base?.wardrobeItemIds || {};
                        const label = Object.values(itemNames).join(' + ') || 'Dressed base';
                        return (
                          <span key={modelId} className="text-xs px-2 py-1 bg-neutral-100 text-neutral-700">
                            {modelId}: {label}
                          </span>
                        );
                      })}
                  </div>
                </div>
              )}
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Total Shots</span>
                <span className="text-sm font-medium text-neutral-900">{selectedModels.length * 7}</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Est. Time</span>
                <span className="text-sm font-medium text-neutral-900">~{selectedModels.length * 12} min</span>
              </div>
              <div className="px-5 py-3">
                <span className="text-sm text-neutral-500">Description</span>
                <p className="text-sm text-neutral-700 mt-1">{description}</p>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button onClick={() => setStep(4)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  setSubmitError('');
                  try {
                    // Wardrobe source — pass GCS URLs directly (no base64 upload)
                    const image360Urls_passthrough = wardrobeSourceItem?.imageUrls || [];
                    const flatImageUrl_passthrough = wardrobeSourceItem?.flatImageUrl || undefined;

                    // Build wardrobe item IDs (only non-null selections)
                    const wardrobeItemIds: Record<string, string> = {};
                    for (const [cat, id] of Object.entries(selectedWardrobe)) {
                      if (id) wardrobeItemIds[cat] = id;
                    }

                    const resp = await fetch('/api/jobs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        designNumber,
                        jobName: jobName || designNumber,
                        creatorEmail: user.email,
                        garmentCategory: category,
                        description,
                        metadata,
                        modelIds: selectedModels,
                        modelDescriptions: Object.fromEntries(
                          selectedModels.map(id => {
                            const m = dbModels.find(m => m.modelId === id);
                            return [id, m?.description || ''];
                          })
                        ),
                        flatImageBase64: '',
                        flatImageMimeType: '',
                        images360Base64: [],
                        ...(flatImageUrl_passthrough ? { flatImageUrl: flatImageUrl_passthrough } : {}),
                        ...(image360Urls_passthrough.length > 0 ? { image360Urls: image360Urls_passthrough } : {}),
                        wardrobeItemIds,
                      }),
                    });

                    const text = await resp.text();
                    let data;
                    try {
                      data = JSON.parse(text);
                    } catch {
                      throw new Error(resp.status === 413 ? 'Images too large — try smaller files' : `Server error (${resp.status})`);
                    }
                    if (!resp.ok) {
                      throw new Error(data.error || 'Failed to create job');
                    }
                    sessionStorage.removeItem(SESSION_KEY);
                    router.push(`/jobs/${data.jobId}/results`);
                  } catch (err) {
                    setSubmitError(String(err));
                    setSubmitting(false);
                  }
                }}
                className="bg-neutral-900 text-white px-8 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Generate Shots'}
              </button>
              {submitError && (
                <p className="text-sm text-red-600 mt-2 w-full">{submitError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function NewJobPage() {
  return (
    <Suspense fallback={null}>
      <NewJobContent />
    </Suspense>
  );
}
