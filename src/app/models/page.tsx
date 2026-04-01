'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Shell from '@/components/Shell';

interface Model {
  id: string;
  modelId: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  cardImageUrl: string;
  active: boolean;
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
        // Update local state
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
          {/* Gender sections */}
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
                      {/* Thumbnail — always links to detail page */}
                      <Link href={`/models/${mid}`}>
                        <div className="aspect-[3/4] bg-neutral-100 relative overflow-hidden cursor-pointer">
                          {model.cardImageUrl ? (
                            <img
                              src={model.cardImageUrl}
                              alt={`${model.modelId} — ${model.name}`}
                              className="w-full h-full object-cover"
                              style={{
                                objectPosition: 'top center',
                                transform: 'scale(1.8)',
                                transformOrigin: 'top center',
                              }}
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
                      </Link>

                      {/* Model info — editable for admins */}
                      <div className="p-3">
                        <div className="flex items-center justify-between gap-1">
                          {/* Model ID */}
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

                          {/* Name */}
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
                        <Link href={`/models/${mid}`}>
                          <p className="text-xs text-neutral-500 mt-1 line-clamp-2 cursor-pointer">{model.description}</p>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </Shell>
  );
}
