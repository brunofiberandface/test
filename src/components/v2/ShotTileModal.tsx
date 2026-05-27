'use client';

/**
 * <ShotTileModal/> — overlay opened when a user clicks a shot tile.
 *
 * Renders enlarged shot + metadata + 4 actions (Open job · Mark winner ·
 * Rerun · Close). Wired with optimistic UI for the ★ winner toggle so
 * the parent feed updates instantly without a full reload.
 *
 * Parent is responsible for lifecycle: pass `open`, `onClose`, the shot
 * context (shotId, shotType, version, imageUrl, isWinner, design meta),
 * and an optional `onWinnerToggled(isWinner)` callback that the parent
 * uses to update its in-memory state.
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export interface ShotModalContext {
  shotId?: string;
  shotType: string;
  imageUrl?: string;
  version?: number;
  totalVersions?: number;
  isWinner?: boolean;
  jobId: string;
  designNumber?: string;
  designName?: string;
  modelName?: string;
  status?: string;
}

export default function ShotTileModal({
  context,
  onClose,
  onWinnerToggled,
}: {
  context: ShotModalContext | null;
  onClose: () => void;
  onWinnerToggled?: (isWinner: boolean) => void;
}) {
  const [localWinner, setLocalWinner] = useState<boolean>(context?.isWinner === true);
  const [pending, setPending] = useState<null | 'winner' | 'rerun'>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync local winner state when context changes (e.g. opening a different tile).
  useEffect(() => {
    setLocalWinner(context?.isWinner === true);
    setError(null);
    setPending(null);
  }, [context?.shotId, context?.isWinner]);

  useEffect(() => {
    if (!context) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [context, onClose]);

  if (!context) return null;

  const toggleWinner = async () => {
    if (!context.shotId || pending) return;
    const next = !localWinner;
    setLocalWinner(next);
    setPending('winner');
    setError(null);
    try {
      const r = await fetch(`/api/shots/${context.shotId}/winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isWinner: next }),
      });
      if (!r.ok) throw new Error(`winner toggle responded ${r.status}`);
      onWinnerToggled?.(next);
    } catch (e) {
      setLocalWinner(!next);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const rerunShot = async () => {
    if (pending) return;
    setPending('rerun');
    setError(null);
    try {
      // Per-shot rerun isn't a single canonical endpoint today — the closest
      // generic one is the job-level rerun with seedream. Phase 1 hits that;
      // a true per-shot rerun is a Phase 2 ergonomics win.
      const r = await fetch(`/api/jobs/${context.jobId}/rerun-with-seedream`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`rerun responded ${r.status}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg border border-neutral-200 w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
          <div className="text-[12px] text-neutral-600">
            {context.shotType}
            {context.version ? ` · v${context.version}` : ''}
            {context.totalVersions ? ` of ${context.totalVersions}` : ''}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-900" aria-label="Close">
            ×
          </button>
        </div>

        <div className="relative aspect-[3/4] bg-neutral-100 max-h-[60vh]">
          {context.imageUrl ? (
            <Image src={context.imageUrl} alt={`${context.shotType} v${context.version || 1}`} fill sizes="(max-width: 768px) 100vw, 480px" className="object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">No image yet</div>
          )}
          {localWinner && (
            <span className="absolute bottom-2 left-2 bg-[#97C459] text-[#173404] text-[10px] font-medium px-2 py-0.5 rounded-sm">
              ★ WINNER
            </span>
          )}
        </div>

        <div className="px-4 py-3 text-[12px] text-neutral-600 flex flex-col gap-1">
          <div className="flex justify-between"><span className="text-neutral-400">Design</span><span className="font-medium text-neutral-900">{context.designNumber ? `${context.designNumber} · ${context.designName || ''}` : (context.designName || '—')}</span></div>
          <div className="flex justify-between"><span className="text-neutral-400">Model</span><span className="text-neutral-900">{context.modelName || '—'}</span></div>
          <div className="flex justify-between"><span className="text-neutral-400">Status</span><span className="text-neutral-900">{context.status || '—'}</span></div>
        </div>

        {error && (
          <div className="px-4 pb-2 text-[11px] text-red-600">Action failed: {error}</div>
        )}

        <div className="grid grid-cols-2 gap-1.5 px-4 pb-3">
          <Link
            href={`/v2/jobs/${context.jobId}`}
            className="bg-neutral-900 text-white text-center text-[12px] font-medium rounded-md py-2 hover:bg-neutral-800 transition-colors"
            onClick={onClose}
          >
            Open job
          </Link>
          <Link
            href={`/v2/jobs/${context.jobId}/shots/${context.shotType}`}
            className="bg-white border border-neutral-300 text-neutral-900 text-center text-[12px] rounded-md py-2 hover:bg-neutral-50 transition-colors"
            onClick={onClose}
          >
            Contact sheet
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-4 pb-4">
          <button
            type="button"
            onClick={toggleWinner}
            disabled={!context.shotId || pending === 'winner'}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] transition-colors ${
              localWinner
                ? 'bg-[#97C459] text-[#173404] hover:bg-[#a8d063]'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            } disabled:opacity-50`}
          >
            ★ {localWinner ? 'Unmark' : 'Mark winner'}
          </button>
          <button
            type="button"
            onClick={rerunShot}
            disabled={pending === 'rerun'}
            className="flex items-center justify-center gap-1.5 bg-neutral-100 text-neutral-700 rounded-md py-1.5 text-[12px] hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {pending === 'rerun' ? 'Queuing…' : '↻ Rerun job'}
          </button>
        </div>
      </div>
    </div>
  );
}
