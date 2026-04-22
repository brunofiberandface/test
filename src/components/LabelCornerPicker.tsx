'use client';

/**
 * LabelCornerPicker — Photoshop-style free-transform picker for placing the
 * leather label on an M02/M04 shot.
 *
 * v4 flow (the one Bruno wanted):
 *   1. On open, fetch a pre-rendered RGBA leather-label PNG for the current
 *      shot's style+colorway from /api/label/preview (cached server-side).
 *   2. Overlay it on the shot. Semi-transparent so the user can see the
 *      brown label underneath and align to it exactly.
 *   3. The user drags:
 *        - the CENTER (body) of the label → moves the whole thing
 *        - any of the 4 corner handles → stretches/squeezes/warps that corner
 *      All updates recompute a CSS `matrix3d()` transform in real time, so
 *      what they see is what they'll get.
 *   4. "Warp label" → POST /api/shots/:id/apply-label with { labelCorners }
 *      (the 4 final corners) — existing v3 backend, no backend changes.
 *
 * Why this replaces the old 4-dot picker:
 *   Placing 4 abstract dots on a tiny label and hoping the composite lands
 *   right was a blind process. You couldn't tell until you hit Apply whether
 *   the label would cover the brown patch. Now it's literally visible — when
 *   it looks right, it IS right.
 *
 * Pan/zoom UX (same as old picker + Lightbox):
 *   - Wheel to zoom (0.5x – 12x), anchored at cursor
 *   - Drag background to pan
 *   - Drag label body / handles to warp
 *
 * Coordinates:
 *   We keep corners in normalized [0,1] space of the target image throughout
 *   — identical to the old picker — so the submit payload and the existing
 *   apply-label backend stay byte-identical.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMatrix3dTransform, type Corners } from '@/lib/matrix3d';

export type NormCorner = [number, number]; // [x, y] in [0, 1]

/**
 * NormCorners — 4 required corners + 4 optional midpoints.
 *
 * Midpoints (tm/rm/bm/lm) are OPTIONAL. When undefined, they auto-follow the
 * midpoint of their adjacent corner pair. When dragged by the user, they
 * become "custom" and decouple — the edge of the label then bends into a V
 * shape through the midpoint. Double-click a midpoint handle to release it
 * back to auto-follow.
 *
 * The 4 sub-quadrants are TL/TR/BR/BL relative to the centroid of the 4
 * corners, meeting at the centroid + midpoints. Each sub-quadrant is rendered
 * as an independent matrix3d-warped quarter of the preview PNG, so the label
 * visual splits into 4 sub-warps only when midpoints are dragged off centre.
 */
export interface NormCorners {
  tl: NormCorner;
  tr: NormCorner;
  br: NormCorner;
  bl: NormCorner;
  tm?: NormCorner; // top edge midpoint (optional — undefined = auto)
  rm?: NormCorner; // right edge midpoint
  bm?: NormCorner; // bottom edge midpoint
  lm?: NormCorner; // left edge midpoint
}

// Default label quad — a small label-sized rectangle roughly where a leather
// waistband label sits on a back-view full-body shot (wearer's right, above
// the back pocket). The user drags it into final position.
const DEFAULT_CORNERS: NormCorners = {
  tl: [0.305, 0.345],
  tr: [0.340, 0.345],
  br: [0.340, 0.370],
  bl: [0.305, 0.370],
};

type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
type MidKey = 'tm' | 'rm' | 'bm' | 'lm';

const CORNER_KEYS: CornerKey[] = ['tl', 'tr', 'br', 'bl'];
const MID_KEYS: MidKey[] = ['tm', 'rm', 'bm', 'lm'];
const HANDLE_LABEL: Record<CornerKey, string> = {
  tl: 'TL',
  tr: 'TR',
  br: 'BR',
  bl: 'BL',
};

/**
 * Resolve all 8 points + centroid for rendering. Missing midpoints are
 * computed as simple averages of their adjacent corners (auto-follow).
 */
