'use client';

/**
 * Wardrobe → Label setup (three-tier, Option B)
 *
 * Port of /label_POC/wardrobe_mockup/index.html — ADR-001 three-tier pipeline.
 * Ports label corners, pocket corners, colour picker, pan/zoom, live preview.
 *
 * Writes TWO Firestore docs on save:
 *   - labelStyles/{styleCode}            (templateId + corners + anchorPhoto)
 *   - labelColorways/{styleCode}_{colorwayCode} (baseColor + grain + emboss)
 *
 * designNumber parsing is strict: if the wardrobe item's designNumber cannot
 * be split into {styleCode, colorwayCode}, we block save and tell the user
 * to fix the wardrobe record first.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { parseDesignNumber } from '@/lib/design-number';
import type {
  WardrobeItem,
  LabelTemplate,
  LabelStyle,
  LabelColorway,
  Point2D,
  GrainVariant,
} from '@/types';

type Tool = 'label' | 'pocket' | 'picker';
type PhotoKey = 'back' | 'back45Left' | 'back45Right' | 'flatBack';

interface PhotoEntry {
  key: PhotoKey;
  label: string;
  url: string;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

const TEMPLATE_ID = 'L2936-8.0';

// ─── Helpers ──────────────────────────────────────────────────────────────

function rgbHex({ r, g, b }: RGBColor): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/** Sort 4 points to canonical TL/TR/BR/BL via sum/diff trick. */
function sortQuad(pts: Point2D[]): Point2D[] {
  if (!Array.isArray(pts) || pts.length !== 4) return pts.map((p) => ({ ...p }));
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.y - p.x);
  const argMin = (a: number[]) => a.indexOf(Math.min(...a));
  const argMax = (a: number[]) => a.indexOf(Math.max(...a));
  return [
    pts[argMin(sums)], // TL
    pts[argMin(diffs)], // TR
    pts[argMax(sums)], // BR
    pts[argMax(diffs)], // BL
  ];
}

