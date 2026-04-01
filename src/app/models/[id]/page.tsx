'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { useSession } from 'next-auth/react';

interface ModelData {
  id: string;
  modelId: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  cardImageUrl: string;
  active: boolean;
  createdAt?: string;
}

type DressedView = 'front' | 'right' | 'back' | 'left';

interface DressedBase {
  id: string;
  modelId: string;
  wardrobeItemIds: Record<string, string>;
  wardrobeHash: string;
  view?: DressedView;
  imageUrl: string;
  wardrobeItemNames?: Record<string, string>;
  qcScore?: number;
  qcPass?: boolean;
  createdAt?: string;
}

const VIEWS_ORDER: DressedView[] = ['front', 'right', 'back', 'left'];
const VIEW_LABELS: Record<DressedView, string> = {
  front: '→ Front',
  right: '↷ Right',
  back: '↩ Back',
  left: '↶ Left',
};

interface ViewProgress {
  status: 'pending' | 'generating' | 'done' | 'failed';
  qcScore?: number;
  qcPass?: boolean;
  elapsed?: number;
  error?: string;
}

interface WardrobeItem {
  id: string;
  name: string;
  category: string;
  gender?: 'male' | 'female' | 'unisex';
  isPrimary?: boolean;
  thumbnailUrl?: string;
}