function effectiveAll(c: NormCorners) {
  const tm: NormCorner = c.tm ?? [(c.tl[0] + c.tr[0]) / 2, (c.tl[1] + c.tr[1]) / 2];
  const rm: NormCorner = c.rm ?? [(c.tr[0] + c.br[0]) / 2, (c.tr[1] + c.br[1]) / 2];
  const bm: NormCorner = c.bm ?? [(c.br[0] + c.bl[0]) / 2, (c.br[1] + c.bl[1]) / 2];
  const lm: NormCorner = c.lm ?? [(c.bl[0] + c.tl[0]) / 2, (c.bl[1] + c.tl[1]) / 2];
  const center: NormCorner = [
    (c.tl[0] + c.tr[0] + c.br[0] + c.bl[0]) / 4,
    (c.tl[1] + c.tr[1] + c.br[1] + c.bl[1]) / 4,
  ];
  return { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl, tm, rm, bm, lm, center };
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 12;

// Preview rendering size — aspect ratio of the L2936 label template. The
// picker scales via CSS so the absolute values don't matter much, but
// bigger = better linear interpolation in the browser when stretched.
const PREVIEW_W = 512;
const PREVIEW_H = 340;

// Woven pocket label dimensions (must match the PNG)
const POCKET_LABEL_W = 1024;
const POCKET_LABEL_H = 705;

// Default pocket label quad — small, near right back pocket seam. ~50% of leather label size.
const DEFAULT_POCKET_CORNERS = {
  tl: [0.345, 0.405] as NormCorner,
  tr: [0.375, 0.405] as NormCorner,
  br: [0.375, 0.425] as NormCorner,
  bl: [0.345, 0.425] as NormCorner,
};

interface Props {
  imageUrl: string;
  shotId: string;
  shotType: 'M02' | 'M04';
  onClose: () => void;
  onApplied: (result: { imageUrl: string; version: number }) => void;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'corner'; key: CornerKey }
  | { kind: 'midpoint'; key: MidKey }
  | { kind: 'body'; startMx: number; startMy: number; startCorners: NormCorners }
  | { kind: 'pan'; startMx: number; startMy: number; startPx: number; startPy: number }
  | { kind: 'pocket-corner'; key: CornerKey }
  | { kind: 'pocket-body'; startMx: number; startMy: number; startCorners: { tl: NormCorner; tr: NormCorner; br: NormCorner; bl: NormCorner } };

export default function LabelCornerPicker({
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // 4 quarter canvases of the preview PNG (TL, TR, BR, BL), one per sub-quad.
  // Rendered once when previewUrl loads, reused across every drag.
  const [quarterUrls, setQuarterUrls] = useState<[string, string, string, string] | null>(null);
  const [detectStatus, setDetectStatus] = useState<
    'idle' | 'detecting' | 'gemini' | 'fallback'
  >('idle');

  // ── Pocket label state ──
  const [showPocketLabel, setShowPocketLabel] = useState(false);
  const [pocketCorners, setPocketCorners] = useState(DEFAULT_POCKET_CORNERS);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const modeRef = useRef<DragMode>({ kind: 'none' });
  const [, setModeTick] = useState(0);
  const setMode = (m: DragMode) => {
    modeRef.current = m;
    setModeTick((t) => t + 1);
  };

  // ── Fetch the rendered leather-label preview on open ──
  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);
    fetch(`/api/label/preview?shot=${encodeURIComponent(shotId)}&w=${PREVIEW_W}&h=${PREVIEW_H}`)
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          throw new Error(`preview ${res.status}: ${msg.slice(0, 160)}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        setPreviewUrl(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(String(err instanceof Error ? err.message : err));
      });
    return () => {
      cancelled = true;
    };
  }, [shotId]);

  // Release the blob URL when the component unmounts / preview changes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ── Pre-render 4 quarter canvases from the preview PNG ──
  // The label picker renders the preview as 4 sub-quads (one per quadrant
  // around the centroid). When no midpoints are dragged, the 4 sub-warps
  // compose seamlessly into the same visual as a single 4-point warp. When
  // a midpoint is dragged, the adjacent sub-quads bend to bulge the label
  // edge through the midpoint, giving V-shape curved edges.
  useEffect(() => {
    if (!previewUrl) {
      setQuarterUrls(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      if (!W || !H) return;
      const hw = Math.floor(W / 2);
      const hh = Math.floor(H / 2);
      // Cover the full source with 4 quarters even on odd dimensions.
      const rects: Array<[number, number, number, number]> = [
        [0, 0, hw, hh],              // TL
        [hw, 0, W - hw, hh],         // TR
        [hw, hh, W - hw, H - hh],    // BR
        [0, hh, hw, H - hh],         // BL
      ];
      const urls: string[] = [];
      for (const [sx, sy, sw, sh] of rects) {
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        urls.push(canvas.toDataURL('image/png'));
      }
      if (!cancelled && urls.length === 4) {
        setQuarterUrls([urls[0], urls[1], urls[2], urls[3]]);
      }
    };
    img.src = previewUrl;
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  // ── Auto-detect label corners via Gemini on open ──
  // Seeds the starting handle positions directly over the brown leather
  // patch so the user doesn't have to drag from the default hardcoded quad
  // all the way across the image. Falls back silently to DEFAULT_CORNERS
  // if detection fails or returns garbage — the picker still works, it's
  // just less convenient.
  useEffect(() => {
    let cancelled = false;
    setDetectStatus('detecting');
    fetch(`/api/shots/${encodeURIComponent(shotId)}/detect-label`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`detect ${res.status}`);
        return res.json();
      })
      .then((data: {
        ok?: boolean;
        corners?: NormCorners;
        source?: 'gemini' | 'fallback';
      }) => {
        if (cancelled) return;
        if (data.ok && data.corners) {
          setCorners(data.corners);
          setDetectStatus(data.source === 'gemini' ? 'gemini' : 'fallback');
        } else {
          setDetectStatus('fallback');
        }
      })
      .catch(() => {
        if (!cancelled) setDetectStatus('fallback');
      });
    return () => {
      cancelled = true;
    };
  }, [shotId]);

  // ── Close on Escape ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Reset pan/zoom on image change
  useEffect(() => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, [imageUrl]);

  // ── Wheel zoom anchored at cursor ──
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * delta));
      if (nextZoom === zoom) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ratio = nextZoom / zoom;
      setPos((p) => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }));
      setZoom(nextZoom);
    },
    [zoom],
  );

  // ── Pan background ──
  const onContainerPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setMode({
      kind: 'pan',
      startMx: e.clientX,
      startMy: e.clientY,
      startPx: pos.x,
      startPy: pos.y,
    });
  };

  // ── Corner-handle drag start ──
  const startCornerDrag =
    (key: CornerKey) => (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setMode({ kind: 'corner', key });
    };

  // ── Midpoint-handle drag start ──
  // First interaction with a midpoint "materializes" it — we seed the value
  // from the current auto-follow position so the handle doesn't jump when the
  // user starts dragging it.
  const startMidpointDrag =
    (key: MidKey) => (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setCorners((c) => {
        if (c[key]) return c;
        const eff = effectiveAll(c);
        return { ...c, [key]: eff[key] };
      });
      setMode({ kind: 'midpoint', key });
    };

  // ── Double-click midpoint → release to auto-follow ──
  const releaseMidpoint = (key: MidKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setCorners((c) => {
      if (!c[key]) return c;
      const next = { ...c };
      delete next[key];
      return next;
    });
  };

  // ── Body drag start (move whole label) ──
  const startBodyDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setMode({
      kind: 'body',
      startMx: e.clientX,
      startMy: e.clientY,
      startCorners: corners,
    });
  };

  // ── Unified pointer move ──
  const onContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const m = modeRef.current;
      if (m.kind === 'pan') {
        setPos({
          x: m.startPx + (e.clientX - m.startMx),
          y: m.startPy + (e.clientY - m.startMy),
        });
        return;
      }
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      if (m.kind === 'corner' || m.kind === 'midpoint') {
        // Delta from the current cursor position, expressed in normalized
        // image-space. The bounding-rect already reflects the pan/zoom
        // transform, so this math is zoom-independent.
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const clamped: NormCorner = [
          Math.max(0, Math.min(1, x)),
          Math.max(0, Math.min(1, y)),
        ];
        const key = m.key;
        setCorners((c) => ({ ...c, [key]: clamped }));
      } else if (m.kind === 'body') {
        // Translate every corner (and any custom midpoints) by the cursor
        // delta in normalized space.
        const dxNorm = (e.clientX - m.startMx) / rect.width;
        const dyNorm = (e.clientY - m.startMy) / rect.height;
        const shift = (p: NormCorner): NormCorner => [
          Math.max(0, Math.min(1, p[0] + dxNorm)),
          Math.max(0, Math.min(1, p[1] + dyNorm)),
        ];
        const sc = m.startCorners;
        const next: NormCorners = {
          tl: shift(sc.tl),
          tr: shift(sc.tr),
          br: shift(sc.br),
          bl: shift(sc.bl),
        };
        if (sc.tm) next.tm = shift(sc.tm);
        if (sc.rm) next.rm = shift(sc.rm);
        if (sc.bm) next.bm = shift(sc.bm);
        if (sc.lm) next.lm = shift(sc.lm);
        setCorners(next);
      } else if (m.kind === 'pocket-corner') {
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const clamped: NormCorner = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
        setPocketCorners((c) => ({ ...c, [m.key]: clamped }));
      } else if (m.kind === 'pocket-body') {
        const dxNorm = (e.clientX - m.startMx) / rect.width;
        const dyNorm = (e.clientY - m.startMy) / rect.height;
        const shift = (p: NormCorner): NormCorner => [
          Math.max(0, Math.min(1, p[0] + dxNorm)),
          Math.max(0, Math.min(1, p[1] + dyNorm)),
        ];
        const sc = m.startCorners;
        setPocketCorners({
          tl: shift(sc.tl),
          tr: shift(sc.tr),
          br: shift(sc.br),
          bl: shift(sc.bl),
        });
      }
    },
    [],
  );

  const onContainerPointerUp = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setMode({ kind: 'none' });
  }, []);

  // ── Zoom controls ──
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, z * 1.4));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, z / 1.4));
  const zoomReset = () => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  };
  const zoomFull = () => {
    setZoom(3);
    setPos({ x: 0, y: 0 });
  };

  const resetToDefault = () => {
    setCorners(DEFAULT_CORNERS);
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // v3 — send label corners directly. Same payload shape as before, plus
      // optional tm/rm/bm/lm midpoints if the user dragged any of them. The
      // backend parses midpoints as optional; when absent, the composite is
      // byte-identical to the pre-midpoint pipeline.
      const payload: NormCorners = {
        tl: corners.tl,
        tr: corners.tr,
        br: corners.br,
        bl: corners.bl,
      };
      if (corners.tm) payload.tm = corners.tm;
      if (corners.rm) payload.rm = corners.rm;
      if (corners.bm) payload.bm = corners.bm;
      if (corners.lm) payload.lm = corners.lm;
      const bodyPayload: Record<string, unknown> = { labelCorners: payload };
      if (showPocketLabel) {
        bodyPayload.pocketLabelCorners = {
          tl: pocketCorners.tl,
          tr: pocketCorners.tr,
          br: pocketCorners.br,
          bl: pocketCorners.bl,
        };
      }
      const res = await fetch(`/api/shots/${shotId}/apply-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || data?.details || `HTTP ${res.status}`);
      }
      onApplied({ imageUrl: data.imageUrl, version: data.version });
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Measure shot img via ResizeObserver ──
  // ResizeObserver reports the pre-transform content-box size, so we never
  // need to divide by zoom. This also fires reliably on image load / layout
  // changes, which was unreliable with getBoundingClientRect + onLoad timing
  // (the previous approach left imgBox out of sync on some code paths,
  // causing the preview and the handles to render in different coord spaces).
  const [imgBox, setImgBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!imgRef.current) return;
    const el = imgRef.current;
    // Seed from the current box (in case the image is already loaded)
    const seed = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) {
        setImgBox({ w: r.width / zoom, h: r.height / zoom });
      }
    };
    seed();
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // contentRect is in PRE-TRANSFORM layout pixels — exactly what we want
      const { width, height } = entry.contentRect;
      if (width && height) setImgBox({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
    // Intentionally only re-bind when the image URL changes; zoom doesn't
    // affect contentRect so we don't need to re-observe on zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // 4 sub-quadrant matrix3d transforms. Each sub-quad has:
  //   source: the corresponding quarter canvas (0..halfW, 0..halfH) in CSS px
  //   dest:   the sub-quadrant of the outer 8-point polygon in container px
  //
  // Sub-quadrants meet at the centroid and at the 4 midpoints. When the user
  // doesn't drag any midpoint, the midpoints are auto-follow (exact midpoints
  // of corner pairs) and the 4 sub-warps compose into a near-identical result
  // to a single 4-point perspective warp. When a midpoint is dragged, the
  // two adjacent sub-quads bend through the new midpoint, bulging the label
  // edge in a V shape — covers leather bits poking out at the edges.
  const subQuadTransforms = useMemo(() => {
    if (!imgBox.w || !imgBox.h) return null;
    const e = effectiveAll(corners);
    const W = imgBox.w;
    const H = imgBox.h;
    const hw = W / 2;
    const hh = H / 2;
    const px = (p: NormCorner): [number, number] => [p[0] * W, p[1] * H];
    const tlPx = px(e.tl);
    const trPx = px(e.tr);
    const brPx = px(e.br);
    const blPx = px(e.bl);
    const tmPx = px(e.tm);
    const rmPx = px(e.rm);
    const bmPx = px(e.bm);
    const lmPx = px(e.lm);
    const cPx = px(e.center);
    // Each sub-quad is a Corners (tl, tr, br, bl) walking clockwise from the
    // outer corner of the quadrant to the centroid.
    const tl: Corners = { tl: tlPx, tr: tmPx, br: cPx, bl: lmPx };
    const tr: Corners = { tl: tmPx, tr: trPx, br: rmPx, bl: cPx };
    const br: Corners = { tl: cPx, tr: rmPx, br: brPx, bl: bmPx };
    const bl: Corners = { tl: lmPx, tr: cPx, br: bmPx, bl: blPx };
    return {
      tl: getMatrix3dTransform(hw, hh, tl),
      tr: getMatrix3dTransform(hw, hh, tr),
      br: getMatrix3dTransform(hw, hh, br),
      bl: getMatrix3dTransform(hw, hh, bl),
      hw,
      hh,
    };
  }, [corners, imgBox]);

  // 8-point outline polygon: TL → TM → TR → RM → BR → BM → BL → LM → (back to TL)
  // Uses effective midpoints so the outline always shows the real label shape
  // whether midpoints are auto-follow or custom.
  const polyPoints = useMemo(() => {
    const e = effectiveAll(corners);
    return [e.tl, e.tm, e.tr, e.rm, e.br, e.bm, e.bl, e.lm]
      .map(([x, y]) => `${x * 100},${y * 100}`)
      .join(' ');
  }, [corners]);

  // Pocket label CSS matrix3d — simple 4-point perspective warp
  const pocketLabelTransform = useMemo(() => {
    if (!showPocketLabel || !imgBox.w || !imgBox.h) return null;
    const W = imgBox.w;
    const H = imgBox.h;
    const dst: Corners = {
      tl: [pocketCorners.tl[0] * W, pocketCorners.tl[1] * H],
      tr: [pocketCorners.tr[0] * W, pocketCorners.tr[1] * H],
      br: [pocketCorners.br[0] * W, pocketCorners.br[1] * H],
      bl: [pocketCorners.bl[0] * W, pocketCorners.bl[1] * H],
    };
    return getMatrix3dTransform(POCKET_LABEL_W, POCKET_LABEL_H, dst);
  }, [showPocketLabel, pocketCorners, imgBox]);

  const pocketPolyPoints = useMemo(() => {
    if (!showPocketLabel) return '';
    return [pocketCorners.tl, pocketCorners.tr, pocketCorners.br, pocketCorners.bl]
      .map(([x, y]) => `${x * 100},${y * 100}`)
      .join(' ');
  }, [showPocketLabel, pocketCorners]);

  const mode = modeRef.current;
  const cursor =
    mode.kind === 'pan'
      ? 'grabbing'
      : mode.kind === 'corner' || mode.kind === 'body' || mode.kind === 'pocket-corner' || mode.kind === 'pocket-body'
        ? 'grabbing'
        : 'grab';

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
      <div className="bg-white max-w-[98vw] w-full h-[98vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
          <div>
            <h2 className="text-sm font-bold text-neutral-900">
              Warp leather label — {shotType}
            </h2>
            <p className="text-[11px] text-neutral-500">
              Drag the label body to move · drag corners to stretch/squeeze
              · align to the brown leather patch underneath, then click Warp.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-neutral-400 hover:text-neutral-900 text-2xl leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Canvas */}
        <div
          className="relative flex-1 overflow-hidden bg-neutral-900 select-none"
          style={{ cursor, touchAction: 'none' }}
          onWheel={handleWheel}
          onPointerDown={onContainerPointerDown}
          onPointerMove={onContainerPointerMove}
          onPointerUp={onContainerPointerUp}
          onPointerCancel={onContainerPointerUp}
          onPointerLeave={onContainerPointerUp}
        >
          {/* Zoom + opacity controls */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            <div className="flex items-center gap-1 bg-black/60 px-2 py-1 rounded">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setShowPocketLabel(!showPocketLabel)}
                className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded mr-2 ${
                  showPocketLabel
                    ? 'bg-blue-500/80 text-white'
                    : 'bg-white/10 text-white/50 hover:text-white/80'
                }`}
                title="Toggle pocket label overlay"
              >
                {showPocketLabel ? '✓ Pocket' : '+ Pocket'}
              </button>
              <span className="text-white/60 text-[10px] uppercase tracking-wide mr-1">
                Label
              </span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={labelOpacity}
                onChange={(e) => setLabelOpacity(parseFloat(e.target.value))}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-24"
              />
              <span className="text-white/70 text-xs w-8 text-right">
                {Math.round(labelOpacity * 100)}%
              </span>
            </div>
            <div
              className="flex items-center gap-1 bg-black/60 px-2 py-1 rounded"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={zoomOut}
                className="text-white/80 hover:text-white w-7 h-7 flex items-center justify-center text-lg font-light"
                title="Zoom out"
              >
                −
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={zoomReset}
                className="text-white/60 hover:text-white text-xs w-14 text-center"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={zoomIn}
                className="text-white/80 hover:text-white w-7 h-7 flex items-center justify-center text-lg font-light"
                title="Zoom in"
              >
                +
              </button>
            </div>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={zoomFull}
              className="bg-black/60 text-white/70 hover:text-white text-xs px-3 py-1.5 rounded"
              title="Zoom to 300%"
            >
              300%
            </button>
          </div>

          {/* Hint */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 text-white/40 text-xs pointer-events-none">
            Scroll to zoom · Drag background to pan · Drag label to move ·
            Drag corners to warp · Esc to close
          </div>

          {/* Preview status badges */}
          {!previewUrl && !previewError && (
            <div className="absolute top-3 left-3 z-20 bg-black/60 text-white/70 text-[11px] px-3 py-1.5 rounded">
              Loading label preview…
            </div>
          )}
          {previewError && (
            <div className="absolute top-3 left-3 z-20 bg-red-900/70 text-red-100 text-[11px] px-3 py-1.5 rounded max-w-md">
              Preview failed: {previewError}
            </div>
          )}

          {/* Detection status badge */}
          {detectStatus === 'detecting' && (
            <div className="absolute top-12 left-3 z-20 bg-black/60 text-white/60 text-[10px] px-2 py-1 rounded">
              Detecting label…
            </div>
          )}
          {detectStatus === 'gemini' && (
            <div className="absolute top-12 left-3 z-20 bg-green-900/70 text-green-100 text-[10px] px-2 py-1 rounded">
              Label auto-detected
            </div>
          )}
          {detectStatus === 'fallback' && (
            <div className="absolute top-12 left-3 z-20 bg-amber-900/70 text-amber-100 text-[10px] px-2 py-1 rounded">
              Using default position
            </div>
          )}

          {/* Transform wrapper — shot + SVG + overlay + handles all share it */}
          <div
            className="absolute top-1/2 left-1/2"
            style={{
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: mode.kind === 'none' ? 'transform 0.08s ease' : 'none',
              willChange: 'transform',
            }}
          >
            <div className="relative inline-block">
              <img
                ref={imgRef}
                src={imageUrl}
                alt="shot"
                draggable={false}
                className="block max-h-[80vh] max-w-[92vw] object-contain pointer-events-none"
              />

              {/* Warped label preview — 4 sub-quadrant matrix3d warps.
                  Each quarter PNG (pre-rendered in the quarterUrls effect)
                  is warped independently onto its sub-quadrant of the outer
                  8-point polygon. When no midpoints are dragged, the 4
                  sub-warps compose seamlessly. When a midpoint is dragged,
                  the two adjacent sub-quads bend through the new midpoint,
                  bulging the label edge in a V shape. */}
              {previewUrl && quarterUrls && subQuadTransforms && imgBox.w > 0 &&
                (['tl', 'tr', 'br', 'bl'] as const).map((k, i) => {
                  const t = subQuadTransforms[k];
                  if (!t) return null;
                  return (
                    <img
                      key={k}
                      src={quarterUrls[i]}
                      alt={`label preview ${k}`}
                      draggable={false}
                      onPointerDown={startBodyDrag}
                      className="absolute top-0 left-0 cursor-move"
                      style={{
                        width: `${subQuadTransforms.hw}px`,
                        height: `${subQuadTransforms.hh}px`,
                        transform: t,
                        transformOrigin: '0 0',
                        opacity: labelOpacity,
                        touchAction: 'none',
                        imageRendering: 'auto',
                        objectFit: 'fill',
                      }}
                    />
                  );
                })}

              {/* SVG quad outline — thin green border on the warped label */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                <polygon
                  points={polyPoints}
                  fill="none"
                  stroke="rgba(34, 197, 94, 0.85)"
                  strokeWidth="0.25"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {/* Corner handles — inverse-scaled so they stay same screen size */}
              {CORNER_KEYS.map((k) => {
                const [x, y] = corners[k];
                const isActive = mode.kind === 'corner' && mode.key === k;
                return (
                  <div
                    key={k}
                    onPointerDown={startCornerDrag(k)}
                    className={`absolute w-5 h-5 rounded-full border-2 border-white cursor-grab active:cursor-grabbing shadow-md flex items-center justify-center text-[9px] font-bold text-white ${
                      isActive ? 'bg-green-500' : 'bg-green-600'
                    }`}
                    style={{
                      left: `${x * 100}%`,
                      top: `${y * 100}%`,
                      transform: `translate(-50%, -50%) scale(${
                        (isActive ? 1.25 : 1) / zoom
                      })`,
                      transformOrigin: 'center center',
                      touchAction: 'none',
                    }}
                  >
                    {HANDLE_LABEL[k]}
                  </div>
                );
              })}

              {/* Midpoint handles — smaller, hollow when auto-follow, filled
                  when custom. Double-click releases back to auto-follow.
                  These sit at the effective midpoint position (computed
                  from adjacent corners when auto, or the user's dragged
                  value when custom). */}
              {(() => {
                const eff = effectiveAll(corners);
                return MID_KEYS.map((k) => {
                  const [x, y] = eff[k];
                  const isCustom = !!corners[k];
                  const isActive = mode.kind === 'midpoint' && mode.key === k;
                  return (
                    <div
                      key={`mid-${k}`}
                      onPointerDown={startMidpointDrag(k)}
                      onDoubleClick={releaseMidpoint(k)}
                      className={`absolute w-4 h-4 rounded-full border-2 cursor-grab active:cursor-grabbing shadow-md ${
                        isCustom
                          ? isActive
                            ? 'bg-amber-400 border-white'
                            : 'bg-amber-500 border-white'
                          : 'bg-white/20 border-white/80'
                      }`}
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        transform: `translate(-50%, -50%) scale(${
                          (isActive ? 1.25 : 1) / zoom
                        })`,
                        transformOrigin: 'center center',
                        touchAction: 'none',
                      }}
                      title={isCustom ? 'Double-click to reset' : 'Drag to bend edge'}
                    />
                  );
                });
              })()}

              {/* ── Pocket label overlay + handles ── */}
              {showPocketLabel && pocketLabelTransform && (
                <>
                  {/* Woven label image — CSS matrix3d warped */}
                  <img
                    src="/originals-label-gold-woven.png"
                    width={POCKET_LABEL_W}
                    height={POCKET_LABEL_H}
                    draggable={false}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId);
                      setMode({
                        kind: 'pocket-body',
                        startMx: e.clientX,
                        startMy: e.clientY,
                        startCorners: { ...pocketCorners },
                      });
                    }}
                    className="absolute top-0 left-0 cursor-move"
                    style={{
                      width: `${POCKET_LABEL_W}px`,
                      height: `${POCKET_LABEL_H}px`,
                      maxWidth: 'none',
                      transform: pocketLabelTransform,
                      transformOrigin: '0 0',
                      opacity: labelOpacity,
                      touchAction: 'none',
                    }}
                    alt="pocket label"
                  />

                  {/* Pocket label quad outline */}
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  >
                    <polygon
                      points={pocketPolyPoints}
                      fill="none"
                      stroke="rgba(59, 130, 246, 0.85)"
                      strokeWidth="0.25"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>

                  {/* Pocket label corner handles (blue) */}
                  {CORNER_KEYS.map((k) => {
                    const [x, y] = pocketCorners[k];
                    const isActive = mode.kind === 'pocket-corner' && mode.key === k;
                    return (
                      <div
                        key={`pocket-${k}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId);
                          setMode({ kind: 'pocket-corner', key: k });
                        }}
                        className={`absolute w-4 h-4 rounded-full border-2 border-white cursor-grab active:cursor-grabbing shadow-md ${
                          isActive ? 'bg-blue-400' : 'bg-blue-500'
                        }`}
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          transform: `translate(-50%, -50%) scale(${(isActive ? 1.25 : 1) / zoom})`,
                          transformOrigin: 'center center',
                          touchAction: 'none',
                          zIndex: 30,
                        }}
                        title={`Pocket ${k.toUpperCase()}`}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 px-5 py-3 flex items-center justify-between gap-3">
          <div className="text-[10px] text-neutral-500 font-mono">
            TL {corners.tl[0].toFixed(3)},{corners.tl[1].toFixed(3)} · TR{' '}
            {corners.tr[0].toFixed(3)},{corners.tr[1].toFixed(3)} · BR{' '}
            {corners.br[0].toFixed(3)},{corners.br[1].toFixed(3)} · BL{' '}
            {corners.bl[0].toFixed(3)},{corners.bl[1].toFixed(3)}
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span
                className="text-xs text-red-600 max-w-xs truncate"
                title={error}
              >
                {error}
              </span>
            )}
            <button
              onClick={resetToDefault}
              disabled={submitting}
              className="border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
            >
              Reset
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="bg-neutral-900 text-white px-5 py-1.5 text-xs font-medium hover:bg-neutral-800 disabled:opacity-50"
            >
              {submitting ? 'Applying…' : 'Warp label'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
