'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';

interface QCScores {
  // v2 dimensions
  proportions?: { score: number; note: string };
  silhouette?: { score: number; note: string };
  color_wash?: { score: number; note: string };
  construction?: { score: number; note: string };
  hardware?: { score: number; note: string };
  wardrobe?: { score: number; note: string };
  ecommerce?: { score: number; note: string };
  // v1 legacy dimensions (backwards compat)
  color?: { score: number; note: string };
  no_invented?: { score: number; note: string };
  weighted_score: number;
  pass: boolean;
  critical_issues: string[];
  summary: string;
}

interface PreviousVersion {
  imageUrl: string;
  version: number;
  createdAt: string;
}

interface ShotData {
  id: string;
  shotId: string;
  type: string;
  variant: string;
  label: string;
  status: string;
  version: number;
  modelId?: string;
  imageUrl?: string;
  previousVersions?: PreviousVersion[];
  qcScores?: QCScores;
  qcPass?: boolean;
  progressStep?: string;
  progressPct?: number;
  updatedAt?: string;
}

interface JobData {
  designNumber: string;
  jobName?: string;
  description: string;
  garmentCategory: string;
  status: string;
  flatImageUrl?: string;
  image360Urls?: string[];
  modelIds?: string[];
  wardrobeItemIds?: Record<string, string>;
  wardrobeItemNames?: Record<string, string>;
}

const SHOT_LABELS: Record<string, string> = {
  M01: 'Cropped Front',
  M02: 'Cropped Back',
  M03: 'Full Body Front',
  M04: 'Full Body Back',
  M05: 'Dynamic',
};

const SHOT_VARIANT_LABELS: Record<string, Record<string, string>> = {
  M03: { A: 'Full Body Front' },
};

function QCBadge({ score, pass }: { score: number; pass: boolean }) {
  const color = pass
    ? score >= 8 ? 'bg-green-600' : 'bg-green-500'
    : score >= 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={`${color} text-white text-xs font-bold px-1.5 py-0.5 min-w-[2rem] text-center`}>
      {score.toFixed(1)}
    </div>
  );
}

