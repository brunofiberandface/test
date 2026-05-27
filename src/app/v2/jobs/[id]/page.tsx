'use client';

/**
 * /v2/jobs/[id] — job detail (Slice 1C).
 *
 * Replaces the 1A stub. Layout matches the mockup: reference card on top,
 * four stacked shot rows below, header actions (Rerun all, Mark live).
 *
 * Click any shot thumbnail or version tile → ShotTileModal opens with
 * actions for that version (Mark winner, Rerun, Open Classic results).
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import StatusPill from '@/components/v2/StatusPill';
import JobReferenceCard, { type JobReferenceData } from '@/components/v2/JobReferenceCard';
import ShotRow, { type ShotRowData, type VersionEntry } from '@/components/v2/ShotRow';
import ShotTileModal, { type ShotModalContext } from '@/components/v2/ShotTileModal';
import { deriveV2Status, type V2Status } from '@/lib/v2/job-status';
import { APP_CONFIG } from '@/lib/config';

interface JobDetailResponse {
  job: {
    id: string;
    jobId: string;
    jobName?: string;
    status: string;
    archived: boolean;
    createdAt: string;
    updatedAt?: string;
    focusDesignNumber?: string;
    focusDesignName?: string;
    focusName?: string;
    focusCategory?: string;
    focusFitModelFrontUrl?: string;
    modelId?: string;
    modelName?: string;
    modelReferenceImageUrl?: string;
    wardrobe: Array<{ slot: 'top' | 'bottom' | 'shoe'; name?: string; thumbnailUrl?: string; isFocus?: boolean }>;
    shots: Record<string, ShotRowData>;
    winnerCount: number;
    totalShotTypes: number;
  };
}

export default function V2JobDetailPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const jobId = params?.id || '';

  const [resp, setResp] = useState<JobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalCtx, setModalCtx] = useState<ShotModalContext | null>(null);
  const [actionPending, setActionPending] = useState<null | 'live' | 'unlive' | 'rerun'>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.replace('/auth/signin');
  }, [authStatus, router]);

  const loadJob = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch(`/api/v2/jobs/${jobId}`);
      if (!r.ok) throw new Error(`responded ${r.status}`);
      const j = await r.json();
      setResp(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) loadJob();
  }, [jobId, loadJob]);

  if (authStatus === 'loading' || !session?.user) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Loading…</div>;
  }
  const user = {
    email: session.user.email || '',
    name: session.user.name || '',
    role: (session.user as { role?: 'admin' | 'creator' }).role || 'creator',
  };

  if (error) {
    return (
      <Shell user={user}>
        <div className="max-w-2xl mx-auto py-12 text-center">
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3 mb-4">
            Failed to load job: {error}
          </div>
          <Link href="/v2/jobs" className="text-[12px] text-neutral-500 underline">← Back to feed</Link>
        </div>
      </Shell>
    );
  }

  if (!resp) {
    return (
      <Shell user={user}>
        <div className="text-sm text-neutral-400 py-12 text-center">Loading job…</div>
      </Shell>
    );
  }

  const job = resp.job;
  const v2Status: V2Status = deriveV2Status({
    rawStatus: job.status,
    archived: job.archived,
    winnerCount: job.winnerCount,
    totalShotTypes: job.totalShotTypes,
  });
  const activeShotTypes = APP_CONFIG.shotTypes as readonly string[];
  const totalVersions = activeShotTypes.reduce((sum, st) => {
    const s = job.shots[st];
    return sum + (s?.totalVersions || 0);
  }, 0);

  const refData: JobReferenceData = {
    jobId: job.jobId,
    jobName: job.jobName,
    status: v2Status,
    winnerCount: job.winnerCount,
    totalShotTypes: job.totalShotTypes,
    focusDesignNumber: job.focusDesignNumber,
    focusDesignName: job.focusDesignName,
    focusFitModelFrontUrl: job.focusFitModelFrontUrl,
    modelName: job.modelName,
    modelReferenceImageUrl: job.modelReferenceImageUrl,
    wardrobe: job.wardrobe,
    totalVersionsAcrossShots: totalVersions,
  };

  const openModalForShot = (shotType: string, versionImageUrl?: string, versionNumber?: number) => {
    const shot = job.shots[shotType];
    if (!shot) return;
    setModalCtx({
      shotId: shot.shotId,
      shotType,
      imageUrl: versionImageUrl || shot.imageUrl,
      version: versionNumber || shot.version,
      totalVersions: shot.totalVersions,
      isWinner: shot.isWinner,
      jobId: job.jobId,
      designNumber: job.focusDesignNumber,
      designName: job.focusDesignName,
      modelName: job.modelName,
      status: shot.status,
    });
  };

  const onWinnerToggled = (isWinner: boolean) => {
    if (!modalCtx) return;
    setResp(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      const sh = next.job.shots[modalCtx.shotType];
      if (sh) sh.isWinner = isWinner;
      next.job.winnerCount = Object.values(next.job.shots).filter((s: any) => s.isWinner).length;
      return next;
    });
  };

  const markLive = async () => {
    setActionPending('live'); setActionError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/mark-live`, { method: 'POST' });
      if (!r.ok) throw new Error(`responded ${r.status}`);
      await loadJob();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionPending(null);
    }
  };

  const unmarkLive = async () => {
    setActionPending('unlive'); setActionError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/unmark-live`, { method: 'POST' });
      if (!r.ok) throw new Error(`responded ${r.status}`);
      await loadJob();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionPending(null);
    }
  };

  const rerunAll = async () => {
    setActionPending('rerun'); setActionError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/rerun-with-seedream`, { method: 'POST' });
      if (!r.ok) throw new Error(`responded ${r.status}`);
      await loadJob();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionPending(null);
    }
  };

  return (
    <Shell user={user}>
      <div className="max-w-5xl mx-auto">
        {/* Sticky top bar — title + status + actions stay pinned while
            the shot rows scroll below. */}
        <div className="sticky top-0 z-20 bg-neutral-50 -mx-6 px-6 pt-2 pb-3 border-b border-neutral-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/v2/jobs" className="flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-900 shrink-0">
                ← Jobs
              </Link>
              <div className="text-[14px] font-medium text-neutral-900 truncate">
                {job.focusDesignNumber ? `${job.focusDesignNumber} · ` : ''}{job.focusDesignName || job.jobName || job.jobId}
              </div>
              <StatusPill status={v2Status} size="md" winnerCount={job.winnerCount} totalShotTypes={job.totalShotTypes} />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={rerunAll}
                disabled={actionPending !== null}
                className="bg-white border border-neutral-300 rounded-md px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-50"
              >
                ↻ Rerun all
              </button>
              {v2Status === 'live' ? (
                <button
                  type="button"
                  onClick={unmarkLive}
                  disabled={actionPending !== null}
                  className="bg-white border border-neutral-300 rounded-md px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                >
                  {actionPending === 'unlive' ? 'Updating…' : 'Unmark live'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={markLive}
                  disabled={actionPending !== null || v2Status !== 'complete'}
                  title={v2Status !== 'complete' ? 'Pick all winners first' : 'Confirm the asset is live on the website'}
                  className="bg-neutral-900 text-white rounded-md px-3 py-1.5 text-[12px] font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionPending === 'live' ? 'Marking…' : 'Mark as live'}
                </button>
              )}
            </div>
          </div>

          {actionError && (
            <div className="mt-2 text-[11px] text-red-600 border border-red-200 bg-red-50 rounded-md px-3 py-1.5">
              Action failed: {actionError}
            </div>
          )}
        </div>

        <div className="pt-4" />

        {/* Reference card */}
        <div className="mb-4">
          <JobReferenceCard data={refData} />
        </div>

        {/* Shot rows */}
        <div className="flex flex-col gap-2">
          {activeShotTypes.map(st => {
            const sh = job.shots[st] || ({ shotType: st, previousVersions: [] } as ShotRowData);
            return (
              <ShotRow
                key={st}
                shot={sh}
                jobId={job.jobId}
                onOpenModal={(imageUrl, version) => openModalForShot(st, imageUrl, version)}
              />
            );
          })}
        </div>

        {/* Modal */}
        <ShotTileModal
          context={modalCtx}
          onClose={() => setModalCtx(null)}
          onWinnerToggled={onWinnerToggled}
        />
      </div>
    </Shell>
  );
}