export default function ModelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const modelId = params?.id as string;
  const { data: session } = useSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'creator' }
    : { email: '', name: '', role: 'creator' as const };
  const isAdmin = user.role === 'admin';

  const [model, setModel] = useState<ModelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Zoom state
  const [zoomMode, setZoomMode] = useState<'full' | 'head' | 'torso'>('full');
  const imgContainerRef = useRef<HTMLDivElement>(null);

  // Clone / "Create model from this" state
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneGender, setCloneGender] = useState<'male' | 'female'>('female');
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneRegenerate, setCloneRegenerate] = useState(false);

  // Regenerate state
  const [regenerating, setRegenerating] = useState(false);
  const [regenStatus, setRegenStatus] = useState('');

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Dressed bases state
  const [dressedBases, setDressedBases] = useState<DressedBase[]>([]);
  const [dressedBasesLoading, setDressedBasesLoading] = useState(false);
  const [showDressedPicker, setShowDressedPicker] = useState(false);
  const [confirmDeleteBaseId, setConfirmDeleteBaseId] = useState<string | null>(null);
  const [deletingBaseId, setDeletingBaseId] = useState<string | null>(null);
  const [allWardrobeItems, setAllWardrobeItems] = useState<WardrobeItem[]>([]);
  const [wardrobeLoading, setWardrobeLoading] = useState(false);
  const [selectedForDressed, setSelectedForDressed] = useState<Record<string, string>>({});
  const [generatingDressed, setGeneratingDressed] = useState<DressedView | null>(null);
  const [dressedStatus, setDressedStatus] = useState('');
  const [viewProgress, setViewProgress] = useState<Partial<Record<DressedView, ViewProgress>>>({});
  const [retryingView, setRetryingView] = useState<DressedView | null>(null);


  useEffect(() => {
    async function fetchModel() {
      try {
        const res = await fetch(`/api/models/${modelId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('not_found');
          } else {
            setError('Failed to load model');
          }
          return;
        }
        const data = await res.json();
        setModel(data.model);
      } catch {
        setError('Connection error');
      } finally {
        setLoading(false);
      }
    }
    if (modelId) fetchModel();
  }, [modelId]);

  // Fetch dressed bases for this model
  useEffect(() => {
    if (!modelId) return;
    setDressedBasesLoading(true);
    fetch(`/api/models/generate-dressed?modelId=${modelId}`)
      .then(r => r.json())
      .then(d => setDressedBases(d.bases || []))
      .catch(() => {/* non-blocking */})
      .finally(() => setDressedBasesLoading(false));
  }, [modelId]);

  // Fetch all wardrobe items when picker opens
  useEffect(() => {
    if (!showDressedPicker || allWardrobeItems.length > 0) return;
    setWardrobeLoading(true);
    fetch('/api/wardrobe')
      .then(r => r.json())
      .then(d => setAllWardrobeItems(d.items || []))
      .catch(() => {/* non-blocking */})
      .finally(() => setWardrobeLoading(false));
  }, [showDressedPicker, allWardrobeItems.length]);

  // Generate all 4 views via server-side streaming endpoint
  // Server handles all views autonomously — frontend just shows progress from SSE stream
  const handleGenerateDressed = async () => {
    const activeItems = Object.fromEntries(
      Object.entries(selectedForDressed).filter(([, v]) => v)
    );
    if (Object.keys(activeItems).length === 0) return;

    // Reset progress — all 4 views pending
    const initialProgress: Partial<Record<DressedView, ViewProgress>> = {};
    for (const v of VIEWS_ORDER) initialProgress[v] = { status: 'pending' };
    setViewProgress(initialProgress);
    setDressedStatus('Server generating all 4 views — you can close this tab, it will finish automatically.');
    setGeneratingDressed('front'); // Show generating state

    // Track elapsed time per view
    const viewStartTimes: Partial<Record<DressedView, number>> = {};
    let elapsedTicker: ReturnType<typeof setInterval> | null = null;

    // Start a global elapsed ticker that updates whichever view is currently generating
    elapsedTicker = setInterval(() => {
      setViewProgress(prev => {
        const updated = { ...prev };
        for (const v of VIEWS_ORDER) {
          if (updated[v]?.status === 'generating' && viewStartTimes[v]) {
            updated[v] = { ...updated[v]!, elapsed: Math.round((Date.now() - viewStartTimes[v]!) / 1000) };
          }
        }
        return updated;
      });
    }, 1000);

    try {
      // Fire single request to server-side streaming endpoint
      const res = await fetch('/api/models/generate-dressed-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model?.modelId || modelId,
          wardrobeItemIds: activeItems,
          replaceExisting: false,
        }),
      });

      if (!res.ok || !res.body) {
        if (elapsedTicker) clearInterval(elapsedTicker);
        setGeneratingDressed(null);
        setDressedStatus(`Server error (HTTP ${res.status})`);
        return;
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.view && event.status === 'generating') {
              viewStartTimes[event.view as DressedView] = Date.now();
              setGeneratingDressed(event.view);
              setViewProgress(prev => ({
                ...prev,
                [event.view]: { status: 'generating', elapsed: 0 },
              }));
            } else if (event.view && event.status === 'done') {
              setViewProgress(prev => ({
                ...prev,
                [event.view]: { status: 'done', qcScore: event.qcScore, qcPass: event.qcPass, elapsed: event.elapsed },
              }));
            } else if (event.view && event.status === 'failed') {
              setViewProgress(prev => ({
                ...prev,
                [event.view]: { status: 'failed', error: event.error, elapsed: event.elapsed },
              }));
            } else if (event.status === 'complete') {
              setDressedStatus(
                event.failed > 0
                  ? `Done — ${event.succeeded}/${event.total} views generated. ${event.failed} failed.`
                  : `All ${event.total} views generated!`
              );
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      setDressedStatus(`Connection error: ${String(err).substring(0, 100)}`);
    } finally {
      if (elapsedTicker) clearInterval(elapsedTicker);
      setGeneratingDressed(null);

      // Refresh dressed bases list regardless of outcome
      try {
        const r2 = await fetch(`/api/models/generate-dressed?modelId=${modelId}`);
        const d2 = await r2.json();
        setDressedBases(d2.bases || []);
      } catch { /* non-blocking */ }

      // Auto-close picker if all succeeded
      const finalProgress = { ...viewProgress };
      const allDone = VIEWS_ORDER.every(v => finalProgress[v]?.status === 'done');
      if (allDone) {
        setShowDressedPicker(false);
        setSelectedForDressed({});
        setViewProgress({});
        setDressedStatus('');
      }
    }
  };

  // Retry a single missing/failed view for an existing dressed base group
  const handleRetryView = async (view: DressedView, wardrobeItemIds: Record<string, string>) => {
    if (retryingView) return;
    setRetryingView(view);
    try {
      const res = await fetch('/api/models/generate-dressed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model?.modelId || modelId,
          wardrobeItemIds,
          view,
        }),
      });
      if (res.ok) {
        // Refresh dressed bases list
        const r2 = await fetch(`/api/models/generate-dressed?modelId=${modelId}`);
        const d2 = await r2.json();
        setDressedBases(d2.bases || []);
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setDressedStatus(`Retry ${view} failed: ${err.error || res.status}`);
      }
    } catch (err) {
      setDressedStatus(`Retry ${view} error: ${String(err).substring(0, 100)}`);
    } finally {
      setRetryingView(null);
    }
  };

  const handleClone = async () => {
    if (!cloneId || !cloneName || !cloneDescription || !model) return;
    setCloning(true);
    setError('');
    try {
      let cardImageUrl = model.cardImageUrl;

      // If regenerate is checked, generate a new card first
      if (cloneRegenerate) {
        setRegenStatus('Generating new card image (30-60s)...');
        const genRes = await fetch('/api/models/generate-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: cloneDescription, gender: cloneGender }),
        });
        const genData = await genRes.json();
        if (genData.success && genData.image) {
          cardImageUrl = `data:image/png;base64,${genData.image}`;
        } else {
          setError('Card generation failed — saving with original image');
        }
        setRegenStatus('');
      }

      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: cloneId.toUpperCase(),
          name: cloneName,
          description: cloneDescription,
          gender: cloneGender,
          cardImageUrl,
          createdBy: user.email,
        }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/models/${cloneId.toUpperCase()}`);
      } else {
        setError(data.error || 'Clone failed');
      }
    } catch {
      setError('Clone failed');
    } finally {
      setCloning(false);
      setRegenStatus('');
    }
  };

  // Regenerate this model's card image
  const handleRegenerate = async () => {
    if (!model) return;
    setRegenerating(true);
    setRegenStatus('Generating new card (30-60s)...');
    try {
      const res = await fetch('/api/models/generate-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: model.description, gender: model.gender }),
      });
      const data = await res.json();
      if (data.success && data.image) {
        // Save the new card to the model
        setRegenStatus('Saving...');
        const saveRes = await fetch(`/api/models/${model.modelId || model.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardImageUrl: `data:image/png;base64,${data.image}` }),
        });
        const saveData = await saveRes.json();
        if (saveData.success) {
          // Reload model
          setModel({ ...model, cardImageUrl: `data:image/png;base64,${data.image}` });
          setRegenStatus('Done — new card saved');
        } else {
          setRegenStatus('Generation OK but save failed');
        }
      } else {
        setRegenStatus('Generation failed');
      }
    } catch {
      setRegenStatus('Error');
    } finally {
      setRegenerating(false);
    }
  };

  // Delete model
  const handleDelete = async () => {
    if (!model) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/models/${model.modelId || model.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        router.push('/models');
      } else {
        setError(data.error || 'Delete failed');
      }
    } catch {
      setError('Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Delete a dressed base (Firestore doc only — GCS image kept for existing job refs)
  const handleDeleteBase = async (docId: string) => {
    setDeletingBaseId(docId);
    try {
      const res = await fetch(`/api/models/generate-dressed?id=${encodeURIComponent(docId)}`, { method: 'DELETE' });
      if (res.ok) {
        setDressedBases(prev => prev.filter(b => b.id !== docId));
      }
    } catch {
      /* non-blocking */
    } finally {
      setDeletingBaseId(null);
      setConfirmDeleteBaseId(null);
    }
  };

  // Zoom styles — for 9:16 full-body cards
  const zoomStyles: Record<string, React.CSSProperties> = {
    full: { objectFit: 'contain' as const, objectPosition: 'center', transform: 'scale(1)' },
    head: { objectFit: 'cover' as const, objectPosition: 'top center', transform: 'scale(2.5)', transformOrigin: '50% 6%' },
    torso: { objectFit: 'cover' as const, objectPosition: 'center', transform: 'scale(2)', transformOrigin: '50% 28%' },
  };

  if (loading) {
    return (
      <Shell user={user}>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      </Shell>
    );
  }

  if (error === 'not_found' || !model) {
    return (
      <Shell user={user}>
        <div className="text-center py-20">
          <p className="text-neutral-400 mb-3">Model not found</p>
          <Link href="/models" className="text-sm text-neutral-900 underline">Back to portfolio</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={user}>
      {/* Back link */}
      <Link href="/models" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-6 inline-block">
        &larr; Back to portfolio
      </Link>

      <div className="flex gap-8">
        {/* Left — image with zoom controls */}
        <div className="w-[280px] flex-shrink-0">
          {/* Zoom buttons */}
          <div className="flex gap-1 mb-3">
            {([
              { key: 'full', label: 'Full Body' },
              { key: 'head', label: 'Head Close-up' },
              { key: 'torso', label: 'Torso' },
            ] as const).map(z => (
              <button
                key={z.key}
                onClick={() => setZoomMode(z.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  zoomMode === z.key
                    ? 'bg-neutral-900 text-white'
                    : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>

          {/* Image container — 9:16 for new full-body cards */}
          <div
            ref={imgContainerRef}
            className="aspect-[9/16] bg-neutral-100 border border-neutral-200 overflow-hidden relative cursor-pointer"
            onClick={() => {
              const modes: Array<'full' | 'head' | 'torso'> = ['full', 'head', 'torso'];
              const idx = modes.indexOf(zoomMode);
              setZoomMode(modes[(idx + 1) % modes.length]);
            }}
          >
            {model.cardImageUrl && (
              <img
                src={model.cardImageUrl}
                alt={`${model.modelId} — ${model.name}`}
                className="w-full h-full transition-transform duration-500 ease-out"
                style={zoomStyles[zoomMode]}
              />
            )}
            <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1">
              {zoomMode === 'full' ? 'Click to zoom in' : zoomMode === 'head' ? 'Head close-up' : 'Torso view'} — click to cycle
            </div>
          </div>

          {/* Regenerate Card */}
          <div className="mt-3">
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="w-full border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-30"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate Card Image'}
            </button>
            {regenStatus && !showCloneForm && (
              <p className="text-xs text-neutral-500 mt-1">{regenStatus}</p>
            )}
          </div>
        </div>

        {/* Right — model info + actions */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-neutral-900">{model.modelId}</h1>
            <span className="text-lg text-neutral-400">{model.name}</span>
          </div>
          <div className="flex items-center gap-2 mb-6">
            <span className={`text-xs px-2 py-0.5 font-medium ${model.gender === 'female' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700'}`}>
              {model.gender === 'female' ? 'Woman' : 'Man'}
            </span>
            <span className={`text-xs px-2 py-0.5 font-medium ${model.active ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
              {model.active ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Description */}
          <div className="mb-8">
            <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Description</h2>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{model.description}</p>
          </div>

          {/* Actions */}
          <div className="space-y-3 mb-8">
            <Link
              href={`/jobs/new?modelId=${model.modelId}`}
              className="block w-fit bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
            >
              Create Job with {model.modelId}
            </Link>

            <button
              onClick={() => {
                setShowCloneForm(!showCloneForm);
                if (!showCloneForm) {
                  const prefix = model.modelId.replace(/\d+$/, '');
                  const num = parseInt(model.modelId.replace(/\D+/g, '') || '0') + 1;
                  setCloneId(`${prefix}${num}`);
                  setCloneName(`${model.name} variant`);
                  setCloneDescription(model.description);
                  setCloneGender(model.gender);
                  setCloneRegenerate(false);
                }
              }}
              className="block w-fit border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              Create Model From This
            </button>

            {/* Delete */}
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="block w-fit text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Delete Model
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Are you sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-red-600 text-white px-3 py-1 text-xs font-medium hover:bg-red-700 disabled:opacity-30"
                >
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Clone form — editable description */}
          {showCloneForm && (
            <div className="border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <p className="text-xs text-neutral-500">
                Edit the description below and save as a new model. Card image is copied unless you check &quot;Regenerate&quot;.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">New Model ID</label>
                  <input
                    type="text"
                    value={cloneId}
                    onChange={e => setCloneId(e.target.value.toUpperCase())}
                    placeholder="e.g., A4"
                    className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">New Name</label>
                  <input
                    type="text"
                    value={cloneName}
                    onChange={e => setCloneName(e.target.value)}
                    placeholder="e.g., Red Berry v2"
                    className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
                  />
                </div>
              </div>

              {/* Gender */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Gender</label>
                <div className="flex gap-2">
                  {(['female', 'male'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setCloneGender(g)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        cloneGender === g
                          ? 'bg-neutral-900 text-white'
                          : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      {g === 'female' ? 'Woman' : 'Man'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable description */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Description</label>
                <textarea
                  value={cloneDescription}
                  onChange={e => setCloneDescription(e.target.value)}
                  rows={8}
                  className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 resize-none"
                />
              </div>

              {/* Regenerate checkbox */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloneRegenerate}
                  onChange={e => setCloneRegenerate(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs text-neutral-600">Regenerate card image with new description (adds 30-60s)</span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleClone}
                  disabled={!cloneId || !cloneName || !cloneDescription || cloning}
                  className="bg-neutral-900 text-white px-5 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-30 transition-colors"
                >
                  {cloning ? (regenStatus || 'Saving...') : 'Save as New Model'}
                </button>
                <button
                  onClick={() => setShowCloneForm(false)}
                  className="border border-neutral-300 px-5 py-2 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {error && error !== 'not_found' && (
                <p className="text-xs text-red-600">{error}</p>
              )}
            </div>
          )}

          {/* ── Dressed Bases ── */}
          <div className="mt-8 border-t border-neutral-200 pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-neutral-900">Dressed Bases</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Pre-rendered reference images of this model in a specific outfit. Used automatically when generating jobs with matching wardrobe.</p>
              </div>
              <button
                onClick={() => setShowDressedPicker(!showDressedPicker)}
                className="text-xs px-4 py-2 bg-neutral-900 text-white font-medium hover:bg-neutral-800 transition-colors"
              >
                + Generate New
              </button>
            </div>

            {/* Wardrobe picker */}
            {showDressedPicker && (
              <div className="border border-neutral-200 bg-neutral-50 p-4 mb-4 space-y-4">
                <p className="text-xs text-neutral-500">Select wardrobe items for the dressed base. The model will be generated wearing these exact items.</p>

                {wardrobeLoading ? (
                  <p className="text-xs text-neutral-400">Loading wardrobe...</p>
                ) : allWardrobeItems.length === 0 ? (
                  <p className="text-xs text-neutral-400">No wardrobe items yet. <a href="/wardrobe" className="underline">Add to wardrobe</a> first.</p>
                ) : (
                  <>
                    {(['shoes', 'shirt', 'jacket', 'pants'] as const).map(cat => {
                      const modelGender = model?.gender || 'male';
                      const items = allWardrobeItems.filter(i =>
                        i.category === cat &&
                        !i.isPrimary && // Exclude focus garments — only show styling/accessory items
                        (i.gender === modelGender || i.gender === 'unisex' || !i.gender) // Match model gender or unisex
                      );
                      if (items.length === 0) return null;
                      const selectedId = selectedForDressed[cat] || '';
                      return (
                        <div key={cat}>
                          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                            {cat === 'shirt' ? 'Shirt / Top' : cat === 'jacket' ? 'Jacket / Outerwear' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                            {selectedId && <span className="text-neutral-900 ml-2 normal-case font-normal">✓ selected</span>}
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {items.map(item => {
                              const isSel = selectedId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => setSelectedForDressed(prev => ({
                                    ...prev,
                                    [cat]: isSel ? '' : item.id,
                                  }))}
                                  className={`border p-1.5 text-left transition-all w-20 ${isSel ? 'border-neutral-900 ring-1 ring-neutral-900 bg-white' : 'border-neutral-200 hover:border-neutral-400 bg-white'}`}
                                >
                                  <div className="aspect-square bg-neutral-100 mb-1 overflow-hidden relative">
                                    {item.thumbnailUrl
                                      ? <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                                      : <div className="w-full h-full flex items-center justify-center text-neutral-300 text-[10px]">?</div>
                                    }
                                  </div>
                                  <p className="text-[10px] text-neutral-700 truncate leading-tight">{item.name}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Per-view progress indicators */}
                {Object.keys(viewProgress).length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {VIEWS_ORDER.map(v => {
                      const vp = viewProgress[v];
                      if (!vp) return null;
                      let badge = '';
                      let cls = 'text-neutral-400';
                      if (vp.status === 'pending') { badge = '○'; cls = 'text-neutral-300'; }
                      else if (vp.status === 'generating') { badge = `⏳ ${vp.elapsed ?? 0}s`; cls = 'text-blue-600'; }
                      else if (vp.status === 'done') {
                        badge = '✓';
                        cls = 'text-green-600';
                      }
                      else if (vp.status === 'failed') { badge = '✗ failed'; cls = 'text-red-500'; }
                      return (
                        <span key={v} className={`text-xs font-medium ${cls}`}>
                          {VIEW_LABELS[v]} {badge}
                        </span>
                      );
                    })}
                  </div>
                )}

                {dressedStatus && <p className="text-xs text-neutral-600">{dressedStatus}</p>}

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleGenerateDressed}
                    disabled={!!generatingDressed || Object.values(selectedForDressed).filter(Boolean).length === 0}
                    className="px-5 py-2 bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 disabled:opacity-30 transition-colors"
                  >
                    {generatingDressed
                      ? `Generating ${VIEW_LABELS[generatingDressed]}…`
                      : 'Generate All 4 Views'}
                  </button>
                  <button
                    onClick={() => { setShowDressedPicker(false); setSelectedForDressed({}); setDressedStatus(''); setViewProgress({}); }}
                    disabled={!!generatingDressed}
                    className="px-5 py-2 border border-neutral-300 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Existing dressed bases — grouped by wardrobeHash as 2×2 grids */}
            {dressedBasesLoading ? (
              <p className="text-xs text-neutral-400">Loading...</p>
            ) : dressedBases.length === 0 ? (
              <p className="text-xs text-neutral-300 py-4">No dressed bases yet. Generate one above to improve wardrobe rendering quality.</p>
            ) : (() => {
              // Group by wardrobeHash
              const groups: Record<string, {
                views: Partial<Record<DressedView, DressedBase>>;
                wardrobeItemNames?: Record<string, string>;
                createdAt?: string;
              }> = {};
              for (const base of dressedBases) {
                const h = base.wardrobeHash;
                if (!groups[h]) groups[h] = { views: {}, wardrobeItemNames: base.wardrobeItemNames, createdAt: base.createdAt };
                const v = (base.view || 'front') as DressedView;
                groups[h].views[v] = base;
              }

              return (
                <div className="space-y-6">
                  {Object.entries(groups).map(([hash, group]) => (
                    <div key={hash}>
                      {/* Outfit label */}
                      {group.wardrobeItemNames && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {Object.entries(group.wardrobeItemNames).map(([cat, name]) => (
                            <span key={cat} className="text-[10px] text-neutral-500">
                              <span className="font-medium text-neutral-700">{cat}:</span> {name}
                            </span>
                          ))}
                          <span className="text-[9px] text-neutral-300 ml-auto">
                            {group.createdAt ? new Date(group.createdAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                      )}

                      {/* 2×2 grid: front+right top row, back+left bottom row */}
                      <div className="grid grid-cols-2 gap-2 w-fit">
                        {([['front', 'right'], ['back', 'left']] as DressedView[][]).map((row, ri) => (
                          <React.Fragment key={ri}>
                            {row.map(v => {
                              const base = group.views[v];
                              return (
                                <div key={v} className="border border-neutral-200 relative group w-[140px]">
                                  <div className="aspect-[3/4] bg-neutral-100 overflow-hidden">
                                    {base?.imageUrl
                                      ? <img
                                          src={base.imageUrl}
                                          alt={`${v} view`}
                                          className="w-full h-full object-cover object-top cursor-pointer"
                                          onClick={() => window.open(base.imageUrl, '_blank')}
                                          title="Click to open full resolution"
                                        />
                                      : <div className="w-full h-full flex flex-col items-center justify-center text-neutral-300 text-[10px] gap-2">
                                          <span>{VIEW_LABELS[v]}<br/>not generated</span>
                                          {isAdmin && (
                                            <button
                                              onClick={() => {
                                                // Find wardrobeItemIds from any existing view in this group
                                                const anyBase = Object.values(group.views)[0];
                                                if (anyBase?.wardrobeItemIds) handleRetryView(v, anyBase.wardrobeItemIds);
                                              }}
                                              disabled={retryingView === v}
                                              className="px-2 py-0.5 text-[9px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                                            >
                                              {retryingView === v ? 'Generating…' : '↻ Retry'}
                                            </button>
                                          )}
                                        </div>
                                    }
                                  </div>
                                  {base && (
                                    <div className="p-1.5">
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <p className="text-[10px] font-semibold text-neutral-800 uppercase tracking-wide">
                                          {VIEW_LABELS[v]}
                                        </p>
                                        {/* QC badge removed — dressed bases skip QC */}
                                      </div>

                                      {/* Delete — admin only */}
                                      {isAdmin && confirmDeleteBaseId !== base.id && (
                                        <button
                                          onClick={() => setConfirmDeleteBaseId(base.id)}
                                          className="text-[9px] text-neutral-300 hover:text-red-500 transition-colors hidden group-hover:block"
                                        >
                                          ✕ Delete
                                        </button>
                                      )}
                                      {isAdmin && confirmDeleteBaseId === base.id && (
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() => handleDeleteBase(base.id)}
                                            disabled={deletingBaseId === base.id}
                                            className="text-[9px] px-1.5 py-0.5 bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                                          >
                                            {deletingBaseId === base.id ? '…' : 'Del'}
                                          </button>
                                          <button
                                            onClick={() => setConfirmDeleteBaseId(null)}
                                            className="text-[9px] px-1.5 py-0.5 border border-neutral-300 text-neutral-500 hover:bg-neutral-50"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

    </Shell>
  );
}
