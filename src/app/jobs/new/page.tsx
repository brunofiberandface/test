'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';

interface WardrobeItem {
  id: string;
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category: string;
  gender?: string;
  description: string;
  thumbnailUrl: string;
  fitModels?: Record<string, string>;
  fitModelUrls?: string[];
  flatFrontUrl?: string;
  flatBackUrl?: string;
}

/**
 * Extract the style-code prefix from a full design number.
 * e.g. "D15264-C052-D332" -> "D15264". Empty-safe.
 * Variants (colorways / fits) of the same style share the same prefix.
 */
function extractStyleCode(designNumber?: string): string {
  if (!designNumber) return '';
  const firstSegment = designNumber.split('-')[0]?.trim();
  return firstSegment || '';
}

interface ModelItem {
  id: string;
  modelId: string;
  name: string;
  gender: string;
  referenceImageUrl?: string;
  cardImageUrl?: string;
  active: boolean;
}

type SlotKey = 'shoe' | 'top' | 'bottom';

const SLOTS: { key: SlotKey; label: string; categories: string[] }[] = [
  { key: 'shoe', label: 'Shoes', categories: ['shoes'] },
  { key: 'top', label: 'Top', categories: ['top', 'shirt', 'jacket', 'knitwear'] },
  { key: 'bottom', label: 'Bottom', categories: ['bottom', 'pants', 'jeans'] },
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [stylingNotes, setStylingNotes] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'seedream'>('gemini');

  // Wardrobe selections — one item per slot
  const [selections, setSelections] = useState<Record<SlotKey, string | null>>({
    shoe: null, top: null, bottom: null,
  });
  const [focusSlot, setFocusSlot] = useState<SlotKey | null>(null);

  // Model selection
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    searchParams?.get('modelId') || null
  );

  // Unisex expand toggle per slot
  const [showUnisex, setShowUnisex] = useState<Record<SlotKey, boolean>>({
    shoe: false, top: false, bottom: false,
  });

  // Per-slot style-code filter (dropdown above each slot's item grid).
  // 'all' = no filter; otherwise matches extractStyleCode(item.designNumber).
  const [slotStyleCode, setSlotStyleCode] = useState<Record<SlotKey, string>>({
    shoe: 'all', top: 'all', bottom: 'all',
  });

  // Data
  const [allWardrobe, setAllWardrobe] = useState<WardrobeItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingWardrobe, setLoadingWardrobe] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);

  // Fetch wardrobe + models on mount
  useEffect(() => {
    fetch('/api/wardrobe').then(r => r.json()).then(d => setAllWardrobe(d.items || []))
      .catch(() => {}).finally(() => setLoadingWardrobe(false));
    fetch('/api/models').then(r => r.json()).then(d => setModels((d.models || []).filter((m: ModelItem) => m.active)))
      .catch(() => {}).finally(() => setLoadingModels(false));
  }, []);

  // Selected model
  const selectedModel = models.find(m => m.modelId === selectedModelId || m.id === selectedModelId);
  const modelGender = selectedModel?.gender || null;

  // Helper to get items for a slot, filtered by model gender
  function getItemsForSlot(slot: SlotKey, genderOnly: boolean): WardrobeItem[] {
    const config = SLOTS.find(s => s.key === slot)!;
    const byCategory = allWardrobe.filter(i => config.categories.includes(i.category));
    if (!modelGender) return byCategory;
    if (genderOnly) {
      return byCategory.filter(i => (i.gender || 'unisex') === modelGender);
    }
    // Unisex items
    return byCategory.filter(i => (i.gender || 'unisex') === 'unisex');
  }

  // Get selected item object
  function getSelectedItem(slot: SlotKey): WardrobeItem | null {
    const id = selections[slot];
    if (!id) return null;
    return allWardrobe.find(i => i.id === id || i.wardrobeId === id) || null;
  }

  // Check if an item has fit model angles (focus-eligible)
  function hasFitModelAngles(item: WardrobeItem): boolean {
    if (item.fitModels && Object.values(item.fitModels).filter(Boolean).length > 0) return true;
    if (item.fitModelUrls && item.fitModelUrls.length > 0) return true;
    return false;
  }

  // Count filled slots
  const filledSlots = Object.values(selections).filter(Boolean).length;
  const hasFocus = focusSlot !== null && selections[focusSlot] !== null;

  const STEPS = [
    { n: 1, label: 'Model' },
    { n: 2, label: 'Outfit' },
    { n: 3, label: 'Focus' },
    { n: 4, label: 'Review' },
  ];

  return (
    <Shell user={user}>
      <div className="max-w-5xl">
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

        {/* Step 1: Select Model (Full Screen) */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Model</h2>
              <p className="text-sm text-neutral-500 mt-1">Choose the AI model who will wear the outfit. This determines which wardrobe items you will see.</p>
            </div>

            {loadingModels ? (
              <p className="text-sm text-neutral-400">Loading models...</p>
            ) : models.length === 0 ? (
              <div className="border-2 border-dashed border-neutral-300 p-8 text-center">
                <p className="text-sm text-neutral-500">No active models.</p>
                <a href="/models/new" className="inline-block mt-3 px-4 py-2 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors">
                  Create Model
                </a>
              </div>
            ) : (
              <>
                {(['female', 'male'] as const).map(gender => {
                  const gModels = models.filter(m => m.gender === gender);
                  if (gModels.length === 0) return null;
                  return (
                    <div key={gender}>
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                        {gender === 'female' ? 'Women' : 'Men'}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {gModels.map(m => {
                          const isSel = selectedModelId === m.modelId || selectedModelId === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setSelectedModelId(m.modelId);
                                setSelections({ shoe: null, top: null, bottom: null });
                                setFocusSlot(null);
                                setShowUnisex({ shoe: false, top: false, bottom: false });
                              }}
                              className={`border text-left transition-all ${isSel ? 'border-neutral-900 ring-2 ring-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}
                            >
                              <div className="aspect-[3/4] bg-neutral-100 relative overflow-hidden">
                                {(m.referenceImageUrl || m.cardImageUrl) ? (
                                  <img src={(m.referenceImageUrl || m.cardImageUrl)!} alt={m.name} className="w-full h-full object-cover object-top" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-lg">{m.modelId}</div>
                                )}
                                {isSel && (
                                  <div className="absolute top-2 right-2 w-6 h-6 bg-neutral-900 flex items-center justify-center">
                                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div className="p-2.5">
                                <p className="text-sm font-medium text-neutral-900">{m.modelId}</p>
                                <p className="text-xs text-neutral-400">{m.name}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <button
              onClick={() => setStep(2)}
              disabled={!selectedModelId}
              className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              Continue to Outfit
            </button>
          </div>
        )}

        {/* Step 2: Style the Model */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex gap-6">
              {/* Model preview — sticky */}
              <div className="w-[350px] flex-shrink-0">
                <div className="sticky top-4">
                  <div className="border border-neutral-200 bg-white">
                    <div className="bg-neutral-100 overflow-hidden h-[600px]">
                      {selectedModel && (selectedModel.referenceImageUrl || selectedModel.cardImageUrl) ? (
                        <img
                          src={(selectedModel.referenceImageUrl || selectedModel.cardImageUrl)!}
                          alt={selectedModel.name}
                          className="w-[calc(100%+100px)] max-w-none h-full object-cover object-top -ml-[50px]"
                        />
                      ) : (
                        <div className="aspect-[3/4] flex items-center justify-center text-neutral-300">{selectedModel?.modelId}</div>
                      )}
                    </div>
                    <div className="p-2.5 border-t border-neutral-100">
                      <p className="text-xs font-medium text-neutral-900">{selectedModel?.modelId}</p>
                      <p className="text-[10px] text-neutral-400">{selectedModel?.name} &middot; {selectedModel?.gender}</p>
                    </div>
                  </div>

                  {filledSlots > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider">Selected</p>
                      {SLOTS.map(slot => {
                        const item = getSelectedItem(slot.key);
                        if (!item) return null;
                        return (
                          <div key={slot.key} className="flex items-center gap-2 bg-white border border-neutral-200 p-1.5">
                            <div className="w-8 h-8 bg-neutral-100 overflow-hidden flex-shrink-0">
                              {item.thumbnailUrl && <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-neutral-400 uppercase">{slot.label}</p>
                              <p className="text-xs font-medium text-neutral-900 truncate">{item.designNumber || item.name}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelections(prev => ({ ...prev, [slot.key]: null }));
                                if (focusSlot === slot.key) setFocusSlot(null);
                              }}
                              className="text-neutral-300 hover:text-red-500 flex-shrink-0 p-0.5"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Wardrobe selection */}
              <div className="flex-1 space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-neutral-900">Build the Outfit</h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Pick one item per slot. Showing <span className="font-medium">{modelGender}</span> items.
                  </p>
                </div>

                {loadingWardrobe ? (
                  <p className="text-sm text-neutral-400">Loading wardrobe...</p>
                ) : (
                  <div className="space-y-8">
                    {SLOTS.map(slot => {
                      const allGenderItems = getItemsForSlot(slot.key, true);
                      const allUnisexItems = getItemsForSlot(slot.key, false);
                      const selectedId = selections[slot.key];
                      const isUnisexExpanded = showUnisex[slot.key];

                      // Style codes available for this slot (across gender + unisex).
                      const slotStyleCodes = Array.from(
                        new Set(
                          [...allGenderItems, ...allUnisexItems]
                            .map(i => extractStyleCode(i.designNumber))
                            .filter(Boolean)
                        )
                      ).sort();

                      // Apply the slot's style-code filter to both lists.
                      const activeCode = slotStyleCode[slot.key];
                      const genderItems = activeCode === 'all'
                        ? allGenderItems
                        : allGenderItems.filter(i => extractStyleCode(i.designNumber) === activeCode);
                      const unisexItems = activeCode === 'all'
                        ? allUnisexItems
                        : allUnisexItems.filter(i => extractStyleCode(i.designNumber) === activeCode);

                      return (
                        <div key={slot.key}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                              {slot.label}
                              {selectedId && <span className="text-green-600 ml-2 normal-case">selected</span>}
                            </p>
                            {slotStyleCodes.length > 0 && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Style</span>
                                <select
                                  value={activeCode}
                                  onChange={(e) => setSlotStyleCode(prev => ({ ...prev, [slot.key]: e.target.value }))}
                                  className="px-2 py-1 text-xs border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 focus:outline-none focus:border-neutral-900"
                                >
                                  <option value="all">All ({slotStyleCodes.length})</option>
                                  {slotStyleCodes.map(code => (
                                    <option key={code} value={code}>{code}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          {genderItems.length === 0 && unisexItems.length === 0 ? (
                            <p className="text-xs text-neutral-400">
                              No {slot.label.toLowerCase()} in wardrobe for {modelGender}. <a href="/wardrobe" className="underline hover:text-neutral-700">Add items</a>
                            </p>
                          ) : (
                            <>
                              {genderItems.length > 0 && (
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {genderItems.map(item => {
                                    const isSel = selectedId === item.id;
                                    return (
                                      <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                          setSelections(prev => ({ ...prev, [slot.key]: isSel ? null : item.id }));
                                          if (isSel && focusSlot === slot.key) setFocusSlot(null);
                                        }}
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
                                          <p className="text-xs font-medium text-neutral-900 truncate">{item.designNumber || item.name}</p>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}

                              {unisexItems.length > 0 && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => setShowUnisex(prev => ({ ...prev, [slot.key]: !prev[slot.key] }))}
                                    className="text-xs text-neutral-400 hover:text-neutral-600 flex items-center gap-1.5 transition-colors"
                                  >
                                    <svg className={`w-3 h-3 transition-transform ${isUnisexExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    {isUnisexExpanded ? 'Hide' : 'Show'} unisex items ({unisexItems.length})
                                  </button>
                                  {isUnisexExpanded && (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-2">
                                      {unisexItems.map(item => {
                                        const isSel = selectedId === item.id;
                                        return (
                                          <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => {
                                              setSelections(prev => ({ ...prev, [slot.key]: isSel ? null : item.id }));
                                              if (isSel && focusSlot === slot.key) setFocusSlot(null);
                                            }}
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
                                              <div className="absolute bottom-0 left-0 right-0 bg-neutral-100/80 text-center">
                                                <span className="text-[9px] text-neutral-400 uppercase">Unisex</span>
                                              </div>
                                            </div>
                                            <div className="p-1.5">
                                              <p className="text-xs font-medium text-neutral-900 truncate">{item.designNumber || item.name}</p>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}

                              {genderItems.length === 0 && !isUnisexExpanded && (
                                <p className="text-xs text-neutral-400">
                                  No {modelGender} {slot.label.toLowerCase()} found.{unisexItems.length > 0 && ' Expand unisex items above.'}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                    Back
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={filledSlots < 3}
                    className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
                  >
                    Continue ({filledSlots}/3 selected)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Mark Focus Item */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Focus Garment</h2>
              <p className="text-sm text-neutral-500 mt-1">
                The focus item gets full fit model angles and drives the generation. The other two items are styling references.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {SLOTS.map(slot => {
                const item = getSelectedItem(slot.key);
                if (!item) return null;
                const isFocus = focusSlot === slot.key;
                const canBeFocus = hasFitModelAngles(item);
                return (
                  <button
                    key={slot.key}
                    type="button"
                    onClick={() => { if (canBeFocus) setFocusSlot(slot.key); }}
                    disabled={!canBeFocus}
                    className={`border-2 p-3 text-left transition-all ${
                      isFocus
                        ? 'border-green-600 bg-green-50 ring-1 ring-green-600'
                        : canBeFocus
                          ? 'border-neutral-200 hover:border-neutral-400'
                          : 'border-neutral-200 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="aspect-square bg-neutral-100 overflow-hidden mb-2">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-300">?</div>
                      )}
                    </div>
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">{slot.label}</p>
                    <p className="text-sm font-medium text-neutral-900 truncate">{item.designNumber || item.name}</p>
                    {isFocus && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-green-600 text-white text-[10px] uppercase font-medium">
                        Focus
                      </span>
                    )}
                    {!isFocus && canBeFocus && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-neutral-200 text-neutral-500 text-[10px] uppercase font-medium">
                        Styling
                      </span>
                    )}
                    {!canBeFocus && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-neutral-100 text-neutral-400 text-[10px] uppercase font-medium">
                        Styling only
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!hasFocus}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Submit */}
        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-neutral-900">Review & Generate</h2>

            <div className="border border-neutral-200 bg-white divide-y divide-neutral-100">
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Model</span>
                <span className="text-sm font-medium text-neutral-900">{selectedModel?.modelId} — {selectedModel?.name}</span>
              </div>

              <div className="px-5 py-3">
                <span className="text-sm text-neutral-500 block mb-2">Outfit</span>
                <div className="flex gap-3">
                  {SLOTS.map(slot => {
                    const item = getSelectedItem(slot.key);
                    if (!item) return null;
                    const isFocus = focusSlot === slot.key;
                    return (
                      <div key={slot.key} className={`flex-1 border p-2 ${isFocus ? 'border-green-600 bg-green-50' : 'border-neutral-200'}`}>
                        <div className="aspect-square bg-neutral-100 overflow-hidden mb-1">
                          {item.thumbnailUrl && <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />}
                        </div>
                        <p className="text-[10px] text-neutral-500 uppercase">{slot.label}</p>
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.designNumber || item.name}</p>
                        {isFocus && <span className="text-[9px] text-green-600 font-medium uppercase">Focus</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Shots</span>
                <span className="text-sm font-medium text-neutral-900">5 shots (M03 → M04 → M01 + M02 → M05)</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Est. Time</span>
                <span className="text-sm font-medium text-neutral-900">~8-12 min</span>
              </div>
            </div>

            {/* Styling Notes */}
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Styling Notes <span className="text-neutral-400 normal-case font-normal">(optional — instructions for the AI generation)</span>
              </label>
              <textarea
                value={stylingNotes}
                onChange={e => setStylingNotes(e.target.value)}
                placeholder="e.g., pants need to be very loose, tuck the shirt in, roll up the sleeves..."
                rows={3}
                className="w-full border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-900 resize-none"
              />
            </div>

            {/* Provider selection */}
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Generation engine
              </label>
              <div className="flex gap-4">
                <label className={`flex-1 flex items-start gap-3 border px-4 py-3 cursor-pointer ${provider === 'gemini' ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'}`}>
                  <input
                    type="radio"
                    name="provider"
                    value="gemini"
                    checked={provider === 'gemini'}
                    onChange={() => setProvider('gemini')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-neutral-900">Run with Gemini</div>
                    <div className="text-xs text-neutral-500">Production default — two-phase pipeline with dressed base</div>
                  </div>
                </label>
                <label className={`flex-1 flex items-start gap-3 border px-4 py-3 cursor-pointer ${provider === 'seedream' ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'}`}>
                  <input
                    type="radio"
                    name="provider"
                    value="seedream"
                    checked={provider === 'seedream'}
                    onChange={() => setProvider('seedream')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-neutral-900">Run with Seedream 4.5</div>
                    <div className="text-xs text-neutral-500">BytePlus single-pass — same prompts, no dressed base</div>
                  </div>
                </label>
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
                    const wardrobe: Record<string, { itemId: string; isFocus: boolean }> = {};
                    for (const slot of SLOTS) {
                      const itemId = selections[slot.key];
                      if (itemId) {
                        wardrobe[slot.key] = { itemId, isFocus: focusSlot === slot.key };
                      }
                    }

                    const resp = await fetch('/api/jobs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        creatorEmail: user.email,
                        modelId: selectedModelId,
                        wardrobe,
                        stylingNotes: stylingNotes.trim() || undefined,
                        provider,
                      }),
                    });

                    const text = await resp.text();
                    let data;
                    try {
                      data = JSON.parse(text);
                    } catch {
                      throw new Error(resp.status === 413 ? 'Images too large — try smaller files' : `Server error (${resp.status})`);
                    }
                    if (!resp.ok) throw new Error(data.error || 'Failed to create job');
                    router.push(`/jobs/${data.jobId}/results`);
                  } catch (err) {
                    setSubmitError(String(err));
                    setSubmitting(false);
                  }
                }}
                className="bg-neutral-900 text-white px-8 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Generate All 5 Shots'}
              </button>
              {submitError && <p className="text-sm text-red-600 mt-2 w-full">{submitError}</p>}
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
