'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Shell from '@/components/Shell';

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

interface Model {
  id: string;
  modelId: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  referenceImageUrl?: string;
  cardImageUrl?: string;
  backReferenceImageUrl?: string;
  active: boolean;
  celebrityCheck?: CelebrityCheckData;
}

export default function ModelsPage() {
  const { data: session } = useSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'creator' }
    : { email: '', name: '', role: 'creator' as const };
  const isAdmin = user.role === 'admin';

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline editing state (admin only)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<'name' | 'modelId' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Modal state
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [zoomMode, setZoomMode] = useState<'full' | 'head' | 'torso'>('full');
  const [generatingBack, setGeneratingBack] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneGender, setCloneGender] = useState<'male' | 'female'>('female');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          setModels(data.models || []);
        }
      } catch (e) {
        console.error('Failed to fetch models:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchModels();
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId, editField]);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedModel) closeModal();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedModel]);

  const startEdit = (model: Model, field: 'name' | 'modelId') => {
    if (!isAdmin) return;
    setEditingId((model.modelId || model.id).trim());
    setEditField(field);
    setEditValue(field === 'name' ? model.name : model.modelId);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditField(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingId || !editField || !editValue.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/models/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [editField]: editValue.trim() }),
      });
      if (res.ok) {
        setModels(prev => prev.map(m => {
          const mid = (m.modelId || m.id).trim();
          if (mid === editingId) {
            return { ...m, [editField!]: editValue.trim() };
          }
          return m;
        }));
      }
    } catch (e) {
      console.error('Failed to save:', e);
    } finally {
      setSaving(false);
      cancelEdit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  // --- Modal handlers ---
  const openModal = useCallback(async (model: Model) => {
    setSelectedModel(model);
    setModalLoading(true);
    setModalError('');
    setZoomMode('full');
    setShowCloneForm(false);
    setConfirmDelete(false);
    try {
      const mid = (model.modelId || model.id).trim();
      const res = await fetch(`/api/models/${mid}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedModel(data.model);
      }
    } catch {
      setModalError('Failed to load details');
    } finally {
      setModalLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setSelectedModel(null);
    setModalError('');
    setShowCloneForm(false);
    setConfirmDelete(false);
    setGeneratingBack(false);
  }, []);

  const handleGenerateBack = async () => {
    if (!selectedModel) return;
    setGeneratingBack(true);
    setModalError('');
    try {
      const res = await fetch('/api/models/generate-back', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.modelId || selectedModel.id }),
      });
      const data = await res.json();
      if (data.success && data.backUrl) {
        const updated = { ...selectedModel, backReferenceImageUrl: data.backUrl };
        setSelectedModel(updated);
        setModels(prev => prev.map(m => (m.modelId || m.id) === (selectedModel.modelId || selectedModel.id) ? { ...m, backReferenceImageUrl: data.backUrl } : m));
      } else {
        setModalError(data.error || 'Back view generation failed');
      }
    } catch {
      setModalError('Back view generation failed');
    } finally {
      setGeneratingBack(false);
    }
  };

  const handleReplacePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedModel) return;
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) return;
    setUploading(true);
    setModalError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      try {
        const mid = (selectedModel.modelId || selectedModel.id).trim();
        const res = await fetch(`/api/models/${mid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceImageUrl: dataUrl }),
        });
        const data = await res.json();
        if (data.success) {
          const newUrl = data.referenceImageUrl || dataUrl;
          setSelectedModel({ ...selectedModel, referenceImageUrl: newUrl });
          setModels(prev => prev.map(m => (m.modelId || m.id) === (selectedModel.modelId || selectedModel.id) ? { ...m, referenceImageUrl: newUrl } : m));
        } else {
          setModalError('Upload failed');
        }
      } catch {
        setModalError('Upload error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    if (!selectedModel) return;
    setDeleting(true);
    try {
      const mid = (selectedModel.modelId || selectedModel.id).trim();
      const res = await fetch(`/api/models/${mid}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setModels(prev => prev.filter(m => (m.modelId || m.id) !== (selectedModel.modelId || selectedModel.id)));
        closeModal();
      } else {
        setModalError(data.error || 'Delete failed');
      }
    } catch {
      setModalError('Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleClone = async () => {
    if (!cloneId || !cloneName || !selectedModel) return;
    setCloning(true);
    setModalError('');
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: cloneId.toUpperCase(),
          name: cloneName,
          description: cloneDescription,
          gender: cloneGender,
          referenceImageUrl: selectedModel.referenceImageUrl || selectedModel.cardImageUrl,
          createdBy: user.email,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh models list
        const listRes = await fetch('/api/models');
        if (listRes.ok) {
          const listData = await listRes.json();
          setModels(listData.models || []);
        }
        setShowCloneForm(false);
      } else {
        setModalError(data.error || 'Clone failed');
      }
    } catch {
      setModalError('Clone failed');
    } finally {
      setCloning(false);
    }
  };

  const zoomStyles: Record<string, React.CSSProperties> = {
    full: { objectFit: 'contain' as const, objectPosition: 'center', transform: 'scale(1)' },
    head: { objectFit: 'cover' as const, objectPosition: 'top center', transform: 'scale(2.5)', transformOrigin: '50% 6%' },
    torso: { objectFit: 'cover' as const, objectPosition: 'center', transform: 'scale(2)', transformOrigin: '50% 28%' },
  };

  const women = models.filter(m => m.gender === 'female');
  const men = models.filter(m => m.gender === 'male');

  return (
    <Shell user={user}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Model Portfolio</h1>
          <p className="text-sm text-neutral-500 mt-1">{models.length} models available</p>
        </div>
        {isAdmin && (
          <Link
            href="/models/new"
            className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            Create Model
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {[
            { label: 'Women', data: women },
            { label: 'Men', data: men },
          ].map(section => section.data.length > 0 && (
            <div key={section.label} className="mb-10">
              <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wider mb-4">
                {section.label}
              </h2>
              <div className="grid grid-cols-5 gap-4">
                {section.data.map(model => {
                  const mid = (model.modelId || model.id).trim();
                  const isEditingThis = editingId === mid;

                  return (
                    <div
                      key={mid}
                      className="group border border-neutral-200 bg-white hover:border-neutral-400 transition-colors"
                    >
                      <div
                        className="aspect-[3/4] bg-neutral-100 relative overflow-hidden cursor-pointer"
                        onClick={() => openModal(model)}
                      >
                        {(model.referenceImageUrl || model.cardImageUrl) ? (
                          <img
                            src={(model.referenceImageUrl || model.cardImageUrl)!}
                            alt={`${model.modelId} — ${model.name}`}
                            className="w-full h-full object-cover object-top"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-300 text-lg">
                            {model.modelId}
                          </div>
                        )}
                        {!model.active && (
                          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                            <span className="text-xs text-neutral-500 uppercase">Inactive</span>
                          </div>
                        )}
                      </div>

                      <div className="p-3">
                        <div className="flex items-center justify-between gap-1">
                          {isEditingThis && editField === 'modelId' ? (
                            <input
                              ref={inputRef}
                              type="text"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onBlur={saveEdit}
                              disabled={saving}
                              className="text-sm font-medium text-neutral-900 border border-neutral-300 px-1 py-0 w-16 outline-none focus:border-neutral-900"
                            />
                          ) : (
                            <span
                              className={`text-sm font-medium text-neutral-900 ${isAdmin ? 'cursor-pointer hover:bg-neutral-100 px-1 -mx-1' : ''}`}
                              onClick={e => { if (isAdmin) { e.preventDefault(); startEdit(model, 'modelId'); } }}
                            >
                              {model.modelId}
                            </span>
                          )}

                          {isEditingThis && editField === 'name' ? (
                            <input
                              ref={inputRef}
                              type="text"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onBlur={saveEdit}
                              disabled={saving}
                              className="text-xs text-neutral-600 border border-neutral-300 px-1 py-0 w-20 outline-none focus:border-neutral-900 text-right"
                            />
                          ) : (
                            <span
                              className={`text-xs text-neutral-400 ${isAdmin ? 'cursor-pointer hover:bg-neutral-100 px-1 -mx-1' : ''}`}
                              onClick={e => { if (isAdmin) { e.preventDefault(); startEdit(model, 'name'); } }}
                            >
                              {model.name}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs text-neutral-500 mt-1 line-clamp-2 cursor-pointer"
                          onClick={() => openModal(model)}
                        >
                          {model.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ======= FULLSCREEN MODAL ======= */}
      {selectedModel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal panel */}
          <div className="relative bg-white w-[90vw] max-w-[1100px] max-h-[90vh] overflow-y-auto shadow-2xl" style={{ zIndex: 51 }}>
            {/* Close button */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors text-lg font-light"
            >
              &times;
            </button>

            {modalLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex gap-8 p-8">
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
                    <div className="w-[200px]">
                      <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Front</p>
                      <div
                        className="aspect-[9/16] bg-neutral-100 border border-neutral-200 overflow-hidden relative cursor-pointer"
                        onClick={() => {
                          const modes: Array<'full' | 'head' | 'torso'> = ['full', 'head', 'torso'];
                          const idx = modes.indexOf(zoomMode);
                          setZoomMode(modes[(idx + 1) % modes.length]);
                        }}
                      >
                        {(selectedModel.referenceImageUrl || selectedModel.cardImageUrl) ? (
                          <img
                            src={(selectedModel.referenceImageUrl || selectedModel.cardImageUrl)!}
                            alt={`${selectedModel.modelId} — front`}
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
                    <div className="w-[200px]">
                      <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Back</p>
                      <div className="aspect-[9/16] bg-neutral-100 border border-neutral-200 overflow-hidden relative">
                        {selectedModel.backReferenceImageUrl ? (
                          <img
                            src={selectedModel.backReferenceImageUrl}
                            alt={`${selectedModel.modelId} — back`}
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
                        {selectedModel.backReferenceImageUrl && isAdmin && (
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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-3xl font-bold text-neutral-900">{selectedModel.modelId}</h2>
                    <span className="text-lg text-neutral-400">{selectedModel.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-6">
                    <span className={`text-xs px-2 py-0.5 font-medium ${selectedModel.gender === 'female' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700'}`}>
                      {selectedModel.gender === 'female' ? 'Woman' : 'Man'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 font-medium ${selectedModel.active ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                      {selectedModel.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Celebrity Resemblance Audit */}
                  {selectedModel.celebrityCheck ? (
                    <div className={`mb-6 border px-4 py-3 ${
                      selectedModel.celebrityCheck.status === 'pass' ? 'border-green-200 bg-green-50' :
                      selectedModel.celebrityCheck.status === 'review' ? 'border-orange-200 bg-orange-50' :
                      selectedModel.celebrityCheck.status === 'blocked' ? 'border-red-200 bg-red-50' :
                      'border-neutral-200 bg-neutral-50'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-semibold ${
                          selectedModel.celebrityCheck.status === 'pass' ? 'text-green-700' :
                          selectedModel.celebrityCheck.status === 'review' ? 'text-orange-700' :
                          selectedModel.celebrityCheck.status === 'blocked' ? 'text-red-700' :
                          'text-neutral-600'
                        }`}>
                          {selectedModel.celebrityCheck.status === 'pass' ? '\u2713 No celebrity resemblance' :
                           selectedModel.celebrityCheck.status === 'review' ? '\u26A0 Possible resemblance detected' :
                           selectedModel.celebrityCheck.status === 'blocked' ? '\u2717 Celebrity resemblance blocked' :
                           '\u26A0 Check error'}
                        </span>
                      </div>
                      {selectedModel.celebrityCheck.topMatch && selectedModel.celebrityCheck.topScore !== undefined && (
                        <p className="text-xs text-neutral-600 mb-1">
                          Closest match: <span className="font-medium">{selectedModel.celebrityCheck.topMatch}</span> ({(selectedModel.celebrityCheck.topScore * 100).toFixed(1)}% similarity)
                        </p>
                      )}
                      {selectedModel.celebrityCheck.flaggedMatches && selectedModel.celebrityCheck.flaggedMatches.length > 1 && (
                        <details className="text-xs text-neutral-500 mt-1">
                          <summary className="cursor-pointer hover:text-neutral-700">
                            {selectedModel.celebrityCheck.flaggedMatches.length} matches above threshold
                          </summary>
                          <ul className="mt-1 space-y-0.5 pl-3">
                            {selectedModel.celebrityCheck.flaggedMatches.map((m, i) => (
                              <li key={i}>{m.name} — {(m.score * 100).toFixed(1)}%</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <p className="text-[10px] text-neutral-400 mt-2">
                        {selectedModel.celebrityCheck.timestamp
                          ? new Date(
                              typeof selectedModel.celebrityCheck.timestamp === 'object' && '_seconds' in selectedModel.celebrityCheck.timestamp
                                ? selectedModel.celebrityCheck.timestamp._seconds * 1000
                                : selectedModel.celebrityCheck.timestamp
                            ).toLocaleString()
                          : ''} · {selectedModel.celebrityCheck.modelVersion} · DB {selectedModel.celebrityCheck.databaseVersion}
                        {selectedModel.celebrityCheck.durationMs ? ` · ${selectedModel.celebrityCheck.durationMs}ms` : ''}
                      </p>
                      {selectedModel.celebrityCheck.note === 'no_face_detected' && (
                        <p className="text-[10px] text-neutral-400">No face detected in reference image</p>
                      )}
                      {selectedModel.celebrityCheck.error && (
                        <p className="text-[10px] text-red-400 mt-1">Error: {selectedModel.celebrityCheck.error}</p>
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
                    <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Description</h3>
                    <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{selectedModel.description}</p>
                  </div>

                  {/* Actions */}
                  <div className="space-y-3 mb-8">
                    <Link
                      href={`/jobs/new?modelId=${selectedModel.modelId}`}
                      className="block w-fit bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
                    >
                      Create Job with {selectedModel.modelId}
                    </Link>

                    <button
                      onClick={() => {
                        setShowCloneForm(!showCloneForm);
                        if (!showCloneForm) {
                          const prefix = selectedModel.modelId.replace(/\d+$/, '');
                          const num = parseInt(selectedModel.modelId.replace(/\D+/g, '') || '0') + 1;
                          setCloneId(`${prefix}${num}`);
                          setCloneName(`${selectedModel.name} variant`);
                          setCloneDescription(selectedModel.description);
                          setCloneGender(selectedModel.gender);
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
                        Create a new model using this one&apos;s reference photo.
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
                    </div>
                  )}

                  {/* Errors */}
                  {modalError && (
                    <p className="text-xs text-red-600 mt-4">{modalError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
