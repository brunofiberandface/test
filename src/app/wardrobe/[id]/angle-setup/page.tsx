'use client';

/**
 * Wardrobe → Angle setup
 *
 * Audit/remap the v2 `fitModels` slot assignments for a single wardrobe item.
 *
 * Why this exists:
 *   Legacy (v1) wardrobe items store photos as a flat `fitModelUrls` array with no
 *   semantic labels. `normalizeWardrobeItem()` used to guess the mapping at read time
 *   (wardrobe-compat.ts), but the guess is frequently wrong (see D22889 case — 3 of 6
 *   slots mislabeled). This page lets you visually pick which photo goes in each of
 *   the 6 canonical slots and saves the result as a v2 `fitModels` map.
 *
 * After save:
 *   - `normalizeWardrobeItem()` sees `item.fitModels.front` and returns v2 directly,
 *     skipping the legacy-array guesswork.
 *   - `label-setup` anchor list sees `back / back45Left / back45Right` populated and
 *     no longer falls back to "Flat back" only.
 *   - `fitModelUrls` is left untouched, so any extra/unused photos stay available for
 *     re-mapping later.
 *
 * New items created via POST /api/wardrobe already write v2 directly (route.ts fix),
 * so this page is only for auditing legacy items or fixing a bad assignment.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { useSession } from 'next-auth/react';

type SlotKey =
  | 'front'
  | 'front45Left'
  | 'front45Right'
  | 'back'
  | 'back45Left'
  | 'back45Right';

interface Slot {
  key: SlotKey;
  label: string;
  row: 'front' | 'back';
}

const SLOTS: Slot[] = [
  { key: 'front45Left', label: '45° Left', row: 'front' },
  { key: 'front', label: 'Front', row: 'front' },
  { key: 'front45Right', label: '45° Right', row: 'front' },
  { key: 'back45Left', label: 'Back 45° Left', row: 'back' },
  { key: 'back', label: 'Back', row: 'back' },
  { key: 'back45Right', label: 'Back 45° Right', row: 'back' },
];

interface WardrobeItem {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category: string;
  description?: string;
  fitModels?: Partial<Record<SlotKey, string>>;
  fitModelUrls?: string[];
  flatFrontUrl?: string;
  flatBackUrl?: string;
  thumbnailUrl?: string;
}

/** Strip query params (?v=timestamp) so we compare canonical URLs when deduping. */
function cleanUrl(u: string): string {
  return (u || '').split('?')[0];
}

/** Build the photo pool: union of fitModels values + fitModelUrls, deduped by cleanUrl. */
function buildPool(item: WardrobeItem): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  const push = (u: string | undefined | null) => {
    if (!u) return;
    const k = cleanUrl(u);
    if (seen.has(k)) return;
    seen.add(k);
    pool.push(u);
  };
  // v2 first so keyed photos come in canonical order
  if (item.fitModels) {
    for (const s of SLOTS) push(item.fitModels[s.key]);
  }
  // Then the legacy array — extras (7th/8th photo, misordered v1 uploads) land here
  (item.fitModelUrls || []).forEach(push);
  return pool;
}

