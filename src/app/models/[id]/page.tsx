'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { useSession } from 'next-auth/react';

interface CelebrityCheckData {
  timestamp?: string | { _seconds: number; _nanoseconds: number };
  status: 'pass' | 'review' | 'blocked' | 'error';
  facesDetected?: number;
  topMatch?: string | null;
  topScore?: number;
  flaggedMatches?: Array<{ name: string; score: number }>;
  modelVersion?: string;
  databaseVersion?: string;
  thresholds?: { review: number; block: number };
  durationMs?: number;
  note?: string;
  error?: string;
}

interface ModelData {
  id: string;
  modelId: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  active: boolean;
  createdAt?: string;
  celebrityCheck?: CelebrityCheckData;
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

  // Replace reference image
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Clone state
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneGender, setCloneGender] = useState<'male' | 'female'>('female');
  const [showCloneForm, setShowCloneForm] = useState(false);

  // Back view generation state
  const [generatingBack, setGeneratingBack] = useState(false);

  // Generate back view
  const handleGenerateBack = async () => {
    if (!model) return;
    setGeneratingBack(true);
    setError('');
    try {
      const res = await fetch('/api/models/generate-back', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: model.modelId || model.id }),
      });
      const data = await res.json();
      if (data.success && data.backUrl) {
        setModel({ ...model, backReferenceImageUrl: data.backUrl });
      } else {
        setError(data.error || 'Back view generation failed');
      }
    } catch {
      setError('Back view generation failed');
    } finally {
      setGeneratingBack(false);
    }
  };

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

  // Replace reference photo
  const handleReplacePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !model) return;

    if (!file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Image too large. Max 20MB.');
      return;
    }

    setUploading(true);
    setError('');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      try {
        const res = await fetch(`/api/models/${model.modelId || model.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceImageUrl: dataUrl }),
        });
        const data = await res.json();
        if (data.success) {
          // Update local state with new URL (GCS URL returned from server)
          setModel({ ...model, referenceImageUrl: data.referenceImageUrl || dataUrl });
        } else {
          setError('Upload failed');
        }
      } catch {
        setError('Upload error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
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

  // Clone model
  const handleClone = async () => {
    if (!cloneId || !cloneName || !model) return;
    setCloning(true);
    setError('');
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: cloneId.toUpperCase(),
          name: cloneName,
          description: cloneDescription,
          gender: cloneGender,
          referenceImageUrl: model.referenceImageUrl || model.cardImageUrl,
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
    }
  };

  // Zoom styles for 9:16 full-body reference photos
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
      <Link href="/models" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-6 inline-block">
        &larr; Back to portfolio
      </Link>

      <div className="flex gap-8">
        {/* Left — front + back reference images */}
        <div className="flex-shrink-0">
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

          {/* Front + Back side by side */}
          <div className="flex gap-3">
            {/* Front reference */}
            <div className="w-[220px]">
              <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Front</p>
              <div
                ref={imgContainerRef}
                className="aspect-[9/16] bg-neutral-100 border border-neutral-200 overflow-hidden relative cursor-pointer"
                onClick={() => {
                  const modes: Array<'full' | 'head' | 'torso'> = ['full', 'head', 'torso'];
                  const idx = modes.indexOf(zoomMode);
                  setZoomMode(modes[(idx + 1) % modes.length]);
                }}
              >
                {(model.referenceImageUrl || model.cardImageUrl) ? (
                  <img
                    src={(model.referenceImageUrl || model.cardImageUrl)!}
                    alt={`${model.modelId} — front`}
                    className="w-full h-full transition-transform duration-500 ease-out"
                    style={zoomStyles[zoomMode]}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">
                    No reference photo
                  </div>
                )}
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1">
                  {zoomMode === 'full' ? 'Click to zoom' : zoomMode === 'head' ? 'Head' : 'Torso'}
                </div>
              </div>
            </div>

            {/* Back reference */}
            <div className="w-[220px]">
              <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Back</p>
              <div className="aspect-[9/16] bg-neutral-100 border border-neutral-200 overflow-hidden relative">
                {model.backReferenceImageUrl ? (
                  <img
                    src={model.backReferenceImageUrl}
                    alt={`${model.modelId} — back`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-neutral-300 text-sm gap-3">
                    <span>No back view</span>
                    {isAdmin && (
                      <button
                        onClick={handleGenerateBack}
                        disabled={generatingBack}
                        className="border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-30"
                      >
                        {generatingBack ? 'Generating...' : 'Generate Back View'}
                      </button>
                    )}
                  </div>
                )}
                {model.backReferenceImageUrl && isAdmin && (
                  <button
                    onClick={handleGenerateBack}
                    disabled={generatingBack}
                    className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 hover:bg-black/80 transition-colors disabled:opacity-50"
                  >
                    {generatingBack ? 'Generating...' : 'Regenerate'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Replace Reference Photo (admin) */}
          {isAdmin && (
            <div className="mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleReplacePhoto}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-30"
              >
                {uploading ? 'Uploading...' : 'Replace Front Reference Photo'}
              </button>
            </div>
          )}
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

          {/* Celebrity Resemblance Audit */}
          {model.celebrityCheck ? (
            <div className={`mb-6 border px-4 py-3 ${
              model.celebrityCheck.status === 'pass' ? 'border-green-200 bg-green-50' :
              model.celebrityCheck.status === 'review' ? 'border-orange-200 bg-orange-50' :
              model.celebrityCheck.status === 'blocked' ? 'border-red-200 bg-red-50' :
              'border-neutral-200 bg-neutral-50'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-semibold ${
                  model.celebrityCheck.status === 'pass' ? 'text-green-700' :
                  model.celebrityCheck.status === 'review' ? 'text-orange-700' :
                  model.celebrityCheck.status === 'blocked' ? 'text-red-700' :
                  'text-neutral-600'
                }`}>
                  {model.celebrityCheck.status === 'pass' ? '\u2713 No celebrity resemblance' :
                   model.celebrityCheck.status === 'review' ? '\u26A0 Possible resemblance detected' :
                   model.celebrityCheck.status === 'blocked' ? '\u2717 Celebrity resemblance blocked' :
                   '\u26A0 Check error'}
                </span>
              </div>
              {model.celebrityCheck.topMatch && model.celebrityCheck.topScore !== undefined && (
                <p className="text-xs text-neutral-600 mb-1">
                  Closest match: <span className="font-medium">{model.celebrityCheck.topMatch}</span> ({(model.celebrityCheck.topScore * 100).toFixed(1)}% similarity)
                </p>
              )}
              {model.celebrityCheck.flaggedMatches && model.celebrityCheck.flaggedMatches.length > 1 && (
                <details className="text-xs text-neutral-500 mt-1">
                  <summary className="cursor-pointer hover:text-neutral-700">
                    {model.celebrityCheck.flaggedMatches.length} matches above threshold
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {model.celebrityCheck.flaggedMatches.map((m, i) => (
                      <li key={i}>{m.name} — {(m.score * 100).toFixed(1)}%</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="text-[10px] text-neutral-400 mt-2">
                {model.celebrityCheck.timestamp
                  ? new Date(
                      typeof model.celebrityCheck.timestamp === 'object' && '_seconds' in model.celebrityCheck.timestamp
                        ? model.celebrityCheck.timestamp._seconds * 1000
                        : model.celebrityCheck.timestamp
                    ).toLocaleString()
                  : ''} · {model.celebrityCheck.modelVersion} · DB {model.celebrityCheck.databaseVersion}
                {model.celebrityCheck.durationMs ? ` · ${model.celebrityCheck.durationMs}ms` : ''}
              </p>
              {model.celebrityCheck.note === 'no_face_detected' && (
                <p className="text-[10px] text-neutral-400">No face detected in reference image</p>
              )}
              {model.celebrityCheck.error && (
                <p className="text-[10px] text-red-400 mt-1">Error: {model.celebrityCheck.error}</p>
              )}
            </div>
          ) : (
            <div className="mb-6 border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border border-neutral-300 border-t-neutral-600 rounded-full animate-spin" />
                <span className="text-xs text-neutral-500">Celebrity resemblance check pending...</span>
              </div>
            </div>
          )}

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
                }
              }}
              className="block w-fit border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              Create Model From This
            </button>

            {/* Delete */}
            {isAdmin && (
              !confirmDelete ? (
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
              )
            )}
          </div>

          {/* Clone form */}
          {showCloneForm && (
            <div className="border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <p className="text-xs text-neutral-500">
                Create a new model using this one&apos;s reference photo. You can replace the photo later.
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

              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Description</label>
                <textarea
                  value={cloneDescription}
                  onChange={e => setCloneDescription(e.target.value)}
                  rows={4}
                  className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleClone}
                  disabled={!cloneId || !cloneName || cloning}
                  className="bg-neutral-900 text-white px-5 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-30 transition-colors"
                >
                  {cloning ? 'Saving...' : 'Save as New Model'}
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
        </div>
      </div>
    </Shell>
  );
}
