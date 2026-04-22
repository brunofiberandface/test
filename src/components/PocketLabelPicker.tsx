'use client';

/**
 * PocketLabelPicker — 4-corner warp picker for the woven Originals pocket label.
 *
 * Simplified version of LabelCornerPicker: no midpoints, no emboss preview,
 * no Gemini detection. Just 4 draggable corners over the shot image with the
 * woven label PNG warped via CSS matrix3d() for live preview.
 *
 * Flow:
 *   1. Load the shot image + woven label PNG
 *   2. User drags 4 corners to position the label next to the pocket
 *   3. Submit → POST /api/shots/:id/apply-pocket-label
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMatrix3dTransform, type Corners } from '@/lib/matrix3d';

type NormCorner = [number, number]; // [x, y] in [0, 1]

interface NormCorners {
  tl: NormCorner;
  tr: NormCorner;
  br: NormCorner;
  bl: NormCorner;
}

// Default position: small label near the right pocket area (M04/M02 typical position)
const DEFAULT_CORNERS: NormCorners = {
  tl: [0.38, 0.38],
  tr: [0.48, 0.38],
  br: [0.48, 0.43],
  bl: [0.38, 0.43],
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 12;

// Woven label natural dimensions (must match the PNG)
const LABEL_W = 1024;
const LABEL_H = 705;

type CornerKey = 'tl' | 'tr' | 'br' | 'bl';

type DragMode =
  | { kind: 'none' }
  | { kind: 'corner'; key: CornerKey }
  | { kind: 'body'; startMx: number; startMy: number; startCorners: NormCorners }
  | { kind: 'pan'; startMx: number; startMy: number; startPx: number; startPy: number };

interface Props {
  imageUrl: string;
  shotId: string;
  shotType: 'M02' | 'M04' | 'M05';
  onClose: () => void;
  onApplied: (result: { imageUrl: string; version: number }) => void;
}

export default function PocketLabelPicker({
  imageUrl,
  shotId,
  shotType,
  onClose,
  onApplied,
}: Props) {
  const [corners, setCorners] = useState<NormCorners>(DEFAULT_CORNERS);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelOpacity, setLabelOpacity] = useState(0.85);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragMode>({ kind: 'none' });
  const [imgNatW, setImgNatW] = useState(0);
  const [imgNatH, setImgNatH] = useState(0);

  // Track natural image size
  const onImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNatW(img.naturalWidth);
    setImgNatH(img.naturalHeight);
  }, []);

  // ── Coordinate helpers ──
  const mouseToNorm = useCallback(
    (mx: number, my: number): NormCorner => {
      const container = containerRef.current;
      if (!container || !imgNatW || !imgNatH) return [0, 0];
      const rect = container.getBoundingClientRect();
      // Container center
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      // Pixel on the displayed image
      const imgDisplayW = imgNatW * zoom;
      const imgDisplayH = imgNatH * zoom;
      const imgLeft = cx + pos.x - imgDisplayW / 2;
      const imgTop = cy + pos.y - imgDisplayH / 2;
      const px = mx - rect.left - imgLeft;
      const py = my - rect.top - imgTop;
      return [
        Math.max(0, Math.min(1, px / imgDisplayW)),
        Math.max(0, Math.min(1, py / imgDisplayH)),
      ];
    },
    [zoom, pos, imgNatW, imgNatH],
  );

  // ── CSS matrix3d for the woven label ──
  const matrix3d = useMemo(() => {
    if (!imgNatW || !imgNatH) return '';
    const dst: Corners = {
      tl: [corners.tl[0] * imgNatW * zoom, corners.tl[1] * imgNatH * zoom],
      tr: [corners.tr[0] * imgNatW * zoom, corners.tr[1] * imgNatH * zoom],
      br: [corners.br[0] * imgNatW * zoom, corners.br[1] * imgNatH * zoom],
      bl: [corners.bl[0] * imgNatW * zoom, corners.bl[1] * imgNatH * zoom],
    };
    return getMatrix3dTransform(LABEL_W, LABEL_H, dst) || '';
  }, [corners, imgNatW, imgNatH, zoom]);

  // ── Mouse handlers ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = mode;
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (d.kind === 'none') return;
      e.preventDefault();

      if (d.kind === 'corner') {
        const [nx, ny] = mouseToNorm(e.clientX, e.clientY);
        setCorners(prev => ({ ...prev, [d.key]: [nx, ny] as NormCorner }));
      } else if (d.kind === 'body') {
        const [nx, ny] = mouseToNorm(e.clientX, e.clientY);
        const [sx, sy] = mouseToNorm(d.startMx, d.startMy);
        const dx = nx - sx;
        const dy = ny - sy;
        setCorners({
          tl: [d.startCorners.tl[0] + dx, d.startCorners.tl[1] + dy],
          tr: [d.startCorners.tr[0] + dx, d.startCorners.tr[1] + dy],
          br: [d.startCorners.br[0] + dx, d.startCorners.br[1] + dy],
          bl: [d.startCorners.bl[0] + dx, d.startCorners.bl[1] + dy],
        });
      } else if (d.kind === 'pan') {
        setPos({
          x: d.startPx + (e.clientX - d.startMx),
          y: d.startPy + (e.clientY - d.startMy),
        });
      }
    },
    [mouseToNorm],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = { kind: 'none' };
  }, []);

  // Wheel zoom
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * delta)));
    },
    [],
  );

  // ── Submit ──
  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        pocketLabelCorners: {
          tl: [corners.tl[0], corners.tl[1]],
          tr: [corners.tr[0], corners.tr[1]],
          br: [corners.br[0], corners.br[1]],
          bl: [corners.bl[0], corners.bl[1]],
        },
      };
      const res = await fetch(`/api/shots/${shotId}/apply-pocket-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onApplied({ imageUrl: data.imageUrl, version: data.version });
    } catch (err: any) {
      setError(err.message || 'Failed to apply pocket label');
    } finally {
      setSubmitting(false);
    }
  }, [corners, shotId, onApplied]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Render ──
  const imgDisplayW = imgNatW * zoom;
  const imgDisplayH = imgNatH * zoom;

  // Corner handle positions in container-relative pixels
  const cornerPos = (key: CornerKey) => {
    if (!containerRef.current || !imgNatW) return { left: 0, top: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const imgLeft = cx + pos.x - imgDisplayW / 2;
    const imgTop = cy + pos.y - imgDisplayH / 2;
    return {
      left: imgLeft + corners[key][0] * imgDisplayW,
      top: imgTop + corners[key][1] * imgDisplayH,
    };
  };

  // Label overlay position (top-left of the bounding box of corners)
  const labelOverlayStyle = useMemo(() => {
    if (!containerRef.current || !imgNatW || !matrix3d) return { display: 'none' as const };
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const imgLeft = cx + pos.x - imgDisplayW / 2;
    const imgTop = cy + pos.y - imgDisplayH / 2;
    return {
      position: 'absolute' as const,
      left: imgLeft,
      top: imgTop,
      width: LABEL_W,
      height: LABEL_H,
      transform: matrix3d,
      transformOrigin: '0 0',
      opacity: labelOpacity,
      pointerEvents: 'none' as const,
    };
  }, [matrix3d, pos, imgDisplayW, imgDisplayH, imgNatW, labelOpacity]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-neutral-900 text-white shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-medium">Pocket Label — {shotType}</h2>
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <label>Opacity</label>
            <input
              type="range"
              min={0}
              max={100}
              value={labelOpacity * 100}
              onChange={e => setLabelOpacity(Number(e.target.value) / 100)}
              className="w-24"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-red-400 text-xs">{error}</span>}
          <button
            onClick={submit}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {submitting ? 'Applying…' : 'Apply pocket label'}
          </button>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-lg px-2"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-grab"
        onWheel={onWheel}
        onPointerDown={e => {
          if (dragRef.current.kind === 'none') {
            onPointerDown(e, {
              kind: 'pan',
              startMx: e.clientX,
              startMy: e.clientY,
              startPx: pos.x,
              startPy: pos.y,
            });
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Shot image */}
        <div
          className="absolute"
          style={{
            width: imgDisplayW,
            height: imgDisplayH,
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            onLoad={onImgLoad}
            draggable={false}
            className="w-full h-full"
            alt="shot"
          />
        </div>

        {/* Woven label overlay (CSS matrix3d warped) */}
        {matrix3d && (
          <img
            src="/originals-label-gold-woven.png"
            width={LABEL_W}
            height={LABEL_H}
            draggable={false}
            style={labelOverlayStyle}
            alt="pocket label"
          />
        )}

        {/* Label body drag area (invisible, between corners) */}
        {imgNatW > 0 && (
          <div
            className="absolute cursor-move"
            style={{
              left: cornerPos('tl').left,
              top: cornerPos('tl').top,
              width: cornerPos('tr').left - cornerPos('tl').left,
              height: cornerPos('bl').top - cornerPos('tl').top,
              zIndex: 10,
            }}
            onPointerDown={e => {
              e.stopPropagation();
              onPointerDown(e, {
                kind: 'body',
                startMx: e.clientX,
                startMy: e.clientY,
                startCorners: { ...corners },
              });
            }}
          />
        )}

        {/* Corner handles */}
        {imgNatW > 0 &&
          (['tl', 'tr', 'br', 'bl'] as CornerKey[]).map(key => {
            const p = cornerPos(key);
            return (
              <div
                key={key}
                className="absolute z-20 cursor-crosshair"
                style={{
                  left: p.left - 8,
                  top: p.top - 8,
                  width: 16,
                  height: 16,
                }}
                onPointerDown={e => {
                  e.stopPropagation();
                  onPointerDown(e, { kind: 'corner', key });
                }}
              >
                <div className="w-full h-full rounded-full bg-blue-500 border-2 border-white shadow-lg" />
              </div>
            );
          })}
      </div>

      {/* Footer hint */}
      <div className="px-6 py-2 bg-neutral-900 text-neutral-500 text-xs shrink-0">
        Drag corners to position • Drag label body to move • Scroll to zoom • ESC to cancel
      </div>
    </div>
  );
}
