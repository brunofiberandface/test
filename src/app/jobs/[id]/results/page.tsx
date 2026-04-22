'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';
import LabelCornerPicker from '@/components/LabelCornerPicker';

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
  progressStep?: string;
  progressPct?: number;
  updatedAt?: string;
  alternativePromptLabel?: string;
  usedDressedBase?: boolean;
  provider?: 'gemini' | 'seedream';
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
  const [rerunningShotId, setRerunningShotId] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Array<{ id: string; label: string; shotType: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [labelPickerShotId, setLabelPickerShotId] = useState<string | null>(null);
  const [resettingLabelShotId, setResettingLabelShotId] = useState<string | null>(null);
  const [triggeringShot, setTriggeringShot] = useState<string | null>(null);
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
        const mappedShots: ShotData[] = rawShots.map((s: Record<string, unknown>) => {
          const v = (s.variant as string) || 'A';
          const shotType = s.shotType as string;
          const label = SHOT_VARIANT_LABELS[shotType]?.[v] ?? `${SHOT_LABELS[shotType] || shotType}${v !== 'A' ? ` (${v})` : ''}`;
          return {
          id: s.shotId || s.id,
          shotId: s.shotId || s.id,
          type: s.shotType,
          variant: v,
          label,
          status: s.status,
          version: s.version || 1,
          modelId: s.modelId as string | undefined,
          imageUrl: s.imageUrl,
          previousVersions: s.previousVersions as PreviousVersion[] | undefined,
          progressStep: s.progressStep as string | undefined,
          progressPct: s.progressPct as number | undefined,
          updatedAt: s.updatedAt as string | undefined,
          alternativePromptLabel: s.alternativePromptLabel as string | undefined,
          usedDressedBase: s.usedDressedBase as boolean | undefined,
          provider: s.provider as 'gemini' | 'seedream' | undefined,
        }; });
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

  // Fetch alternative prompts when a shot is selected — filtered by pipeline
  useEffect(() => {
    if (!selectedShot) { setAlternatives([]); return; }
    const pipeline = selectedShot.provider === 'seedream' ? 'seedream' : 'gemini';
    fetch(`/api/prompt-vault/alternatives?shotType=${selectedShot.type}&pipeline=${pipeline}`)
      .then(r => r.json())
      .then(d => setAlternatives(d.alternatives || []))
      .catch(() => setAlternatives([]));
  }, [selectedShot?.type, selectedShot?.provider]);

  const rerunWithAlternative = async (shot: ShotData, promptId: string, promptLabel: string) => {
    // Alternative prompts (Color Fidelity, Top Enforcement, Fit Wide, ...) rerun ONLY the
    // target shot. M01/M02 anchor on the existing M03/M04 URLs via ctx.m03AnchorUrl /
    // m04AnchorUrl, which are already persisted on the job — no need to regenerate the
    // full-body anchors just to swap a prompt. This keeps iteration fast and cheap and
    // preserves the alternative prompt (rerunChain() would drop it).
    setRerunning(true);
    setRerunningShotId(shot.shotId);
    try {
      const isFullBody = shot.type === 'M03' || shot.type === 'M04';
      await fetch(`/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shotId: shot.shotId,
          jobId,
          modelId: shot.modelId || job?.modelIds?.[0],
          shotType: shot.type,
          variant: shot.variant,
          alternativePromptId: promptId,
          alternativePromptLabel: promptLabel,
          version: shot.version + 1,
          ...(isFullBody ? { useDressedBase: true } : {}),
        }),
      });
      fetchData();
    } catch (e) {
      console.error('Rerun with alternative failed:', e);
    } finally {
      setRerunning(false);
      setRerunningShotId(null);
    }
  };

  const rerunWithDressedBase = async (shot: ShotData) => {
    // Queue-path: reset shot with useDressedBase=true, kick worker. Safe to call
    // even if another shot is mid-generation — worker will pick this one up after.
    setRerunningShotId(shot.shotId);
    try {
      await fetch(`/api/shots/${shot.shotId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incrementVersion: true,
          useDressedBase: true,
        }),
      });
      await kickWorker();
      fetchData();
    } catch (e) {
      console.error('Rerun with dressed base failed:', e);
    } finally {
      setRerunningShotId(null);
    }
  };

  const rerunShot = async (shot: ShotData) => {
    // M01/M02 (cropped shots): rerun full chain M03→M04→M01→M02 with dressed base
    // so foot proportions are corrected in the full-body anchors first
    if (shot.type === 'M01' || shot.type === 'M02') {
      return rerunChain();
    }
    // Queue-path rerun: reset shot to 'queued' and kick the worker. This lets the
    // worker pick it up even if another shot is mid-generation — no races with
    // direct /api/generate calls, and the UI doesn't need a global lock.
    setRerunningShotId(shot.shotId);
    try {
      const isFullBody = shot.type === 'M03' || shot.type === 'M04';
      await fetch(`/api/shots/${shot.shotId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incrementVersion: true,
          ...(isFullBody ? { useDressedBase: true } : {}),
        }),
      });
      await kickWorker();
      setModificationText('');
      fetchData();
    } catch (e) {
      console.error('Rerun failed:', e);
    } finally {
      setRerunningShotId(null);
    }
  };

  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const restoreVersion = async (shotId: string, version: number) => {
    setRestoringVersion(version);
    try {
      const res = await fetch(`/api/shots/${shotId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Restore failed:', err);
        return;
      }
      fetchData();
    } catch (e) {
      console.error('Restore failed:', e);
    } finally {
      setRestoringVersion(null);
    }
  };

  // Reset a shot to its very first version (before any label composite).
  // Uses the existing /restore endpoint with version 1.
  const resetToRaw = async (shot: ShotData) => {
    if (!shot.previousVersions || shot.previousVersions.length === 0) return;
    const raw = shot.previousVersions.find(pv => pv.version === 1) || shot.previousVersions[0];
    if (!confirm(`Reset ${shot.label} to raw (v${raw.version})? Current version will be saved to history.`)) return;
    setResettingLabelShotId(shot.shotId);
    try {
      const res = await fetch(`/api/shots/${shot.shotId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: raw.version }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Reset to raw failed:', err);
        return;
      }
      fetchData();
    } catch (e) {
      console.error('Reset to raw failed:', e);
    } finally {
      setResettingLabelShotId(null);
    }
  };

  // Reset stuck/failed shots to 'queued' then kick the server-side worker
  const retryViaQueue = async (shotsToRetry: ShotData[]) => {
    if (shotsToRetry.length === 0) return;
    setRerunning(true);
    try {
      // 1. Reset each shot to 'queued' — M03/M04 get dressed base for foot correction
      for (const shot of shotsToRetry) {
        const isFullBody = shot.type === 'M03' || shot.type === 'M04';
        await fetch(`/api/shots/${shot.shotId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isFullBody ? { useDressedBase: true } : {}),
          }),
        });
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

  // Release held shots (M01, M02, M05) to 'queued' and kick the worker
  const generateRemainingShots = async () => {
    const held = shots.filter(s => s.status === 'held');
    if (held.length === 0) return;
    setRerunning(true);
    try {
      for (const shot of held) {
        const isFullBody = shot.type === 'M03' || shot.type === 'M04';
        await fetch(`/api/shots/${shot.shotId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isFullBody ? { useDressedBase: true } : {}),
          }),
        });
      }
      await kickWorker();
      fetchData();
    } catch (e) {
      console.error('Generate remaining failed:', e);
    } finally {
      setRerunning(false);
    }
  };

  // Rerun the full dependency chain M03→M04→M01→M02 with dressed base, skip M05.
  // Used when re-running M01/M02 — feet proportions need the full pipeline.
  const rerunChain = async () => {
    const chainTypes = ['M03', 'M04', 'M01', 'M02'];
    const chainShots = shots.filter(s => chainTypes.includes(s.type));
    if (chainShots.length === 0) return;
    setRerunning(true);
    try {
      for (const shot of chainShots) {
        const isFullBody = shot.type === 'M03' || shot.type === 'M04';
        await fetch(`/api/shots/${shot.shotId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incrementVersion: true,
            ...(isFullBody ? { useDressedBase: true } : {}),
          }),
        });
      }
      await kickWorker();
      fetchData();
    } catch (e) {
      console.error('Rerun chain failed:', e);
    } finally {
      setRerunning(false);
    }
  };

  // Rerun ALL shots in the job — resets every shot to 'queued' and kicks worker
  const rerunAllShots = async () => {
    if (!confirm(`Rerun all ${shots.length} shots? This will regenerate every shot in this job.`)) return;
    setRerunning(true);
    try {
      for (const shot of shots) {
        const isFullBody = shot.type === 'M03' || shot.type === 'M04';
        await fetch(`/api/shots/${shot.shotId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incrementVersion: true,
            ...(isFullBody ? { useDressedBase: true } : {}),
          }),
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
        <div className="flex items-center gap-2">
          {/* Rerun with Seedream — one-shot override. Previous versions stay restorable. */}
          {!generating && shots.length > 0 && (
            <button
              onClick={async () => {
                const ok = window.confirm(
                  'Rerun all 5 with Seedream. Previous versions stay restorable. Continue?'
                );
                if (!ok) return;
                try {
                  const resp = await fetch(`/api/jobs/${jobId}/rerun-with-seedream`, {
                    method: 'POST',
                  });
                  if (!resp.ok) {
                    const txt = await resp.text();
                    alert(`Rerun failed: ${txt.substring(0, 200)}`);
                    return;
                  }
                  // Refresh the page so the polling picks up the new 'generating' state
                  window.location.reload();
                } catch (e) {
                  alert(`Rerun failed: ${String(e)}`);
                }
              }}
              className="border border-purple-600 text-purple-700 px-4 py-2.5 text-sm font-medium hover:bg-purple-50 transition-colors"
              title="Rerun all 5 shots with Seedream 4.5. Previous Gemini versions preserved in version history."
            >
              Rerun with Seedream
            </button>
          )}
          {allApproved && (
            <button className="bg-green-600 text-white px-6 py-2.5 text-sm font-medium hover:bg-green-700 transition-colors">
              Complete Job
            </button>
          )}
        </div>
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
                const isHeld = shot.status === 'held';
                return (
                  <div key={shot.id} className="flex-1 min-w-0">
                    <div className={`h-1 rounded-full transition-all duration-300 ${
                      isDone ? 'bg-green-500' : isActive ? 'bg-amber-500' : isFailed ? 'bg-red-400' : isHeld ? 'bg-neutral-300 opacity-50' : 'bg-neutral-200'
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
        {shots.some(s => s.status === 'held') && !generating && (
          <button
            onClick={generateRemainingShots}
            disabled={rerunning}
            className="px-4 py-2 text-xs font-medium bg-green-700 text-white hover:bg-green-600 transition-colors disabled:opacity-50"
          >
            {rerunning ? 'Generating...' : `Generate Remaining ${shots.filter(s => s.status === 'held').length} Shots`}
          </button>
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
                  className="w-full h-full object-contain"
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
              {shot.status === 'held' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-100 gap-2">
                  <svg className="w-6 h-6 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[11px] text-neutral-400">Waiting</p>
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
              {shot.provider === 'seedream' && (
                <p className="text-[10px] text-purple-600 font-medium mt-0.5">Seedream</p>
              )}
              {shot.alternativePromptLabel && (
                <p className="text-[10px] text-blue-600 font-medium mt-0.5">{shot.alternativePromptLabel}</p>
              )}
              {shot.usedDressedBase && (
                <p className="text-[10px] text-emerald-600 font-medium mt-0.5">Dressed Base</p>
              )}
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
              <div className="bg-neutral-100 border border-neutral-200 overflow-hidden relative group" style={{ maxHeight: '600px' }}>
                {selectedShot.imageUrl ? (
                  <>
                    <img
                      src={selectedShot.imageUrl}
                      alt={selectedShot.label}
                      className="w-full h-auto max-h-[600px] object-contain cursor-zoom-in"
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


            {/* Actions */}
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">{selectedShot.label}</h3>
                <p className="text-sm text-neutral-500">
                  Version {selectedShot.version} — {selectedShot.status}
                </p>
                {selectedShot.alternativePromptLabel && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded">
                      Rerun: {selectedShot.alternativePromptLabel}
                    </span>
                  </div>
                )}
                {selectedShot.usedDressedBase && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                      Dressed Base Pipeline
                    </span>
                  </div>
                )}
                {selectedShot.version > 1 && !selectedShot.alternativePromptLabel && (
                  <div className="mt-1">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-neutral-100 text-neutral-600 rounded">
                      Rerun: base prompt
                    </span>
                  </div>
                )}
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

              {selectedShot.status === 'generating' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                    <p className="text-sm text-neutral-600">
                      {selectedShot.progressStep || 'Generating...'}
                      {selectedShot.progressPct !== undefined && selectedShot.progressPct > 0 && (
                        <span className="ml-2 text-neutral-400">({selectedShot.progressPct}%)</span>
                      )}
                    </p>
                  </div>
                  {selectedShot.progressPct !== undefined && selectedShot.progressPct > 0 && (
                    <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                      <div className="h-full bg-neutral-700 rounded-full transition-all duration-500" style={{ width: `${selectedShot.progressPct}%` }} />
                    </div>
                  )}
                  <button
                    onClick={() => rerunShot(selectedShot)}
                    disabled={rerunning}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors underline"
                  >
                    Not working? Retry
                  </button>
                </div>
              )}

              {selectedShot.status === 'queued' && (
                <div className="space-y-3">
                  <p className="text-sm text-neutral-500">Queued — waiting for dependencies or worker.</p>
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
                            className="flex-shrink-0 group text-center"
                          >
                            <img
                              src={pv.imageUrl}
                              alt={`v${pv.version}`}
                              className="w-16 h-20 object-cover object-top border border-neutral-200 group-hover:border-neutral-400 transition-colors cursor-pointer"
                              onClick={() => window.open(pv.imageUrl, '_blank')}
                            />
                            <p className="text-[9px] text-neutral-400 mt-0.5">v{pv.version}</p>
                            <button
                              onClick={() => restoreVersion(selectedShot.shotId, pv.version)}
                              disabled={restoringVersion === pv.version}
                              className="text-[9px] text-blue-600 hover:text-blue-800 font-medium disabled:text-neutral-400 mt-0.5"
                            >
                              {restoringVersion === pv.version ? 'Restoring…' : 'Restore'}
                            </button>
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
                      disabled={rerunningShotId === selectedShot.shotId}
                      className="border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                    >
                      {rerunningShotId === selectedShot.shotId ? 'Queueing...' : (selectedShot.type === 'M01' || selectedShot.type === 'M02') ? 'Re-run M03→M04→M01→M02' : 'Re-run This Shot'}
                    </button>
                  </div>

                  {/* Info text for M01/M02 chain rerun */}
                  {(selectedShot.type === 'M01' || selectedShot.type === 'M02') && (
                    <p className="text-[10px] text-neutral-400 -mt-2">
                      Re-runs full chain with foot correction. M05 stays untouched.
                    </p>
                  )}

                  {/* Alternative prompt rerun buttons */}
                  {alternatives.length > 0 && (
                    <div className="border-t border-neutral-200 pt-4">
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                        Re-run with alternative prompt
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {alternatives.map(alt => {
                          const isThisShotRerunning = rerunningShotId === selectedShot.shotId;
                          return (
                            <button
                              key={alt.id}
                              onClick={() => rerunWithAlternative(selectedShot, alt.id, alt.label)}
                              disabled={isThisShotRerunning}
                              className="border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-30"
                            >
                              {alt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Leather label manual mapping — M02/M04 only */}
                  {(selectedShot.type === 'M02' || selectedShot.type === 'M04') && selectedShot.imageUrl && (
                    <div className="border-t border-neutral-200 pt-4">
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                        Leather label
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setLabelPickerShotId(selectedShot.shotId)}
                          className="border border-amber-400 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                        >
                          Map label manually
                        </button>
                        {selectedShot.previousVersions && selectedShot.previousVersions.length > 0 && (
                          <button
                            onClick={() => resetToRaw(selectedShot)}
                            disabled={resettingLabelShotId === selectedShot.shotId}
                            className="border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
                          >
                            {resettingLabelShotId === selectedShot.shotId ? 'Resetting…' : 'Reset to raw'}
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-neutral-400 mt-1.5">
                        Drag the 4 corners onto the label area. Requires labelConfig on the focus garment.
                      </p>
                    </div>
                  )}

                  {/* Dressed base pipeline toggle — M03/M04 only */}
                  {(selectedShot.type === 'M03' || selectedShot.type === 'M04') && (
                    <div className="border-t border-neutral-200 pt-4">
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                        Foot proportion correction
                      </label>
                      <button
                        onClick={() => rerunWithDressedBase(selectedShot)}
                        disabled={rerunningShotId === selectedShot.shotId}
                        className="border border-emerald-400 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-30"
                      >
                        {rerunningShotId === selectedShot.shotId ? 'Generating...' : 'Dressed Base Pipeline'}
                      </button>
                      <p className="text-[10px] text-neutral-400 mt-1.5">
                        5-pass: generates corrected body proportions first, then dresses with garments. ~15s longer.
                      </p>
                    </div>
                  )}

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
                        disabled={rerunningShotId === selectedShot.shotId}
                        className="mt-2 border border-neutral-300 px-6 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-30"
                      >
                        {rerunningShotId === selectedShot.shotId ? 'Queueing...' : 'Re-run With Instructions'}
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

      {/* Label corner picker modal */}
      {labelPickerShotId && (() => {
        const shot = shots.find(s => s.shotId === labelPickerShotId);
        if (!shot || !shot.imageUrl) return null;
        if (shot.type !== 'M02' && shot.type !== 'M04') return null;
        return (
          <LabelCornerPicker
            imageUrl={shot.imageUrl}
            shotId={shot.shotId}
            shotType={shot.type as 'M02' | 'M04'}
            onClose={() => setLabelPickerShotId(null)}
            onApplied={() => {
              setLabelPickerShotId(null);
              fetchData();
            }}
          />
        );
      })()}

    </Shell>
  );
}