function roundPt(p: Point2D): Point2D {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function proxyUrl(url: string): string {
  if (!url) return url;
  // Local /label-assets paths are same-origin, no proxy needed
  if (url.startsWith('/')) return url;
  return `/api/label/image-proxy?url=${encodeURIComponent(url)}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function LabelSetupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const wardrobeId = params?.id as string;

  // ── Loaded data
  const [item, setItem] = useState<WardrobeItem | null>(null);
  const [template, setTemplate] = useState<LabelTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ── Style / colorway parsing
  const parsed = useMemo(
    () => parseDesignNumber(item?.designNumber),
    [item?.designNumber],
  );
  const styleCode = parsed?.styleCode || null;
  const colorwayCode = parsed?.colorwayCode || null;
  const hasValidDesignNumber = !!(styleCode && colorwayCode);

  // ── Tool + corners state
  const [tool, setTool] = useState<Tool>('label');
  const [activePhoto, setActivePhoto] = useState<PhotoKey>('back');
  const [labelCorners, setLabelCorners] = useState<Point2D[]>([]);
  const [pocketCorners, setPocketCorners] = useState<Point2D[]>([]);
  const [color, setColor] = useState<RGBColor | null>(null);
  const [grainVariant, setGrainVariant] = useState<GrainVariant>('pebbled');
  const [embossStrength, setEmbossStrength] = useState(0.55);

  // ── Canvas / zoom state
  const stageRef = useRef<HTMLDivElement>(null);
  const stageInnerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Keep image source & size in refs so they survive re-renders without triggering loops
  const imageRef = useRef<HTMLImageElement | null>(null);
  const templateImgRef = useRef<HTMLImageElement | null>(null);
  const naturalSize = useRef({ w: 0, h: 0 });
  const scaleRef = useRef(1);
  const canvasSize = useRef({ w: 0, h: 0 });

  const [zoom, setZoom] = useState(1);
  const [panActive, setPanActive] = useState(false);
  const spaceHeld = useRef(false);
  const panning = useRef(false);
  const panStart = useRef<{
    x: number;
    y: number;
    sx: number;
    sy: number;
  } | null>(null);
  const panJustEnded = useRef(false);

  // Drag state
  const draggingIdx = useRef<number | null>(null);
  const draggingKind = useRef<'label' | 'pocket' | null>(null);

  // ── Photo list (back angles + flat back)
  const photos: PhotoEntry[] = useMemo(() => {
    if (!item) return [];
    const list: PhotoEntry[] = [];
    const fit = item.fitModels;
    if (fit?.back) list.push({ key: 'back', label: 'Back 0°', url: fit.back });
    if (fit?.back45Left)
      list.push({ key: 'back45Left', label: 'Back 45° L', url: fit.back45Left });
    if (fit?.back45Right)
      list.push({ key: 'back45Right', label: 'Back 45° R', url: fit.back45Right });
    if (item.flatBackUrl)
      list.push({ key: 'flatBack', label: 'Flat back', url: item.flatBackUrl });
    return list;
  }, [item]);

  // ── Initial data load
  useEffect(() => {
    if (!wardrobeId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // 1. bootstrap template (idempotent)
        await fetch('/api/label/bootstrap', { method: 'POST' });

        // 2. load wardrobe item
        const res = await fetch(`/api/wardrobe/${wardrobeId}`);
        if (!res.ok) throw new Error(`wardrobe ${res.status}`);
        const data = await res.json();
        const w: WardrobeItem = data.item || data;
        if (cancelled) return;
        setItem(w);

        // 3. load template
        const tRes = await fetch(`/api/label/templates/${TEMPLATE_ID}`);
        if (tRes.ok) {
          const tData = await tRes.json();
          if (!cancelled) setTemplate(tData.template);
        }

        // 4. pre-fill from existing style + colorway if present
        const parsed2 = parseDesignNumber(w.designNumber);
        if (parsed2?.styleCode) {
          const sRes = await fetch(`/api/label/styles/${parsed2.styleCode}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const s: LabelStyle = sData.style;
            if (!cancelled && s) {
              setLabelCorners(s.labelCorners);
              setPocketCorners(s.pocketCorners);
              if (s.anchorPhoto?.photoKey)
                setActivePhoto(s.anchorPhoto.photoKey as PhotoKey);
            }
          }
          if (parsed2.colorwayCode) {
            const cRes = await fetch(
              `/api/label/colorways/${parsed2.styleCode}_${parsed2.colorwayCode}`,
            );
            if (cRes.ok) {
              const cData = await cRes.json();
              const c: LabelColorway = cData.colorway;
              if (!cancelled && c) {
                setColor({ r: c.baseColor.r, g: c.baseColor.g, b: c.baseColor.b });
                setGrainVariant(c.grainVariant);
                setEmbossStrength(c.embossStrength);
              }
            }
          }
        }
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

  // ── Current photo URL
  const currentPhoto = photos.find((p) => p.key === activePhoto) || photos[0];
  const currentUrl = currentPhoto?.url;

  // ── Load image into canvas whenever currentUrl changes
  useEffect(() => {
    if (!currentUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      naturalSize.current = { w: img.naturalWidth, h: img.naturalHeight };
      drawStage();
    };
    img.onerror = () => {
      setError(`Failed to load photo: ${currentUrl}`);
    };
    img.src = proxyUrl(currentUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  // ── Load template preview image
  useEffect(() => {
    if (!template?.artworkUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      templateImgRef.current = img;
      drawPreview();
    };
    img.src = proxyUrl(template.artworkUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.artworkUrl]);

  // ── Redraw preview when color changes
  useEffect(() => {
    drawPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  // ── Stage draw (main canvas + overlay sizing)
  const drawStage = useCallback(() => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    const stageInner = stageInnerRef.current;
    if (!img || !canvas || !stageInner) return;
    const maxW = Math.min(window.innerWidth - 380 - 48, 1200);
    const maxH = window.innerHeight - 120;
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    stageInner.style.width = w + 'px';
    stageInner.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    scaleRef.current = ratio;
    canvasSize.current = { w, h };
    applyZoom(zoom);
  }, [zoom]);

  // Redraw on window resize
  useEffect(() => {
    const onResize = () => drawStage();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawStage]);

  // ── Zoom (CSS transform)
  const applyZoom = useCallback((z: number) => {
    const stageInner = stageInnerRef.current;
    if (!stageInner) return;
    stageInner.style.transform = `scale(${z})`;
    stageInner.style.setProperty('--ptscale', String(1 / z));
    const wrap = stageInner.parentElement;
    if (wrap) {
      wrap.style.width = canvasSize.current.w * z + 'px';
      wrap.style.height = canvasSize.current.h * z + 'px';
    }
  }, []);

  useEffect(() => {
    applyZoom(zoom);
  }, [zoom, applyZoom]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      setZoom((prev) => {
        const next = Math.max(0.25, Math.min(8, prev * factor));
        if (Math.abs(next - prev) < 1e-6) return prev;
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.getBoundingClientRect();
          const localX = clientX - rect.left + stage.scrollLeft;
          const localY = clientY - rect.top + stage.scrollTop;
          const f = next / prev;
          requestAnimationFrame(() => {
            stage.scrollLeft = localX * f - (clientX - rect.left);
            stage.scrollTop = localY * f - (clientY - rect.top);
          });
        }
        return next;
      });
    },
    [],
  );

  const stageCenter = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, []);

  // ── Wheel zoom
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(e.clientX, e.clientY, factor);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ── Pan drag
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onDown = (e: PointerEvent) => {
      if (!(panActive || spaceHeld.current)) return;
      if ((e.target as HTMLElement).closest('#zoomctl')) return;
      e.preventDefault();
      panning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        sx: stage.scrollLeft,
        sy: stage.scrollTop,
      };
      stage.classList.add('panning');
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {}
    };
    const onMove = (e: PointerEvent) => {
      if (!panning.current || !panStart.current) return;
      stage.scrollLeft = panStart.current.sx - (e.clientX - panStart.current.x);
      stage.scrollTop = panStart.current.sy - (e.clientY - panStart.current.y);
    };
    const endPan = (e: PointerEvent) => {
      if (!panning.current) return;
      panning.current = false;
      panJustEnded.current = true;
      setTimeout(() => (panJustEnded.current = false), 50);
      stage.classList.remove('panning');
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {}
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', endPan);
      stage.removeEventListener('pointercancel', endPan);
    };
  }, [panActive]);

  // ── Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      if (e.key === ' ' && !spaceHeld.current) {
        e.preventDefault();
        spaceHeld.current = true;
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setPanActive((p) => !p);
        return;
      }
      if (e.key === 'Escape' && panActive) {
        setPanActive(false);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        const c = stageCenter();
        zoomAt(c.x, c.y, 1.25);
      } else if (e.key === '-' || e.key === '_') {
        const c = stageCenter();
        zoomAt(c.x, c.y, 1 / 1.25);
      } else if (e.key === '0') {
        setZoom(1);
      } else if (e.key === '1') {
        const target = 1 / scaleRef.current;
        const c = stageCenter();
        zoomAt(c.x, c.y, target / zoom);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [panActive, zoomAt, stageCenter, zoom]);

  // ── Canvas click + point drag
  const stageCoordFromEvent = (e: {
    clientX: number;
    clientY: number;
  }): Point2D => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x =
      ((e.clientX - rect.left) * naturalSize.current.w) / rect.width;
    const y =
      ((e.clientY - rect.top) * naturalSize.current.h) / rect.height;
    return { x, y };
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panActive || spaceHeld.current || panJustEnded.current) {
      panJustEnded.current = false;
      return;
    }
    if (draggingIdx.current !== null) return;
    const p = stageCoordFromEvent(e);
    if (tool === 'label') {
      if (labelCorners.length < 4) setLabelCorners([...labelCorners, p]);
    } else if (tool === 'pocket') {
      if (pocketCorners.length < 4) setPocketCorners([...pocketCorners, p]);
    } else if (tool === 'picker') {
      samplePixel(p);
    }
  };

  const samplePixel = (p: Point2D) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const cx = Math.round(p.x * scaleRef.current);
    const cy = Math.round(p.y * scaleRef.current);
    const r = 2;
    try {
      const data = ctx.getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1).data;
      let R = 0,
        G = 0,
        B = 0,
        n = 0;
      for (let i = 0; i < data.length; i += 4) {
        R += data[i];
        G += data[i + 1];
        B += data[i + 2];
        n++;
      }
      setColor({
        r: Math.round(R / n),
        g: Math.round(G / n),
        b: Math.round(B / n),
      });
    } catch {
      setError('Could not read pixel — image may be CORS-tainted.');
    }
  };

  const onPointDown = (
    e: React.PointerEvent<HTMLDivElement>,
    kind: 'label' | 'pocket',
    idx: number,
  ) => {
    if (panActive || spaceHeld.current) return;
    e.preventDefault();
    e.stopPropagation();
    draggingIdx.current = idx;
    draggingKind.current = kind;
    (e.currentTarget as HTMLElement).classList.add('dragging');
    const onMove = (ev: PointerEvent) => {
      const p = stageCoordFromEvent(ev);
      const clamped = {
        x: clamp(p.x, 0, naturalSize.current.w),
        y: clamp(p.y, 0, naturalSize.current.h),
      };
      if (draggingKind.current === 'label') {
        setLabelCorners((prev) => prev.map((c, i) => (i === idx ? clamped : c)));
      } else {
        setPocketCorners((prev) => prev.map((c, i) => (i === idx ? clamped : c)));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingIdx.current = null;
      draggingKind.current = null;
      document
        .querySelectorAll('.pt.dragging')
        .forEach((n) => n.classList.remove('dragging'));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Switch photo (prompt if corners exist)
  const switchPhoto = (key: PhotoKey) => {
    if (key === activePhoto) return;
    if (labelCorners.length || pocketCorners.length) {
      if (
        !confirm(
          'Switching anchor photo will clear the label and pocket corners. Continue?',
        )
      )
        return;
      setLabelCorners([]);
      setPocketCorners([]);
    }
    setActivePhoto(key);
  };

  // ── Live preview (luminance-preserving tint)
  const drawPreview = useCallback(() => {
    const c = previewRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, c.width, c.height);
    const t = templateImgRef.current;
    if (!t) return;
    const pad = 20;
    const maxW = c.width - pad * 2;
    const maxH = c.height - pad * 2;
    const r = Math.min(maxW / t.width, maxH / t.height);
    const w = Math.round(t.width * r);
    const h = Math.round(t.height * r);
    const dx = Math.round((c.width - w) / 2);
    const dy = Math.round((c.height - h) / 2);
    try {
      ctx.drawImage(t, dx, dy, w, h);
      if (!color) return;
      const { r: TR, g: TG, b: TB } = color;
      const img = ctx.getImageData(dx, dy, w, h);
      const d = img.data;
      const shadow = [TR * 0.1, TG * 0.1, TB * 0.1];
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (!a) continue;
        const lum = (d[i] + d[i + 1] + d[i + 2]) / (255 * 3);
        let norm = Math.max(0, Math.min(1, (lum - 0.02) / 0.63));
        norm = Math.pow(norm, 0.85);
        d[i] = Math.round(norm * TR + (1 - norm) * shadow[0]);
        d[i + 1] = Math.round(norm * TG + (1 - norm) * shadow[1]);
        d[i + 2] = Math.round(norm * TB + (1 - norm) * shadow[2]);
      }
      ctx.putImageData(img, dx, dy);
    } catch {
      // Ignore CORS errors
    }
  }, [color]);

  // ── Save
  const doSave = async () => {
    setError(null);
    setSaveMsg(null);
    if (!hasValidDesignNumber) {
      setError(
        `designNumber "${item?.designNumber || ''}" could not be parsed. Expected like D22889-D933-H087.`,
      );
      return;
    }
    if (labelCorners.length !== 4) {
      setError('Place all 4 label corners.');
      return;
    }
    if (pocketCorners.length !== 4) {
      setError('Place all 4 pocket corners.');
      return;
    }
    if (!color) {
      setError('Sample a colour with the colour picker.');
      return;
    }

    setSaving(true);
    try {
      const sortedLabel = sortQuad(labelCorners).map(roundPt) as [
        Point2D,
        Point2D,
        Point2D,
        Point2D,
      ];
      const sortedPocket = sortQuad(pocketCorners).map(roundPt) as [
        Point2D,
        Point2D,
        Point2D,
        Point2D,
      ];

      // Tier 2: labelStyles/{styleCode}
      const stylePayload = {
        style: {
          templateId: TEMPLATE_ID,
          anchorPhoto: {
            wardrobeItemId: wardrobeId,
            photoKey: activePhoto,
            url: currentUrl || '',
            width: naturalSize.current.w,
            height: naturalSize.current.h,
          },
          labelCorners: sortedLabel,
          pocketCorners: sortedPocket,
          updatedBy: 'label-setup-ui',
        },
      };
      const sRes = await fetch(`/api/label/styles/${styleCode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stylePayload),
      });
      if (!sRes.ok) throw new Error(`style save ${sRes.status}`);

      // Tier 3: labelColorways/{styleCode}_{colorwayCode}
      const cwPayload = {
        colorway: {
          colorwayName: item?.name,
          baseColor: { r: color.r, g: color.g, b: color.b, hex: rgbHex(color) },
          embossStrength,
          grainVariant,
          sampledFromPhoto: activePhoto,
          updatedBy: 'label-setup-ui',
        },
      };
      const cRes = await fetch(
        `/api/label/colorways/${styleCode}_${colorwayCode}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cwPayload),
        },
      );
      if (!cRes.ok) throw new Error(`colorway save ${cRes.status}`);

      setSaveMsg(
        `Saved: style ${styleCode}, colorway ${styleCode}_${colorwayCode}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    if (!confirm('Reset all corners and sampled colour?')) return;
    setLabelCorners([]);
    setPocketCorners([]);
    setColor(null);
  };

  // ── Rendered overlay points
  const renderPoint = (
    p: Point2D,
    kind: 'label' | 'pocket',
    idx: number,
  ) => {
    const s = scaleRef.current;
    const color = kind === 'label' ? '#e2c66a' : '#5fb8ff';
    const textColor = kind === 'label' ? '#202020' : '#ffffff';
    return (
      <div
        key={`${kind}-${idx}`}
        className="pt"
        data-kind={kind}
        data-idx={idx}
        style={{
          position: 'absolute',
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '2px solid #fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: textColor,
          background: color,
          cursor: 'grab',
          pointerEvents: 'auto',
          boxShadow: '0 2px 6px rgba(0,0,0,.6)',
          left: p.x * s,
          top: p.y * s,
          transform: `translate(-50%,-50%) scale(var(--ptscale, 1))`,
          transformOrigin: 'center',
          willChange: 'transform',
        }}
        onPointerDown={(e) => onPointDown(e, kind, idx)}
      >
        {idx + 1}
      </div>
    );
  };

  const payloadJson = useMemo(() => {
    return JSON.stringify(
      {
        styleCode,
        colorwayCode,
        colorwayName: item?.name,
        labelTemplate: TEMPLATE_ID,
        anchorPhoto: {
          wardrobeItemId: wardrobeId,
          photoKey: activePhoto,
          url: currentUrl,
          width: naturalSize.current.w,
          height: naturalSize.current.h,
        },
        labelCorners: sortQuad(labelCorners).map(roundPt),
        pocketCorners: sortQuad(pocketCorners).map(roundPt),
        color: color ? { ...color, hex: rgbHex(color) } : null,
        grainVariant,
        embossStrength,
      },
      null,
      2,
    );
  }, [
    styleCode,
    colorwayCode,
    item?.name,
    wardrobeId,
    activePhoto,
    currentUrl,
    labelCorners,
    pocketCorners,
    color,
    grainVariant,
    embossStrength,
  ]);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: '#0e1013',
        color: '#e8eaed',
        minHeight: '100vh',
        font: '14px/1.45 -apple-system,Helvetica,Arial,sans-serif',
      }}
    >
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #262a31',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <Link href={`/wardrobe`} style={{ color: '#8892a0', textDecoration: 'none' }}>
          ← Wardrobe
        </Link>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Label setup</h1>
        <span style={{ color: '#8892a0', fontSize: 13 }}>
          {item
            ? `${item.designNumber || '(no designNumber)'} — ${item.name}`
            : loading
              ? 'Loading…'
              : ''}
        </span>
        <span style={{ flex: 1 }} />
        {saveMsg && <span style={{ color: '#cde63c' }}>{saveMsg}</span>}
        {error && <span style={{ color: '#ff7ac6' }}>{error}</span>}
        <button
          onClick={resetAll}
          style={{
            background: '#1e242c',
            color: '#e8eaed',
            border: '1px solid #262a31',
            padding: '7px 11px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <button
          onClick={doSave}
          disabled={saving || !hasValidDesignNumber}
          style={{
            background: saving ? '#4a5260' : '#cde63c',
            color: '#1a1d22',
            border: '1px solid #cde63c',
            padding: '7px 14px',
            borderRadius: 6,
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <main
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          height: 'calc(100vh - 57px)',
        }}
      >
        {/* Stage */}
        <section
          id="stage"
          ref={stageRef}
          className={panActive ? 'pan-mode' : ''}
          style={{
            position: 'relative',
            overflow: 'auto',
            background: '#0a0c0f',
            padding: 24,
            cursor: panActive ? 'grab' : 'default',
          }}
        >
          <div
            style={{
              minWidth: '100%',
              minHeight: '100%',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
            }}
          >
            <div
              ref={stageInnerRef}
              style={{
                position: 'relative',
                boxShadow: '0 10px 40px rgba(0,0,0,.5)',
                borderRadius: 6,
                transformOrigin: '0 0',
                ['--ptscale' as string]: '1',
              } as React.CSSProperties}
            >
              <canvas ref={canvasRef} onClick={onCanvasClick} style={{ display: 'block', userSelect: 'none' }} />
              <svg
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  width: canvasSize.current.w,
                  height: canvasSize.current.h,
                }}
              >
                {labelCorners.length >= 2 && (
                  <polygon
                    points={labelCorners
                      .map((p) => `${p.x * scaleRef.current},${p.y * scaleRef.current}`)
                      .join(' ')}
                    stroke="rgba(226,198,106,0.9)"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray={labelCorners.length === 4 ? '0' : '4 4'}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {pocketCorners.length >= 2 && (
                  <polygon
                    points={pocketCorners
                      .map((p) => `${p.x * scaleRef.current},${p.y * scaleRef.current}`)
                      .join(' ')}
                    stroke="rgba(95,184,255,0.9)"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray={pocketCorners.length === 4 ? '0' : '4 4'}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                }}
              >
                {labelCorners.map((p, i) => renderPoint(p, 'label', i))}
                {pocketCorners.map((p, i) => renderPoint(p, 'pocket', i))}
              </div>
            </div>
          </div>

          {/* Zoom controls */}
          <div
            id="zoomctl"
            style={{
              position: 'fixed',
              bottom: 22,
              right: 360,
              display: 'flex',
              gap: 4,
              background: 'rgba(14,16,19,0.92)',
              border: '1px solid #262a31',
              padding: 5,
              borderRadius: 8,
              zIndex: 10,
              boxShadow: '0 6px 20px rgba(0,0,0,.5)',
            }}
          >
            <button
              onClick={() => setPanActive((p) => !p)}
              style={{
                background: panActive ? '#28313d' : 'transparent',
                color: panActive ? '#cde63c' : '#e8eaed',
                border: 0,
                padding: '0 10px',
                borderRadius: 5,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Pan
            </button>
            <div style={{ width: 1, background: '#262a31', margin: '4px 2px' }} />
            <button
              onClick={() => {
                const c = stageCenter();
                zoomAt(c.x, c.y, 1 / 1.25);
              }}
              style={{
                background: 'transparent',
                color: '#e8eaed',
                border: 0,
                width: 32,
                height: 32,
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              −
            </button>
            <div
              style={{
                minWidth: 52,
                textAlign: 'center',
                fontSize: 12,
                color: '#8892a0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={() => {
                const c = stageCenter();
                zoomAt(c.x, c.y, 1.25);
              }}
              style={{
                background: 'transparent',
                color: '#e8eaed',
                border: 0,
                width: 32,
                height: 32,
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              +
            </button>
            <div style={{ width: 1, background: '#262a31', margin: '4px 2px' }} />
            <button
              onClick={() => setZoom(1)}
              style={{
                background: 'transparent',
                color: '#e8eaed',
                border: 0,
                padding: '0 10px',
                borderRadius: 5,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Fit
            </button>
          </div>
        </section>

        {/* Sidebar */}
        <aside
          style={{
            background: '#171a1f',
            borderLeft: '1px solid #262a31',
            overflowY: 'auto',
          }}
        >
          {/* Anchor photo */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Anchor photo</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {photos.map((p) => (
                <button
                  key={p.key}
                  onClick={() => switchPhoto(p.key)}
                  style={{
                    background: '#1e242c',
                    border:
                      p.key === activePhoto
                        ? '1px solid #cde63c'
                        : '1px solid #262a31',
                    borderRadius: 6,
                    padding: '3px 3px 4px',
                    cursor: 'pointer',
                    color: p.key === activePhoto ? '#cde63c' : '#e8eaed',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 10,
                    width: 66,
                  }}
                >
                  <img
                    src={proxyUrl(p.url)}
                    alt={p.label}
                    crossOrigin="anonymous"
                    style={{
                      width: 58,
                      height: 82,
                      objectFit: 'cover',
                      borderRadius: 4,
                      background: '#000',
                    }}
                  />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
            <p style={{ ...hint, marginTop: 8 }}>
              Pick the view where the leather label has the least perspective.
              Switching clears the fit-view corners.
            </p>
          </div>

          {/* Tool */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Tool</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['label', 'pocket', 'picker'] as Tool[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTool(t);
                    if (panActive) setPanActive(false);
                  }}
                  style={{
                    background: tool === t ? '#28313d' : '#1e242c',
                    border:
                      tool === t
                        ? '1px solid #cde63c'
                        : '1px solid #262a31',
                    padding: '9px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: tool === t ? '#cde63c' : '#e8eaed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: '50%',
                      display: 'inline-block',
                      background:
                        t === 'label'
                          ? '#e2c66a'
                          : t === 'pocket'
                            ? '#5fb8ff'
                            : '#ff7ac6',
                    }}
                  />
                  {t === 'label'
                    ? `Label corners ${labelCorners.length}/4`
                    : t === 'pocket'
                      ? `Pocket corners ${pocketCorners.length}/4`
                      : 'Colour picker'}
                </button>
              ))}
            </div>
            <p style={{ ...hint, marginTop: 10 }}>
              {tool === 'label'
                ? 'Click to place each corner of the leather label (TL, TR, BR, BL). Drag to adjust. Scroll to zoom.'
                : tool === 'pocket'
                  ? 'Click to place each corner of the right back pocket — geometric anchor for the homography at generation time.'
                  : 'Click on the leather label to sample its colour. Zoom in first for precision.'}
            </p>
          </div>

          {/* Colour */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Sampled colour</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 6,
                  border: '1px solid #262a31',
                  background: color ? rgbHex(color) : '#000',
                }}
              />
              <div>
                <code style={{ fontSize: 13 }}>{color ? rgbHex(color) : '#000000'}</code>
                <br />
                <span style={hint}>
                  {color
                    ? `RGB(${color.r}, ${color.g}, ${color.b})`
                    : 'RGB(0, 0, 0)'}
                </span>
              </div>
            </div>
          </div>

          {/* Material */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Material</h2>
            <label style={{ display: 'block', marginBottom: 10 }}>
              Grain variant&nbsp;
              <select
                value={grainVariant}
                onChange={(e) =>
                  setGrainVariant(e.target.value as GrainVariant)
                }
                style={{
                  background: '#1e242c',
                  color: '#e8eaed',
                  border: '1px solid #262a31',
                  padding: '5px 8px',
                  borderRadius: 4,
                }}
              >
                <option value="pebbled">Pebbled</option>
                <option value="smooth">Smooth</option>
                <option value="coarse">Coarse</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              Emboss strength: <b>{embossStrength.toFixed(2)}</b>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={embossStrength}
                onChange={(e) => setEmbossStrength(parseFloat(e.target.value))}
                style={{ display: 'block', width: '100%', marginTop: 6 }}
              />
            </label>
          </div>

          {/* Preview */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Label preview</h2>
            <div
              style={{
                border: '1px solid #262a31',
                borderRadius: 6,
                background: '#0a0c0f',
              }}
            >
              <canvas
                ref={previewRef}
                width={320}
                height={220}
                style={{ display: 'block', width: '100%' }}
              />
            </div>
            <p style={hint}>
              Luminance-preserving multiply blend of the tint onto the template.
              Lives on the shared L2936-8.0 template.
            </p>
          </div>

          {/* Payload */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #262a31' }}>
            <h2 style={sidebarH2}>Payload (preview)</h2>
            <pre
              style={{
                margin: 0,
                padding: '11px 13px',
                background: '#0a0c0f',
                border: '1px solid #262a31',
                borderRadius: 6,
                fontSize: 11.5,
                color: '#b9c2cf',
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {payloadJson}
            </pre>
          </div>
        </aside>
      </main>
    </div>
  );
}

const sidebarH2: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.8px',
  color: '#8892a0',
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: '#8892a0',
  marginTop: 6,
  lineHeight: 1.45,
};
