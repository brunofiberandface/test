'use client';

/**
 * /v2/jobs/[id]/shots/[shotType] — contact sheet view.
 *
 * Every version of one shot type laid out as big tiles. Each tile is
 * clickable → opens the ShotTileModal where the reviewer can star /
 * rerun / open the job. Winner version gets a green border.
 *
 * Phase 3 Slice 3A.
 *
 * Diff tracking (per-version "what changed" tags) is deliberately NOT
 * implemented — Bruno declined in the Phase 2 spec ("Diff tracking
 * not needed"). The tiles just show version number + provider + time.
 *
 * 2026-05-27 (Phase 3 Slice 3A of dashboard redesign).
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Shell from '@/components/Shell';
import ShotTileModal, { type ShotModalContext } from '@/components/v2/ShotTileModal';
import WinnerBadge from '@/components/v2/WinnerBadge';

interface VersionEntry {
  version: number;
  imageUrl?: string;
  createdAt?: string;
  provider?: string;
  isCurrent: boolean;
}

interface ContactSheetResponse {
  shotType: string;
  shotId: string;
  isWinner: boolean;
  status?: string;
  versions: VersionEntry[];
  job: {
    jobId: string;
    focusDesignNumber?: string;
    focusDesignName?: string;
    focusName?: string;
    modelId?: string;
    modelName?: string;
  };
}

function formatVersionTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ContactSheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string; shotType: string }>();
  const jobId = params?.id || '';
  const shotType = params?.shotType || '';

  const [resp, setResp] = useState<ContactSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalCtx, setModalCtx] = useState<ShotModalContext | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch(`/api/v2/jobs/${jobId}/shots/${shotType}`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `responded ${r.status}`);
      }
      const j = await r.json();
      setResp(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jobId, shotType, reloadKey]);

  useEffect(() => { if (jobId && shotType) load(); }, [jobId, shotType, load]);

  if (status === 'loading' || !session?.user) {
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
            {error}
          </div>
          <Link href={`/v2/jobs/${jobId}`} className="text-[12px] text-neutral-500 underline">← Back to job</Link>
        </div>
      </Shell>
    );
  }

  if (!resp) {
    return (
      <Shell user={user}>
        <div className="text-sm text-neutral-400 py-12 text-center">Loading sheet…</div>
      </Shell>
    );
  }

  const winnerCount = resp.versions.filter(v => v.isCurrent && resp.isWinner).length;

  const openModalFor = (v: VersionEntry) => {
    setModalCtx({
      shotId: resp.shotId,
      shotType: resp.shotType,
      imageUrl: v.imageUrl,
      version: v.version,
      totalVersions: resp.versions.length,
      isWinner: resp.isWinner && v.isCurrent,
      jobId: resp.job.jobId,
      designNumber: resp.job.focusDesignNumber,
      designName: resp.job.focusDesignName,
      modelName: resp.job.modelName,
      status: resp.status,
    });
  };

  return (
    <Shell user={user}>
      <div className="max-w-7xl mx-auto">
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-neutral-50 -mx-6 px-6 pt-2 pb-3 border-b border-neutral-200">
          <div className="flex items-baseline justify-between mb-1">
            <div className="flex items-center gap-3 flex-wrap">
              <Link href={`/v2/jobs/${jobId}`} className="text-[12px] text-neutral-500 hover:text-neutral-900">← Job</Link>
              <h1 className="text-xl font-semibold text-neutral-900">
                {resp.shotType} contact sheet
              </h1>
              <span className="text-[12px] text-neutral-500">
                {resp.versions.length} {resp.versions.length === 1 ? 'version' : 'versions'}
                {winnerCount > 0 && <> · <span className="text-[#173404]">1 winner picked</span></>}
              </span>
            </div>
            <Link
              href={`/v2/jobs/${jobId}`}
              className="text-[11px] uppercase tracking-wider text-neutral-400 hover:text-neutral-900"
            >
              {resp.job.focusDesignNumber || resp.job.jobId}
            </Link>
          </div>
          <div className="text-[12px] text-neutral-500">
            {resp.job.focusDesignName || resp.job.focusName || ''}
            {resp.job.modelName && <> · {resp.job.modelName}</>}
          </div>
        </div>

        <div className="pt-4">
          {resp.versions.length === 0 ? (
            <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-neutral-200 rounded-md">
              No versions generated yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {resp.versions.map((v, i) => {
                const isWinner = resp.isWinner && v.isCurrent;
                return (
                  <button
                    key={`${v.version}-${i}`}
                    type="button"
                    onClick={() => openModalFor(v)}
                    className={`relative bg-white rounded-lg p-2 text-left transition-colors ${
                      isWinner
                        ? 'border-2 border-[#97C459]'
                        : v.isCurrent
                          ? 'border-2 border-[#534AB7]'
                          : 'border border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <div className="relative aspect-[3/4] bg-neutral-100 rounded-md overflow-hidden mb-2">
                      {v.imageUrl ? (
                        <Image
                          src={v.imageUrl}
                          alt={`${resp.shotType} v${v.version}`}
                          fill
                          sizes="(max-width: 768px) 50vw, (max-width: 1280px) 25vw, 240px"
                          className="object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400">no image</div>
                      )}
                      <span className="absolute top-2 left-2 bg-black/65 text-white text-[10px] px-1.5 py-0.5 rounded-sm">
                        v{v.version}
                      </span>
                      {isWinner && (
                        <span className="absolute top-2 right-2">
                          <WinnerBadge size={14} />
                        </span>
                      )}
                      {v.isCurrent && !isWinner && (
                        <span className="absolute top-2 right-2 bg-[#534AB7] text-white text-[10px] px-1.5 py-0.5 rounded-sm">
                          current
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-600 truncate">{formatVersionTime(v.createdAt)}</div>
                    <div className="text-[10px] text-neutral-400 capitalize">{v.provider || ''}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ShotTileModal
          context={modalCtx}
          onClose={() => {
            setModalCtx(null);
            // Refresh after close in case the modal toggled winner state.
            setReloadKey(k => k + 1);
          }}
        />
      </div>
    </Shell>
  );
}
