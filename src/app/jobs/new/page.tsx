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
  category: string;
  gender?: string;
  description: string;
  thumbnailUrl: string;
  fitModels?: Record<string, string>;
  fitModelUrls?: string[];
  flatFrontUrl?: string;
  flatBackUrl?: string;
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
  const [jobName, setJobName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Wardrobe selections — one item per slot
  const [selections, setSelections] = useState<Record<SlotKey, string | null>>({
    shoe: null, top: null, bottom: null,
  });
  const [focusSlot, setFocusSlot] = useState<SlotKey | null>(null);

  // Model selection
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    searchParams?.get('modelId') || null
  );

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

  // Helper to get items for a slot
  function getItemsForSlot(slot: SlotKey): WardrobeItem[] {
    const config = SLOTS.find(s => s.key === slot)!;
    return allWardrobe.filter(i => config.categories.includes(i.category));
  }

  // Get selected item object
  function getSelectedItem(slot: SlotKey): WardrobeItem | null {
    const id = selections[slot];
    if (!id) return null;
    return allWardrobe.find(i => i.id === id || i.wardrobeId === id) || null;
  }

  // Count filled slots
  const filledSlots = Object.values(selections).filter(Boolean).length;
  const hasFocus = focusSlot !== null && selections[focusSlot] !== null;

  // Selected model
  const selectedModel = models.find(m => m.modelId === selectedModelId || m.id === selectedModelId);

  const STEPS = [
    { n: 1, label: 'Outfit' },
    { n: 2, label: 'Focus' },
    { n: 3, label: 'Model' },
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

        {/* ── Step 1: Select 3 Items ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Build the Outfit</h2>
              <p className="text-sm text-neutral-500 mt-1">Pick one item per slot: shoes, top, and bottom.</p>
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

            {loadingWardrobe ? (
              <p className="text-sm text-neutral-400">Loading wardrobe...</p>
            ) : (
              <div className="space-y-6">
                {SLOTS.map(slot => {
                  const items = getItemsForSlot(slot.key);
                  const selectedId = selections[slot.key];
                  return (
                    <div key={slot.key}>
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                        {slot.label}
                        {selectedId && <span className="text-green-600 ml-2 normal-case">selected</span>}
                      </p>
                      {items.length === 0 ? (
                        <p className="text-xs text-neutral-400">
                          No {slot.label.toLowerCase()} in wardrobe. <a href="/wardrobe" className="underline hover:text-neutral-700">Add items</a>
                        </p>
                      ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                          {items.map(item => {
                            const isSel = selectedId === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setSelections(prev => ({
                                    ...prev,
                                    [slot.key]: isSel ? null : item.id,
                                  }));
                                  // Clear focus if deselecting the focused item
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
                                  <p className="text-xs font-medium text-neutral-900 truncate">{item.name}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              disabled={filledSlots < 3}
              className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              Continue ({filledSlots}/3 selected)
            </button>
          </div>
        )}

        {/* ── Step 2: Mark Focus Item ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Focus Garment</h2>
              <p className="text-sm text-neutral-500 mt-1">
                The focus item gets full fit model angles and drives the generation. The other two items are used as styling references.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {SLOTS.map(slot => {
                const item = getSelectedItem(slot.key);
                if (!item) return null;
                const isFocus = focusSlot === slot.key;
                return (
                  <button
                    key={slot.key}
                    type="button"
                    onClick={() => setFocusSlot(slot.key)}
                    className={`border-2 p-3 text-left transition-all ${
                      isFocus
                        ? 'border-green-600 bg-green-50 ring-1 ring-green-600'
                        : 'border-neutral-200 hover:border-neutral-400'
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
                    <p className="text-sm font-medium text-neutral-900 truncate">{item.name}</p>
                    {isFocus && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-green-600 text-white text-[10px] uppercase font-medium">
                        Focus
                      </span>
                    )}
                    {!isFocus && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-neutral-200 text-neutral-500 text-[10px] uppercase font-medium">
                        Styling
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!hasFocus}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Select Model ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">Select Model</h2>
              <p className="text-sm text-neutral-500 mt-1">Choose the AI model who will wear the outfit.</p>
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
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                        {gender === 'female' ? 'Women' : 'Men'}
                      </p>
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                        {gModels.map(m => {
                          const isSel = selectedModelId === m.modelId || selectedModelId === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSelectedModelId(m.modelId)}
                              className={`border text-left transition-all ${isSel ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}
                            >
                              <div className="aspect-[3/4] bg-neutral-100 relative overflow-hidden">
                                {(m.referenceImageUrl || m.cardImageUrl) ? (
                                  <img src={(m.referenceImageUrl || m.cardImageUrl)!} alt={m.name} className="w-full h-full object-cover object-top" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">{m.modelId}</div>
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
                                <p className="text-xs font-medium text-neutral-900">{m.modelId}</p>
                                <p className="text-[10px] text-neutral-400">{m.name}</p>
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

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!selectedModelId}
                className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
              >
                Continue to Review
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Submit ── */}
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
                <span className="text-sm text-neutral-500">Model</span>
                <span className="text-sm font-medium text-neutral-900">{selectedModel?.modelId} — {selectedModel?.name}</span>
              </div>

              {/* Outfit summary */}
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
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.name}</p>
                        {isFocus && <span className="text-[9px] text-green-600 font-medium uppercase">Focus</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Shots</span>
                <span className="text-sm font-medium text-neutral-900">5 shots (M03 &rarr; M04 &rarr; M01 + M02 &rarr; M05)</span>
              </div>
              <div className="px-5 py-3 flex justify-between">
                <span className="text-sm text-neutral-500">Est. Time</span>
                <span className="text-sm font-medium text-neutral-900">~8-12 min</span>
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
                    // Build wardrobe payload matching v2 API
                    const wardrobe: Record<string, { itemId: string; isFocus: boolean }> = {};
                    for (const slot of SLOTS) {
                      const itemId = selections[slot.key];
                      if (itemId) {
                        wardrobe[slot.key] = {
                          itemId,
                          isFocus: focusSlot === slot.key,
                        };
                      }
                    }

                    const resp = await fetch('/api/jobs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        jobName: jobName || 'Untitled Job',
                        creatorEmail: user.email,
                        modelId: selectedModelId,
                        wardrobe,
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
