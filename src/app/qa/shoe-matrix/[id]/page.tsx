'use client';

/**
 * Tier-2 cell detail page — shows all 4 4K views of a (shoe × model)
 * combination, with lightbox-zoom-native on click. Same pattern as
 * /models/[id] for visual consistency.
 *
 * Route: /qa/shoe-matrix/{shoeId}_{modelId}
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';

type ViewKey = 'fullBodyFront' | 'fullBodyBack' | 'legsFront' | 'legsBack';

const VIEW_LABELS: Record<ViewKey, string> = {
  fullBodyFront: 'Full body — front',
  fullBodyBack: 'Full body — back',
  legsFront: 'Legs — front (M01)',
  legsBack: 'Legs — back (M02)',
};

const VIEWS: ViewKey[] = ['fullBodyFront', 'fullBodyBack', 'legsFront', 'legsBack'];

interface CellPayload {
  id: string;
  shoeId: string;
  modelId: string;
  images?: Partial<Record<ViewKey, string>>;
  thumbs?: Partial<Record<ViewKey, string>>;
  viewsCompleted?: ViewKey[];
  imageUrl?: string;     // legacy
  status: string;
  blocked: boolean;
  blockedReason?: string;
  errorMessage?: string;
  shoeName?: string;
  shoeFlatUrl?: string;
  modelName?: string;
  modelCardUrl?: string;
}

export default function CellDetailPage() {
  const params = useParams<{ id: string }>();
  const cellId = params?.id;
  const [cell, setCell] = useState<CellPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxView, setLightboxView] = useState<ViewKey | null>(null);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const lightboxScrollRef = useRef<HTMLDivElement | null>(null);

  const fetchCell = useCallback(async () => {
    if (!cellId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/qa/shoe-matrix/${encodeURIComponent(cellId)}`);
      if (!res.ok) { setCell(null); return; }
      setCell(await res.json());
    } finally {
      setLoading(false);
    }
  }, [cellId]);

  useEffect(() => { fetchCell(); }, [fetchCell]);

  // Esc behavior: first un-zooms, second closes lightbox.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (lightboxZoomed) setLightboxZoomed(false);
      else setLightboxView(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxZoomed]);

  function openLightbox(view: ViewKey) {
    setLightboxView(view);
    setLightboxZoomed(false);
  }

  function onLightboxImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (lightboxZoomed) {
      setLightboxZoomed(false);
      return;
    }
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setLightboxZoomed(true);
    requestAnimationFrame(() => {
      const c = lightboxScrollRef.current;
      if (!c) return;
      c.scrollLeft = xRatio * c.scrollWidth - c.clientWidth / 2;
      c.scrollTop = yRatio * c.scrollHeight - c.clientHeight / 2;
    });
  }

  return (
    <Shell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-4">
          <a href="/qa/shoe-matrix" className="text-sm text-neutral-500 hover:text-neutral-900">← Back to matrix</a>
        </div>
        {loading && <div className="text-neutral-500">Loading…</div>}
        {!loading && !cell && <div className="text-neutral-500">Cell not found.</div>}
        {cell && (
          <>
            <header className="flex items-center gap-4 mb-6">
              {cell.shoeFlatUrl && (
                <img src={cell.shoeFlatUrl} alt="" className="w-20 h-20 object-contain bg-neutral-50 border border-neutral-200" />
              )}
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-neutral-900">
                  {cell.shoeName || cell.shoeId} × {cell.modelName || cell.modelId}
                </h1>
                <p className="text-sm text-neutral-500 mt-1">
                  Status: <span className={`font-medium ${cell.status === 'done' ? 'text-emerald-700' : cell.status === 'failed' ? 'text-red-700' : 'text-amber-700'}`}>{cell.status}</span>
                  {cell.viewsCompleted && (
                    <span className="ml-3">{cell.viewsCompleted.length}/4 views</span>
                  )}
                  {cell.blocked && (
                    <span className="ml-3 text-red-700">BLOCKED{cell.blockedReason ? ` — ${cell.blockedReason}` : ''}</span>
                  )}
                </p>
                {cell.errorMessage && (
                  <p className="text-xs text-red-700 mt-1">{cell.errorMessage}</p>
                )}
              </div>
              {cell.modelCardUrl && (
                <img src={cell.modelCardUrl} alt="" className="w-20 h-20 object-cover rounded-full border-2 border-white shadow" />
              )}
            </header>

            {/* 4-view grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {VIEWS.map(view => {
                const thumbUrl = cell.thumbs?.[view];
                const fullUrl = cell.images?.[view];
                const legacyUrl = !thumbUrl && !fullUrl ? cell.imageUrl : undefined;
                const showImg = thumbUrl || fullUrl || legacyUrl;
                return (
                  <div key={view} className="space-y-2">
                    <div
                      className="aspect-square bg-neutral-100 border border-neutral-200 rounded overflow-hidden cursor-zoom-in"
                      onClick={() => fullUrl && openLightbox(view)}
                    >
                      {showImg ? (
                        <img src={showImg} alt={view} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-400 text-sm">not rendered</div>
                      )}
                    </div>
                    <div className="text-xs text-neutral-600 font-medium">{VIEW_LABELS[view]}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightboxView && cell?.images?.[lightboxView] && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center cursor-zoom-out"
          onClick={() => { setLightboxView(null); setLightboxZoomed(false); }}
        >
          <button
            className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded"
            onClick={(e) => { e.stopPropagation(); setLightboxView(null); setLightboxZoomed(false); }}
          >
            Close (Esc)
          </button>
          <div className="absolute top-4 left-4 z-10 bg-white/10 text-white text-xs px-3 py-1.5 rounded">
            {VIEW_LABELS[lightboxView]} — {lightboxZoomed ? '4K native (click to fit)' : 'click to zoom 4K'}
          </div>
          {lightboxZoomed ? (
            <div
              ref={lightboxScrollRef}
              className="w-full h-full overflow-auto"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={cell.images[lightboxView]!}
                alt=""
                className="cursor-zoom-out block"
                style={{ width: '4096px', height: '4096px', maxWidth: 'none' }}
                onClick={onLightboxImageClick}
              />
            </div>
          ) : (
            <img
              src={cell.images[lightboxView]!}
              alt=""
              className="max-w-[95vw] max-h-[95vh] object-contain cursor-zoom-in"
              onClick={(e) => { e.stopPropagation(); onLightboxImageClick(e); }}
            />
          )}
        </div>
      )}
    </Shell>
  );
}