export default function AngleSetupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const wardrobeId = params?.id as string;
  const { data: sessionData } = useSession();
  const user = sessionData?.user as
    | { email?: string | null; name?: string | null; role?: 'creator' | 'admin' }
    | undefined;

  const [item, setItem] = useState<WardrobeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  /** assignments[slotKey] = cleanUrl of chosen photo (or '' for unset) */
  const [assignments, setAssignments] = useState<Record<SlotKey, string>>({
    front: '',
    front45Left: '',
    front45Right: '',
    back: '',
    back45Left: '',
    back45Right: '',
  });

  // ── Load item ──
  useEffect(() => {
    if (!wardrobeId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/wardrobe/${wardrobeId}`);
        if (!res.ok) throw new Error(`wardrobe ${res.status}`);
        const data = await res.json();
        const w: WardrobeItem = data.item || data;
        if (cancelled) return;
        setItem(w);
        // Pre-fill assignments from existing fitModels (v2) — NOT from the legacy
        // guess in wardrobe-compat.ts, because that guess is usually wrong and the
        // whole point of this page is to fix it.
        const next: Record<SlotKey, string> = {
          front: '',
          front45Left: '',
          front45Right: '',
          back: '',
          back45Left: '',
          back45Right: '',
        };
        if (w.fitModels) {
          for (const s of SLOTS) {
            const url = w.fitModels[s.key];
            if (url) next[s.key] = cleanUrl(url);
          }
        }
        setAssignments(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wardrobeId]);

  // ── Derived: photo pool + clean→full URL lookup ──
  const pool = useMemo(() => (item ? buildPool(item) : []), [item]);
  const cleanToFull = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of pool) m.set(cleanUrl(u), u);
    return m;
  }, [pool]);

  // ── Derived: which clean URLs are already used (for duplicate-pick warning) ──
  const usedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of Object.values(assignments)) {
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return counts;
  }, [assignments]);

  // ── Derived: unused photos (in pool but not assigned to any slot) ──
  const unusedPhotos = useMemo(() => {
    const used = new Set(Object.values(assignments).filter((v) => v));
    return pool.filter((u) => !used.has(cleanUrl(u)));
  }, [pool, assignments]);

  function setSlot(key: SlotKey, cleanUrlValue: string) {
    setAssignments((prev) => ({ ...prev, [key]: cleanUrlValue }));
    setSaveMsg(null);
  }

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Build v2 fitModels map: only include slots that have a chosen URL.
      // Slots left blank are sent as '' so the server-side merge keeps them cleared
      // (if they were previously set, the new empty value won't overwrite a truthy
      // value unless we explicitly want that — here we do NOT send '' so merge keeps
      // whatever was there).
      const fitModels: Partial<Record<SlotKey, string>> = {};
      for (const s of SLOTS) {
        const clean = assignments[s.key];
        if (!clean) continue;
        const full = cleanToFull.get(clean) || clean;
        fitModels[s.key] = full;
      }
      const res = await fetch(`/api/wardrobe/${wardrobeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitModels }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `save failed (${res.status})`);
      }
      setSaveMsg('Saved. Hard-refresh label-setup to see new anchors.');
      // Reload to confirm persisted state
      const refetch = await fetch(`/api/wardrobe/${wardrobeId}`);
      if (refetch.ok) {
        const d = await refetch.json();
        setItem(d.item || d);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const assignedCount = Object.values(assignments).filter((v) => v).length;
  const isComplete = assignedCount === 6;

  return (
    <Shell
      user={
        user
          ? {
              email: user.email || '',
              name: user.name || '',
              role: (user.role as 'creator' | 'admin') || 'creator',
            }
          : undefined
      }
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 text-sm text-neutral-500 mb-1">
              <Link href="/wardrobe" className="hover:text-neutral-900">
                ← Wardrobe
              </Link>
              <span>/</span>
              <span>Angle setup</span>
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">
              {item?.name || 'Loading…'}
            </h1>
            {item?.designNumber && (
              <p className="text-sm text-neutral-500 mt-1">{item.designNumber}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-500">
              {assignedCount}/6 slots
            </span>
            <button
              onClick={handleSave}
              disabled={saving || loading || pool.length === 0}
              className="px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:bg-neutral-300 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}
        {saveMsg && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 text-sm">
            {saveMsg}
          </div>
        )}

        {loading && (
          <div className="text-sm text-neutral-500">Loading wardrobe item…</div>
        )}

        {!loading && item && pool.length === 0 && (
          <div className="p-6 bg-yellow-50 border border-yellow-200 text-sm text-yellow-900">
            This item has no fit model photos in either{' '}
            <code>fitModels</code> or <code>fitModelUrls</code>. Upload photos
            from the main Wardrobe page first.
          </div>
        )}

        {!loading && item && pool.length > 0 && (
          <>
            {/* Slot grid — front row + back row */}
            {(['front', 'back'] as const).map((row) => (
              <div key={row} className="mb-8">
                <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                  {row === 'front' ? 'Front angles' : 'Back angles'}
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  {SLOTS.filter((s) => s.row === row).map((slot) => {
                    const current = assignments[slot.key];
                    const currentFull = current ? cleanToFull.get(current) : '';
                    const isDupe = current && (usedCounts.get(current) || 0) > 1;
                    return (
                      <div
                        key={slot.key}
                        className="border border-neutral-200 bg-white p-3"
                      >
                        <div className="text-xs font-medium text-neutral-900 mb-2">
                          {slot.label}
                        </div>
                        <div className="aspect-[3/4] bg-neutral-100 mb-2 flex items-center justify-center overflow-hidden">
                          {currentFull ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={currentFull}
                              alt={slot.label}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-neutral-400">
                              No photo
                            </span>
                          )}
                        </div>
                        <select
                          value={current}
                          onChange={(e) => setSlot(slot.key, e.target.value)}
                          className={`w-full border px-2 py-1 text-xs ${
                            isDupe
                              ? 'border-amber-400 bg-amber-50'
                              : 'border-neutral-300'
                          }`}
                        >
                          <option value="">— choose —</option>
                          {pool.map((u, i) => {
                            const clean = cleanUrl(u);
                            return (
                              <option key={clean} value={clean}>
                                Photo {i + 1}
                              </option>
                            );
                          })}
                        </select>
                        {isDupe && (
                          <div className="text-[11px] text-amber-700 mt-1">
                            Same photo used in another slot
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Photo pool reference — so user can see what they're choosing from */}
            <div className="mb-8">
              <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
                Photo pool ({pool.length} photos)
              </h2>
              <div className="grid grid-cols-6 gap-3">
                {pool.map((u, i) => {
                  const clean = cleanUrl(u);
                  const assignedTo = SLOTS.filter(
                    (s) => assignments[s.key] === clean,
                  )
                    .map((s) => s.label)
                    .join(', ');
                  return (
                    <div
                      key={clean}
                      className="border border-neutral-200 bg-white p-2"
                    >
                      <div className="aspect-[3/4] bg-neutral-100 mb-1 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={u}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-[11px] text-neutral-600 truncate">
                        Photo {i + 1}
                      </div>
                      {assignedTo && (
                        <div className="text-[10px] text-neutral-400 truncate">
                          → {assignedTo}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {unusedPhotos.length > 0 && (
                <p className="text-xs text-neutral-500 mt-3">
                  {unusedPhotos.length} photo
                  {unusedPhotos.length === 1 ? '' : 's'} unused — kept in the
                  legacy array for future remapping.
                </p>
              )}
            </div>

            {!isComplete && (
              <div className="p-3 bg-neutral-50 border border-neutral-200 text-sm text-neutral-600">
                Assign all 6 slots for a complete v2 mapping. Saving with fewer
                is allowed — unset slots stay empty.
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
