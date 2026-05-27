'use client';

/**
 * Step 4 — pick the model + review the full job summary before Run.
 *
 * Models are gender-filtered by the focus item (per Bruno's flow:
 * focus drives gender; the model picker just narrows to matching).
 * Defaults to focus gender; user can flip to 'all' to see everyone.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { formatDrop } from '@/lib/v2/wardrobe-classification';
import type { CollectionPick, ModelRef, SlotKey, WardrobeItemRef } from './wizard-types';
import { slotLabel } from './wizard-types';

export interface ModelPickerStepProps {
  collection: CollectionPick;
  focus: WardrobeItemRef;
  styling: Partial<Record<SlotKey, WardrobeItemRef>>;
  value: ModelRef | null;
  onChange: (model: ModelRef) => void;
}

interface ModelsResponse {
  models?: any[];
  items?: any[];
}

export default function ModelPickerStep({ collection, focus, styling, value, onChange }: ModelPickerStepProps) {
  const focusGender = (focus.gender || '').toLowerCase();
  const [genderFilter, setGenderFilter] = useState<'all' | string>(focusGender || 'all');
  const [models, setModels] = useState<ModelRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/models')
      .then(r => r.json())
      .then((j: ModelsResponse | any[]) => {
        if (cancelled) return;
        const raw = Array.isArray(j) ? j : (j.models || j.items || []);
        setModels(raw.map((m: any) => ({
          modelId: m.modelId || m.id,
          name: m.name,
          gender: m.gender,
          referenceImageUrl: m.referenceImageUrl || m.cardImageUrl,
        })).filter((m: ModelRef) => !!m.modelId));
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!models) return [];
    if (genderFilter === 'all') return models;
    return models.filter(m => (m.gender || '').toLowerCase() === genderFilter);
  }, [models, genderFilter]);

  const collectionLabel =
    collection.kind === 'drop'
      ? formatDrop({ year: collection.year, quarter: collection.quarter, dropNumber: collection.dropNumber })
      : 'NOOS';

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-neutral-200 rounded-lg p-5">
        <div className="text-[15px] font-medium text-neutral-900 mb-1">Pick the model</div>
        <div className="text-[12px] text-neutral-500 mb-4">
          {focusGender && genderFilter === focusGender
            ? <>Showing <span className="font-medium text-neutral-700">{focusGender}</span> models to match the focus garment.</>
            : 'Showing all models.'}
          {value && <> · selected <span className="font-medium text-neutral-700">{value.name}</span></>}
        </div>

        <div className="flex items-center gap-1.5 mb-4">
          {['all', 'male', 'female'].map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setGenderFilter(g)}
              className={`text-[11px] rounded-full px-2.5 py-1 transition-colors capitalize ${
                genderFilter === g
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {g === 'all' ? 'All' : g === 'male' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>

        {error && <div className="text-[12px] text-red-600">Failed to load models: {error}</div>}
        {!models && !error && <div className="text-[12px] text-neutral-400 py-8 text-center">Loading…</div>}
        {filtered.length === 0 && models && (
          <div className="text-[12px] text-neutral-500 py-6 text-center border border-dashed border-neutral-200 rounded-md">
            No models match this filter.
          </div>
        )}
        {filtered.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {filtered.map(m => (
              <button
                key={m.modelId}
                type="button"
                onClick={() => onChange(m)}
                className={`relative bg-white rounded-md p-2 text-center transition-colors ${
                  value?.modelId === m.modelId
                    ? 'border-2 border-[#378ADD]'
                    : 'border border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {value?.modelId === m.modelId && (
                  <span className="absolute top-1.5 right-1.5 z-10 bg-[#185FA5] text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px]">✓</span>
                )}
                <div className="relative aspect-[3/4] bg-neutral-100 rounded-sm overflow-hidden mb-1.5">
                  {m.referenceImageUrl ? (
                    <Image src={m.referenceImageUrl} alt={m.name} fill sizes="120px" className="object-cover object-top" loading="lazy" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400">no image</div>
                  )}
                </div>
                <div className="text-[11px] font-medium text-neutral-900">{m.modelId}</div>
                <div className="text-[10px] text-neutral-500 truncate">{m.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Job summary</div>
        <dl className="text-[12px] grid grid-cols-[120px_1fr] gap-y-1 gap-x-4">
          <dt className="text-neutral-400">Collection</dt>
          <dd className="text-neutral-900">{collectionLabel}</dd>
          <dt className="text-neutral-400">Focus</dt>
          <dd className="text-neutral-900">{focus.name} <span className="text-neutral-400">· {focus.designNumber || ''}</span></dd>
          {(['top', 'bottom', 'shoe'] as SlotKey[]).map(slot => {
            const s = styling[slot];
            if (!s || s.wardrobeId === focus.wardrobeId) return null;
            return (
              <span key={slot} className="contents">
                <dt className="text-neutral-400">{slotLabel(slot)}</dt>
                <dd className="text-neutral-900">{s.name}</dd>
              </span>
            );
          })}
          <dt className="text-neutral-400">Model</dt>
          <dd className="text-neutral-900">{value ? `${value.modelId} · ${value.name}` : <span className="text-neutral-400 italic">not picked</span>}</dd>
        </dl>
      </div>
    </div>
  );
}