function QCDetail({ qc }: { qc: QCScores }) {
  // v2 dimensions first, then v1 fallback
  const dims = qc.proportions ? [
    { key: 'proportions', label: 'Proportions', weight: '2x' },
    { key: 'silhouette', label: 'Fit & Silhouette', weight: '2x' },
    { key: 'color_wash', label: 'Color & Wash', weight: '2x' },
    { key: 'construction', label: 'Construction', weight: '1x' },
    { key: 'hardware', label: 'Hardware & Labels', weight: '1x' },
    { key: 'wardrobe', label: 'Wardrobe', weight: '2x' },
    { key: 'ecommerce', label: 'E-commerce', weight: '1x' },
  ] : [
    { key: 'silhouette', label: 'Silhouette', weight: '2x' },
    { key: 'construction', label: 'Construction', weight: '1x' },
    { key: 'hardware', label: 'Hardware', weight: '1x' },
    { key: 'color', label: 'Color', weight: '1x' },
    { key: 'no_invented', label: 'No Invented', weight: '1x' },
    { key: 'ecommerce', label: 'E-commerce', weight: '1x' },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <div className={`text-lg font-bold ${qc.pass ? 'text-green-600' : 'text-red-500'}`}>
          {qc.weighted_score.toFixed(1)}/10
        </div>
        <span className={`text-xs px-2 py-0.5 font-medium ${qc.pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {qc.pass ? 'PASS' : 'FAIL'}
        </span>
      </div>
      {dims.map(d => {
        const val = (qc as unknown as Record<string, unknown>)[d.key] as { score: number; note: string } | undefined;
        if (!val?.score && val?.score !== 0) return null;
        const score = val.score;
        return (
          <div key={d.key} className="mb-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-neutral-700 w-28">{d.label} <span className="text-neutral-400 font-normal">({d.weight})</span></span>
              <div className="flex-1 bg-neutral-100 h-2 rounded-sm">
                <div
                  className={`h-full rounded-sm ${score >= 7 ? 'bg-green-500' : score >= 5 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${score * 10}%` }}
                />
              </div>
              <span className={`text-xs font-bold w-6 text-right ${score >= 7 ? 'text-green-600' : score >= 5 ? 'text-amber-600' : 'text-red-600'}`}>{score}</span>
            </div>
            {val.note && (
              <p className="text-[11px] text-neutral-500 ml-[7.5rem] leading-tight">{val.note}</p>
            )}
          </div>
        );
      })}
      {qc.critical_issues?.length > 0 && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded">
          <p className="text-xs font-bold text-red-700 mb-1">Critical Issues:</p>
          {qc.critical_issues.map((issue, i) => (
            <p key={i} className="text-[11px] text-red-600 leading-tight mb-0.5">• {issue}</p>
          ))}
        </div>
      )}
      {qc.summary && (
        <p className="text-[11px] text-neutral-600 mt-2 leading-tight border-t border-neutral-100 pt-2">{qc.summary}</p>
      )}
    </div>
  );
}

function Lightbox({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // Fit-to-screen on open
  useEffect(() => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, [imageUrl]);

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    setZoom(z => Math.min(8, Math.max(0.5, z * delta)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    setPos({
      x: dragStart.current.px + (e.clientX - dragStart.current.mx),
      y: dragStart.current.py + (e.clientY - dragStart.current.my),
    });
  }, [dragging]);

  const handleMouseUp = () => setDragging(false);

  const zoomIn = () => setZoom(z => Math.min(8, z * 1.4));
  const zoomOut = () => setZoom(z => Math.max(0.5, z / 1.4));
  const zoomReset = () => { setZoom(1); setPos({ x: 0, y: 0 }); };
  const zoomFull = () => { setZoom(3); setPos({ x: 0, y: 0 }); };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 overflow-hidden"
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Controls */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-black/60 px-2 py-1 rounded">
          <button onClick={zoomOut} className="text-white/80 hover:text-white w-7 h-7 flex items-center justify-center text-lg font-light">−</button>
          <button onClick={zoomReset} className="text-white/60 hover:text-white text-xs w-12 text-center">{Math.round(zoom * 100)}%</button>
          <button onClick={zoomIn} className="text-white/80 hover:text-white w-7 h-7 flex items-center justify-center text-lg font-light">+</button>
        </div>
        <button onClick={zoomFull} className="bg-black/60 text-white/70 hover:text-white text-xs px-3 py-1.5 rounded">100%</button>
        <button onClick={onClose} className="bg-black/60 text-white/80 hover:text-white w-8 h-8 flex items-center justify-center text-xl font-light rounded">×</button>
      </div>

      {/* Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-xs pointer-events-none">
        Scroll to zoom · Drag to pan · Esc to close
      </div>

      {/* Image */}
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ cursor: dragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
        onClick={(e) => { if (!dragging && e.target === e.currentTarget) onClose(); }}
      >
        <img
          src={imageUrl}
          alt="Full resolution preview"
          draggable={false}
          onMouseDown={handleMouseDown}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            maxWidth: '90vw',
            maxHeight: '90vh',
            transition: dragging ? 'none' : 'transform 0.1s ease',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  );
}

interface Comment {
  id: string;
  commentId: string;
  jobId: string;
  shotId?: string;
  shotType?: string;
  authorEmail: string;
  authorName: string;
  text: string;
  createdAt: string;
}

function CommentThread({ jobId, shots, user }: {
  jobId: string;
  shots: ShotData[];
  user: { email: string; name: string; role: string };
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newText, setNewText] = useState('');
  const [posting, setPosting] = useState(false);
  const [shotFilter, setShotFilter] = useState<string>('all');
  const threadEndRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?jobId=${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (e) {
      console.error('Failed to fetch comments:', e);
    }
  }, [jobId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  // Auto-scroll to bottom when new comments arrive
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const postComment = async () => {
    if (!newText.trim()) return;
    setPosting(true);
    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          shotId: shotFilter !== 'all' ? shotFilter : null,
          shotType: shotFilter !== 'all' ? shots.find(s => s.shotId === shotFilter)?.type : null,
          authorEmail: user.email,
          authorName: user.name || user.email.split('@')[0],
          text: newText.trim(),
        }),
      });
      setNewText('');
      await fetchComments();
    } catch (e) {
      console.error('Failed to post comment:', e);
    } finally {
      setPosting(false);
    }
  };

  const filtered = shotFilter === 'all'
    ? comments
    : comments.filter(c => c.shotId === shotFilter || !c.shotId);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  };

  const getInitials = (name: string) => {
    const parts = name.split(/[\s@]+/);
    return (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
  };

  return (
    <div className="border border-neutral-200 bg-white mt-8">
      {/* Header */}
      <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
        <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider">
          Comments {comments.length > 0 && <span className="text-neutral-400 font-normal">({comments.length})</span>}
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShotFilter('all')}
            className={`text-xs px-2 py-1 transition-colors ${shotFilter === 'all' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
          >
            All
          </button>
          {shots.filter(s => s.imageUrl).map(s => (
            <button
              key={s.shotId}
              onClick={() => setShotFilter(s.shotId)}
              className={`text-xs px-2 py-1 transition-colors ${shotFilter === s.shotId ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
            >
              {s.type}
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="max-h-[360px] overflow-y-auto px-5 py-3 space-y-3">
        {filtered.length === 0 && (
          <p className="text-xs text-neutral-400 py-4 text-center">No comments yet. Start the conversation.</p>
        )}
        {filtered.map(c => {
          const isMe = c.authorEmail === user.email;
          return (
            <div key={c.id} className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                isMe ? 'bg-neutral-900 text-white' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {getInitials(c.authorName)}
              </div>
              <div className={`max-w-[75%] ${isMe ? 'text-right' : ''}`}>
                <div className="flex items-center gap-2 mb-0.5" style={{ justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                  <span className="text-xs font-medium text-neutral-700">{c.authorName}</span>
                  {c.shotType && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-neutral-100 text-neutral-500 font-medium">{c.shotType}</span>
                  )}
                  <span className="text-[10px] text-neutral-400">{formatTime(c.createdAt)}</span>
                </div>
                <div className={`text-sm text-neutral-800 whitespace-pre-wrap px-3 py-2 ${
                  isMe ? 'bg-neutral-900 text-white rounded-l-lg rounded-br-lg' : 'bg-neutral-100 rounded-r-lg rounded-bl-lg'
                }`}>
                  {c.text}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={threadEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t border-neutral-200">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment(); } }}
              rows={1}
              placeholder={shotFilter !== 'all'
                ? `Comment on ${shots.find(s => s.shotId === shotFilter)?.type || 'shot'}...`
                : 'Comment on this job...'}
              className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 resize-none"
            />
          </div>
          <button
            onClick={postComment}
            disabled={!newText.trim() || posting}
            className="bg-neutral-900 text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30 self-end"
          >
            {posting ? '...' : 'Send'}
          </button>
        </div>
        {shotFilter !== 'all' && (
          <p className="text-[10px] text-neutral-400 mt-1">
            Commenting on {shots.find(s => s.shotId === shotFilter)?.type} — visible in the full thread
          </p>
        )}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const params = useParams();
  const jobId = params?.id as string;
  const { data: session } = useSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'creator' }
    : { email: 'demo@gstar-raw.com', name: 'Demo User', role: 'admin' as const };

  const [job, setJob] = useState<JobData | null>(null);
  const [shots, setShots] = useState<ShotData[]>([]);
  const [selectedShot, setSelectedShot] = useState<ShotData | null>(null);
  const [modificationText, setModificationText] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [triggeringShot, setTriggeringShot] = useState<string | null>(null);
  const [qcRunning, setQcRunning] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueActiveJob, setQueueActiveJob] = useState<string | null>(null);

  // ── Stale shot auto-recovery: track last-seen progress per shot ──
  const staleTrackerRef = useRef<Record<string, { step: string; since: number }>>({});
  const autoRecoveringRef = useRef(false);
  const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes with no progress change → auto-reset

  // ── Stable refs — avoid stale closures without adding to useCallback deps ──
  const selectedShotRef = useRef<ShotData | null>(null);
  const triggeringRef = useRef<string | null>(null);
  const runAllFiredRef = useRef(false);
  useEffect(() => { selectedShotRef.current = selectedShot; }, [selectedShot]);
  useEffect(() => { triggeringRef.current = triggeringShot; }, [triggeringShot]);

  // Kick the server-side worker to start processing the queue.
  // This is fire-and-forget — the worker runs independently of the browser.
  const kickWorker = useCallback(async () => {
    console.log(`[Results] Kicking worker for job ${jobId}`);
    try {
      // Enqueue the job first (if not already in a slot or queue)
      await fetch(`/api/jobs/${jobId}/enqueue`, { method: 'POST' });
      // Then kick the worker
      const res = await fetch('/api/jobs/process-queue', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        console.log('[Results] Worker response:', data.status);
      }
    } catch (err) {
      console.error('[Results] Worker kick failed:', err);
    }
  }, [jobId]);

  // Legacy alias for code that still references fireRunAll
  const fireRunAll = kickWorker;

  // Stable — uses selectedShotRef instead of selectedShot state dep.
  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch(`/api/jobs/${jobId}`);
      if (resp.ok) {
        const data = await resp.json();
        setJob(data.job);
        const rawShots = data.shots || [];
        const mappedShots: ShotData[] = rawShots.map((s: Record<string, unknown>) => ({
          id: s.shotId || s.id,
          shotId: s.shotId || s.id,
          type: s.shotType,
          variant: s.variant || 'A',
          label: SHOT_VARIANT_LABELS[s.shotType as string]?.[s.variant as string] ?? `${SHOT_LABELS[s.shotType as string] || s.shotType}${s.variant !== 'A' ? ` (${s.variant})` : ''}`,
          status: s.status,
          version: s.version || 1,
          modelId: s.modelId as string | undefined,
          imageUrl: s.imageUrl,
          previousVersions: s.previousVersions as PreviousVersion[] | undefined,
          qcScores: s.qcScores as QCScores | undefined,
          qcPass: s.qcPass as boolean | undefined,
          progressStep: s.progressStep as string | undefined,
          progressPct: s.progressPct as number | undefined,
          updatedAt: s.updatedAt as string | undefined,
        }));
        setShots(mappedShots);

        // Update selected shot via ref — avoids re-creating fetchData on every click
        const cur = selectedShotRef.current;
        if (cur) {
          const updated = mappedShots.find(s => s.id === cur.id);
          if (updated) setSelectedShot(updated);
        }

        // Worker handles generation server-side — no auto-fire needed from frontend

        // ── Auto-recovery: detect shots stuck in "generating" with no progress change ──
        const now = Date.now();
        const tracker = staleTrackerRef.current;
        const staleShots: string[] = [];

        for (const s of rawShots) {
          const id = s.shotId as string || s.id as string;
          const status = s.status as string;
          const step = (s.progressStep as string) || '';

          if (status === 'generating') {
            const prev = tracker[id];
            if (!prev || prev.step !== step) {
              // Progress changed (or first time seeing it) — reset timer
              tracker[id] = { step, since: now };
            } else if (now - prev.since > STALE_TIMEOUT_MS) {
              // Same progress for > 5 min — stale
              staleShots.push(id);
            }
          } else {
            // No longer generating — clean up tracker
            delete tracker[id];
          }
        }

        // Log stale shots — the server-side worker handles retries automatically
        if (staleShots.length > 0) {
          console.log(`[Results] ${staleShots.length} shot(s) stuck >5min — worker will handle retries`);
        }
      }
    } catch (e) {
      console.error('Failed to fetch job data:', e);
    } finally {
      setLoading(false);
    }
  }, [jobId, fireRunAll]);

  // Poll — faster during generation for live progress updates
  const isGenerating = shots.some(s => s.status === 'generating' || s.status === 'queued');
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, isGenerating ? 3000 : 8000);
    return () => clearInterval(interval);
  }, [fetchData, isGenerating]);

  const approveShot = async (shotId: string) => {
    await fetch(`/api/shots/${shotId}/approve`, { method: 'POST' });
    fetchData();
  };

  const rerunShot = async (shot: ShotData) => {
    setRerunning(true);
    try {
      await fetch(`/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shotId: shot.shotId,
          jobId,
          modelId: shot.modelId || job?.modelIds?.[0],
          shotType: shot.type,
          variant: shot.variant,
          designNumber: job?.designNumber,
          garmentCategory: job?.garmentCategory,
          flatImageUrl: job?.flatImageUrl || '',
          image360Urls: job?.image360Urls || [],
          modification: modificationText,
          originalPrompt: '',
          version: shot.version + 1,
        }),
      });
      setModificationText('');
      fetchData();
    } catch (e) {
      console.error('Rerun failed:', e);
    } finally {
      setRerunning(false);
    }
  };

  // Reset stuck/failed shots to 'queued' then kick the server-side worker
  const retryViaQueue = async (shotsToRetry: ShotData[]) => {
    if (shotsToRetry.length === 0) return;
    setRerunning(true);
    try {
      // 1. Reset each shot to 'queued'
      for (const shot of shotsToRetry) {
        await fetch(`/api/shots/${shot.shotId}/reset`, { method: 'POST' });
      }
      // 2. Kick the worker
      await kickWorker();
      fetchData();
    } catch (e) {
      console.error('Retry via queue failed:', e);
    } finally {
      setRerunning(false);
    }
  };

  const retryAllStuck = () => {
    const stuck = shots.filter(s => s.status === 'generating' || s.status === 'queued' || s.status === 'failed');
    retryViaQueue(stuck);
  };

  // Rerun ALL shots in the job — resets every shot to 'queued' and kicks worker
  const rerunAllShots = async () => {
    if (!confirm(`Rerun all ${shots.length} shots? This will regenerate every shot in this job.`)) return;
    setRerunning(true);
    try {
      for (const shot of shots) {
        await fetch(`/api/shots/${shot.shotId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incrementVersion: true }),
        });
      }
      await kickWorker();
      fetchData();
    } catch (e) {
      console.error('Rerun all failed:', e);
    } finally {
      setRerunning(false);
    }
  };

  const runQC = async (shotId: string) => {
    setQcRunning(true);
    try {
      await fetch('/api/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId }),
      });
      await fetchData();
    } finally {
      setQcRunning(false);
    }
  };

  const allApproved = shots.length > 0 && shots.every(s => s.status === 'approved');
  const approvedCount = shots.filter(s => s.status === 'approved').length;
  const generating = shots.some(s => s.status === 'generating' || s.status === 'queued');

  // Last completed run timestamp — most recent updatedAt from done/approved shots
  const lastRunCompleted = (() => {
    const doneShots = shots.filter(s => (s.status === 'done' || s.status === 'approved') && s.updatedAt);
    if (doneShots.length === 0) return null;
    const timestamps = doneShots.map(s => new Date(s.updatedAt!).getTime()).filter(t => !isNaN(t));
    if (timestamps.length === 0) return null;
    const latest = new Date(Math.max(...timestamps));
    return latest.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  })();

  if (loading) {
    return (
      <Shell user={user}>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={user}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {job?.jobName || job?.designNumber || jobId}
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5 mb-1">{job?.designNumber}</p>
          <p className="text-sm text-neutral-500 mt-1">
            {approvedCount}/{shots.length} approved
            {generating && !shots.some(s => s.progressStep) && <span className="text-amber-600 ml-2">Generating...</span>}
            {lastRunCompleted && !generating && (
              <span className="text-neutral-400 ml-2">· Last run: {lastRunCompleted}</span>
            )}
          </p>
          {/* Wardrobe items selected for this job */}
          {job?.wardrobeItemIds && Object.keys(job.wardrobeItemIds).length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs text-neutral-400">Outfit:</span>
              {Object.entries(job.wardrobeItemIds).map(([cat, id]) => (
                <span key={cat} className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200">
                  {cat}: {job.wardrobeItemNames?.[cat] || id.slice(0, 6)}
                </span>
              ))}
            </div>
          )}
        </div>
        {allApproved && (
          <button className="bg-green-600 text-white px-6 py-2.5 text-sm font-medium hover:bg-green-700 transition-colors">
            Complete Job
          </button>
        )}
      </div>

      {/* Queue position banner — shows when job is waiting for another to finish */}
      {queuePosition !== null && queuePosition > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin" />
            <div>
              <span className="text-sm font-medium text-amber-900">
                Queued — {queuePosition} {queuePosition === 1 ? 'job' : 'jobs'} ahead
              </span>
              {queueActiveJob && (
                <p className="text-xs text-amber-600 mt-0.5">Currently generating: {queueActiveJob}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generation progress panel — shows during active generation */}
      {generating && (() => {
        const shotOrder = ['M03', 'M01', 'M02', 'M04', 'M05'];
        const doneCount = shots.filter(s => s.status === 'done' || s.status === 'approved').length;
        const activeShot = shots.find(s => s.status === 'generating');
        const currentIdx = activeShot ? shotOrder.indexOf(activeShot.type) + 1 : doneCount + 1;
        const overallPct = Math.round(((doneCount + (activeShot?.progressPct || 0) / 100) / shots.length) * 100);
        return (
          <div className="bg-neutral-50 border border-neutral-200 p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                <span className="text-sm font-medium text-neutral-900">
                  Generating shot {currentIdx}/{shots.length}
                  {activeShot && <span className="text-neutral-500 ml-1">— {activeShot.type} {activeShot.label}</span>}
                </span>
              </div>
              <span className="text-xs font-mono text-neutral-400">{overallPct}%</span>
            </div>
            {/* Overall progress bar */}
            <div className="h-2 bg-neutral-200 rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-neutral-900 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${overallPct}%` }}
              />
            </div>
            {/* Per-shot step indicators */}
            <div className="flex gap-1.5">
              {shots.map(shot => {
                const isDone = shot.status === 'done' || shot.status === 'approved';
                const isActive = shot.status === 'generating';
                const isFailed = shot.status === 'failed';
                return (
                  <div key={shot.id} className="flex-1 min-w-0">
                    <div className={`h-1 rounded-full transition-all duration-300 ${
                      isDone ? 'bg-green-500' : isActive ? 'bg-amber-500' : isFailed ? 'bg-red-400' : 'bg-neutral-200'
                    }`}>
                      {isActive && (
                        <div
                          className="h-full bg-amber-600 rounded-full transition-all duration-500"
                          style={{ width: `${shot.progressPct || 0}%` }}
                        />
                      )}
                    </div>
                    <p className={`text-[10px] mt-1 truncate ${isActive ? 'text-amber-700 font-medium' : isDone ? 'text-green-600' : 'text-neutral-400'}`}>
                      {shot.type}
                    </p>
                    {isActive && shot.progressStep && (
                      <p className="text-[10px] text-amber-600 truncate">{shot.progressStep}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Approval progress bar */}
      <div className="h-1 bg-neutral-100 mb-8">
        <div
          className="h-full bg-neutral-900 transition-all duration-300"
          style={{ width: `${shots.length > 0 ? (approvedCount / shots.length) * 100 : 0}%` }}
        />
      </div>

      {/* Action bar — Rerun All + Retry Stuck */}
      <div className="flex items-center justify-end mb-4 gap-3">
        {shots.some(s => s.status === 'generating' || s.status === 'queued' || s.status === 'failed') && (
          <>
            <span className="text-xs text-neutral-500">
              {shots.filter(s => s.status === 'generating' || s.status === 'queued' || s.status === 'failed').length} stuck/failed
            </span>
            <button
              onClick={retryAllStuck}
              disabled={rerunning}
              className="px-4 py-2 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
            >
              {rerunning ? 'Retrying...' : 'Retry All Stuck'}
            </button>
          </>
        )}
        {shots.length > 0 && !generating && (
          <button
            onClick={rerunAllShots}
            disabled={rerunning}
            className="px-4 py-2 text-xs font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-50"
          >
            {rerunning ? 'Rerunning...' : 'Rerun All Shots'}
          </button>
        )}
      </div>

      {/* Shot grid — 4 columns with QC scores */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {shots.map(shot => (
          <div
            key={shot.id}
            className={`border bg-white cursor-pointer transition-all ${
              shot.status === 'approved'
                ? 'border-green-300 bg-green-50/30'
                : shot.qcScores && !shot.qcScores.pass
                  ? 'border-red-300 bg-red-50/30'
                  : selectedShot?.id === shot.id
                    ? 'border-neutral-900 ring-1 ring-neutral-900'
                    : 'border-neutral-200 hover:border-neutral-400'
            }`}
            onClick={() => setSelectedShot(shot)}
            onDoubleClick={() => {
              if (shot.imageUrl && (shot.status === 'done' || shot.status === 'approved')) {
                window.open(shot.imageUrl, '_blank');
              }
            }}
          >
            {/* Image */}
            <div className="aspect-[3/4] bg-neutral-100 relative overflow-hidden">
              {shot.imageUrl && (shot.status === 'done' || shot.status === 'approved') && (
                <img
                  src={shot.imageUrl}
                  alt={shot.label}
                  className="w-full h-full object-cover object-top"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (shot.imageUrl) window.open(shot.imageUrl, '_blank');
                  }}
                />
              )}
              {(shot.status === 'generating' || shot.status === 'queued') && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-50 gap-3">
                  <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                  {shot.progressStep && (
                    <div className="text-center px-3">
                      <p className="text-[11px] text-neutral-600 font-medium">{shot.progressStep}</p>
                      {shot.progressPct !== undefined && shot.progressPct > 0 && (
                        <div className="w-24 h-1 bg-neutral-200 rounded-full mt-1.5 mx-auto overflow-hidden">
                          <div className="h-full bg-neutral-700 rounded-full transition-all duration-500" style={{ width: `${shot.progressPct}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                  {!shot.progressStep && shot.status === 'queued' && (
                    <p className="text-[11px] text-neutral-400">Queued</p>
                  )}
                  {/* Retry button — visible directly on stuck cards */}
                  <button
                    onClick={(e) => { e.stopPropagation(); retryViaQueue([shot]); }}
                    disabled={rerunning}
                    className="mt-1 px-3 py-1.5 text-[11px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {rerunning ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              )}
              {shot.status === 'failed' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50 gap-2">
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-[11px] text-red-600 font-medium">Failed</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); retryViaQueue([shot]); }}
                    disabled={rerunning}
                    className="px-3 py-1.5 text-[11px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {rerunning ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              )}
              {shot.status === 'approved' && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-green-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {/* QC Score badge — top left */}
              {shot.qcScores && (
                <div className="absolute top-2 left-2">
                  <QCBadge score={shot.qcScores.weighted_score} pass={shot.qcScores.pass} />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 flex justify-between items-center">
                <span className="text-xs text-white font-medium">
                  {shot.type}{shot.variant !== 'A' ? `-${shot.variant}` : ''}
                </span>
                {shot.version > 1 && (
                  <span className="text-xs text-neutral-400">v{shot.version}</span>
                )}
              </div>
            </div>
            <div className="p-2">
              <p className="text-xs text-neutral-600">{shot.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Selected shot detail panel — now with QC scores alongside */}
      {selectedShot && (
        <div className="border border-neutral-200 bg-white p-6">
          <div className="flex gap-6">
            {/* Large preview — click to open 4K in new tab */}
            <div className="w-80 flex-shrink-0">
              <div className="aspect-[3/4] bg-neutral-100 border border-neutral-200 overflow-hidden relative group">
                {selectedShot.imageUrl ? (
                  <>
                    <img
                      src={selectedShot.imageUrl}
                      alt={selectedShot.label}
                      className="w-full h-full object-cover cursor-zoom-in"
                      onClick={() => selectedShot.imageUrl && window.open(selectedShot.imageUrl, '_blank')}
                    />
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Click for 4K view
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-300 text-lg">
                    {selectedShot.type}{selectedShot.variant !== 'A' ? `-${selectedShot.variant}` : ''} v{selectedShot.version}
                  </div>
                )}
              </div>
            </div>

            {/* QC Scores — displayed next to image */}
            <div className="w-96 flex-shrink-0">
              {selectedShot.qcScores ? (
                <QCDetail qc={selectedShot.qcScores} />
              ) : selectedShot.status === 'done' ? (
                <div>
                  <p className="text-sm text-neutral-500 mb-2">No QC scores yet</p>
                  <button
                    onClick={() => !qcRunning && runQC(selectedShot.shotId)}
                    disabled={qcRunning}
                    className="border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {qcRunning && <span className="w-3 h-3 border border-neutral-400 border-t-neutral-700 rounded-full animate-spin inline-block" />}
                    {qcRunning ? 'Running QC…' : 'Run QC Now'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-neutral-400">QC runs after generation completes</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">{selectedShot.label}</h3>
                <p className="text-sm text-neutral-500">
                  Version {selectedShot.version} — {selectedShot.status}
                </p>
              </div>

              {selectedShot.status === 'failed' && (
                <div className="space-y-3">
                  <p className="text-sm text-red-600">Generation failed. You can retry this shot.</p>
                  <button
                    onClick={() => rerunShot(selectedShot)}
                    disabled={rerunning}
                    className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
                  >
                    {rerunning ? 'Re-generating...' : 'Retry This Shot'}
                  </button>
                </div>
              )}

              {(selectedShot.status === 'queued' || selectedShot.status === 'generating') && (
                <div className="space-y-3">
                  <p className="text-sm text-amber-600">
                    {selectedShot.status === 'queued' ? 'Shot is stuck in queue.' : 'Shot appears stuck generating.'}
                    {' '}You can retry it.
                  </p>
                  <button
                    onClick={() => rerunShot(selectedShot)}
                    disabled={rerunning}
                    className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
                  >
                    {rerunning ? 'Re-generating...' : 'Retry This Shot'}
                  </button>
                </div>
              )}

              {selectedShot.status === 'done' && (
                <>
                  {/* Version History */}
                  {selectedShot.previousVersions && selectedShot.previousVersions.length > 0 && (
                    <div className="mt-3 border-t border-neutral-200 pt-3">
                      <p className="text-[11px] text-neutral-500 font-medium mb-2">Previous versions ({selectedShot.previousVersions.length})</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {selectedShot.previousVersions.map((pv, i) => (
                          <div
                            key={i}
                            className="flex-shrink-0 cursor-pointer group"
                            onClick={() => window.open(pv.imageUrl, '_blank')}
                          >
                            <img
                              src={pv.imageUrl}
                              alt={`v${pv.version}`}
                              className="w-16 h-20 object-cover object-top border border-neutral-200 group-hover:border-neutral-400 transition-colors"
                            />
                            <p className="text-[9px] text-neutral-400 text-center mt-0.5">v{pv.version}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => approveShot(selectedShot.shotId)}
                      className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
                    >
                      Approve Shot
                    </button>
                    <button
                      onClick={() => rerunShot(selectedShot)}
                      disabled={rerunning}
                      className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                    >
                      {rerunning ? 'Re-generating...' : 'Re-run This Shot'}
                    </button>
                  </div>

                  <div className="border-t border-neutral-200 pt-4">
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                      Modification Instructions (optional)
                    </label>
                    <textarea
                      value={modificationText}
                      onChange={e => setModificationText(e.target.value)}
                      rows={3}
                      placeholder="e.g., darker jeans, fix hand position, adjust hem..."
                      className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900 resize-none"
                    />
                    {modificationText && (
                      <button
                        onClick={() => rerunShot(selectedShot)}
                        disabled={rerunning}
                        className="mt-2 border border-neutral-300 px-6 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-30"
                      >
                        {rerunning ? 'Re-generating...' : 'Re-run With Instructions'}
                      </button>
                    )}
                  </div>
                </>
              )}

              {selectedShot.status === 'approved' && (
                <div className="flex items-center gap-2 text-green-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium">Approved</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Comment Thread */}
      <CommentThread jobId={jobId} shots={shots} user={user} />

      {/* 2K Lightbox overlay */}
      {lightboxUrl && (
        <Lightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </Shell>
  );
}
