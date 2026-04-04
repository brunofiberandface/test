'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';
import { CATEGORY_FIELDS, type GarmentCategory, type WardrobeCategory } from '@/types';

const CATEGORIES: { value: GarmentCategory; label: string }[] = [
  { value: 'pants', label: 'Pants / Jeans' },
  { value: 'jackets', label: 'Jackets' },
  { value: 'tops', label: 'Tops' },
  { value: 'knitwear', label: 'Knitwear' },
  { value: 'dresses', label: 'Dresses / Skirts' },
  { value: 'accessories', label: 'Accessories' },
];

function NewJobContent() {
  const { data: session } = useSession();
  const user = session?.user ? {
    email: session.user.email || '',
    name: session.user.name || '',
    role: 'admin' as const,
  } : { email: '', name: '', role: 'admin' as const };
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [jobName, setJobName] = useState('');
  const [designNumber, setDesignNumber] = useState('');
  const [category, setCategory] = useState<GarmentCategory>('pants');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
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
  const [allWardrobeItemsRaw, setAllWardrobeItemsRaw] = useState<any[]>([]); // all items — for styling picker
  const [wardrobeSourceLoading, setWardrobeSourceLoading] = useState(true);

  // Wardrobe state — selectedWardrobe tracks shoes and shirt selections
  const [selectedWardrobe, setSelectedWardrobe] = useState<Record<WardrobeCategory, string | null>>({
    shoes: null, shirt: null, jacket: null, pants: null,
  });

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
      if (s.selectedWardrobe) setSelectedWardrobe(s.selectedWardrobe);
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
        selectedWardrobe,
        wardrobeSourceItemId: wardrobeSourceItem?.id || null,
      }));
    } catch { /* ignore */ }
  }, [step, jobName, designNumber, category, description, metadata, selectedWardrobe, wardrobeSourceItem]);

  // Fetch all wardrobe items on mount
  useEffect(() => {
    async function fetchAllWardrobe() {
      try {
        const res = await fetch('/api/wardrobe');
        if (res.ok) {
          const data = await res.json();
          const allItems: any[] = data.items || [];
          setAllWardrobeItemsRaw(allItems); // all items — for styling picker
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

  const fields = CATEGORY_FIELDS[category] || [];

  // ── Progress indicator ──────────────────────────────────────────────────────
  const STEPS = [
    { n: 1, label: 'Garment' },
    { n: 2, label: 'Details' },
    { n: 3, label: 'Styling' },
    { n: 4, label: 'Review' },
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
              {s.n < 4 && <div className="w-8 h-px bg-neutral-200 mx-1" />}
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
                                  const totalPhotos = (item.fitModelUrls?.length || item.imageUrls?.length || 0) + (item.flatFrontUrl || item.flatImageUrl ? 1 : 0) + (item.flatBackUrl ? 1 : 0);
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
                  <span className="text-sm text-neutral-700">Using <strong>{wardrobeSourceItem.name}</strong> ({(wardrobeSourceItem.fitModelUrls?.length || wardrobeSourceItem.imageUrls?.length || 0) + (wardrobeSourceItem.flatFrontUrl || wardrobeSourceItem.flatImageUrl ? 1 : 0) + (wardrobeSourceItem.flatBackUrl ? 1 : 0)} photos)</span>
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

        {/* ── Step 3: Select Styling (Shoes & Top) ────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Styling</h2>
              <p className="text-sm text-neutral-500 mt-1">Choose shoes and a top from your wardrobe.</p>
            </div>

            {allWardrobeItemsRaw.length === 0 ? (
              <div className="border-2 border-dashed border-neutral-300 p-8 text-center">
                <p className="text-sm text-neutral-500">No wardrobe items available yet.</p>
                <a href="/wardrobe" className="inline-block mt-3 px-4 py-2 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors">
                  Go to Wardrobe
                </a>
              </div>
            ) : (
              <div className="space-y-6">
                {(['shirt', 'shoes'] as const).map(cat => {
                  const items = allWardrobeItemsRaw.filter((i: any) => i.category === cat);
                  if (items.length === 0) return null;
                  const selectedId = selectedWardrobe[cat] || '';
                  return (
                    <div key={cat}>
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                        {cat === 'shirt' ? 'Shirt / Top' : 'Shoes'}
                        {selectedId && <span className="text-neutral-900 ml-2 normal-case">✓</span>}
                      </p>
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                        {items.map((item: any) => {
                          const isSel = selectedId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedWardrobe(prev => ({
                                ...prev,
                                [cat]: isSel ? null : item.id,
                              }))}
                              className={`border text-left transition-all ${isSel ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}
                            >
                              <div className="aspect-square bg-neutral-100 relative overflow-hidden">
                                {item.thumbnailUrl ? (
                                  <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">?</div>
                                )}
                                {isSel && (
                                  <div className="absolute top-1 right-1 w-4 h-4 bg-neutral-900 flex items-center justify-center">
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div className="p-1.5">
                                <p className="text-xs font-medium text-neutral-900 truncate">{item.name}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
              >
                Continue to Review
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Submit ─────────────────────────────────────────── */}
        {step === 4 && (
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
              {(selectedWardrobe.shirt || selectedWardrobe.shoes) && (
                <div className="px-5 py-3">
                  <span className="text-sm text-neutral-500">Styling</span>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {selectedWardrobe.shirt && (
                      <span className="text-xs px-2 py-1 bg-neutral-100 text-neutral-700">
                        Top: {allWardrobeItemsRaw.find((i: any) => i.id === selectedWardrobe.shirt)?.name || selectedWardrobe.shirt}
                      </span>
                    )}
                    {selectedWardrobe.shoes && (
                      <span className="text-xs px-2 py-1 bg-neutral-100 text-neutral-700">
                        Shoes: {allWardrobeItemsRaw.find((i: any) => i.id === selectedWardrobe.shoes)?.name || selectedWardrobe.shoes}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Total Shots</span>
                <span className="text-sm font-medium text-neutral-900">1 shot (M03)</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Est. Time</span>
                <span className="text-sm font-medium text-neutral-900">~2 min</span>
              </div>
              <div className="px-5 py-3">
                <span className="text-sm text-neutral-500">Description</span>
                <p className="text-sm text-neutral-700 mt-1">{description}</p>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button onClick={() => setStep(3)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  setSubmitError('');
                  try {
                    // Wardrobe source — pass GCS URLs directly (no base64 upload)
                    const flatFrontUrl_passthrough = wardrobeSourceItem?.flatFrontUrl || wardrobeSourceItem?.flatImageUrl || undefined;
                    const flatBackUrl_passthrough = wardrobeSourceItem?.flatBackUrl || undefined;

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
                        flatImageBase64: '',
                        flatImageMimeType: '',
                        images360Base64: [],
                        ...(flatFrontUrl_passthrough ? { flatFrontUrl: flatFrontUrl_passthrough } : {}),
                        ...(flatBackUrl_passthrough ? { flatBackUrl: flatBackUrl_passthrough } : {}),
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
                {submitting ? 'Submitting...' : 'Generate Shot'}
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
