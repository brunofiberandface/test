'use client';

/**
 * <JobRow/> — one row in the chronological feed.
 *
 * Layout matches the mockup: focus garment hero on the left, 4 generated
 * shot tiles in the middle, model thumbnail, then a small metadata column.
 *
 * Click anywhere EXCEPT a shot tile → navigates to /v2/jobs/[id]. Click a
 * shot tile → calls onShotTileClick with the shot context so the parent
 * can open the ShotTileModal in place. Slice 1C wiring.
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { APP_CONFIG } from '@/lib/config';
import { formatRowTime, type FeedJob, type ShotSummary } from './feed-types';
import { deriveV2Status } from '@/lib/v2/job-status';
import StatusPill from './StatusPill';

export interface ShotTileClickInfo {
  job: FeedJob;
  shot: ShotSummary;
}

interface JobRowProps {
  job: FeedJob;
  onShotTileClick?: (info: ShotTileClickInfo) => void;
}

function placeholderBg(seed: string): string {
  let hash = 0;
  for (const c of seed) hash = ((hash << 5) - hash) + c.charCodeAt(0);
  const v = Math.abs(hash) % 60 + 180;
  return `linear-gradient(160deg, rgb(${v},${v},${v}), rgb(${v - 20},${v - 20},${v - 20}))`;
}

function ShotTile({
  shot, jobId, onClick,
}: {
  shot: ShotSummary;
  jobId: string;
  onClick?: () => void;
}) {
  const hasImage = !!shot.imageUrl;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="relative flex-1 aspect-[3/4] rounded-sm overflow-hidden bg-neutral-100 hover:opacity-90 transition-opacity"
      aria-label={`Open ${shot.shotType} v${shot.version || 1}`}
    >
      {hasImage ? (
        <Image
          src={shot.imageUrl as string}
          alt={`${shot.shotType} v${shot.version || 1}`}
          fill
          sizes="(max-width: 768px) 80px, 100px"
          className="object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-[9px] text-neutral-400"
          style={{ background: placeholderBg(shot.shotType + jobId) }}
        >
          {shot.shotType}
        </div>
      )}
      {hasImage && shot.totalVersions && shot.totalVersions > 0 && (
        <span className="absolute bottom-1 right-1 bg-black/65 text-white text-[9px] px-1 rounded-sm">
          v{shot.version || shot.totalVersions}
        </span>
      )}
      {shot.isWinner && (
        <span className="absolute top-1 left-1 bg-[#97C459] text-[#173404] text-[9px] font-medium px-1 rounded-sm">
          ★
        </span>
      )}
      {shot.status === 'generating' && (
        <span className="absolute top-1 left-1 bg-[#534AB7] text-white text-[8px] px-1 rounded-sm">●</span>
      )}
    </button>
  );
}

function ReferenceBlock({ job }: { job: FeedJob }) {
  const heroUrl = job.focusFitModelFrontUrl;
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <div className="w-[60px] h-20 bg-neutral-100 rounded-sm overflow-hidden relative">
        {heroUrl ? (
          <Image src={heroUrl} alt={job.focusName || ''} fill sizes="60px" className="object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 bg-neutral-200" />
        )}
      </div>
    </div>
  );
}

function ModelBlock({ job }: { job: FeedJob }) {
  const url = job.modelReferenceImageUrl;
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-14">
      <div className="w-11 h-14 bg-neutral-100 rounded-sm overflow-hidden relative">
        {url ? (
          <Image src={url} alt={job.modelName || ''} fill sizes="44px" className="object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 bg-neutral-200" />
        )}
      </div>
      <div className="text-[11px] text-neutral-500 text-center truncate w-full">
        {job.modelName || job.modelId || '—'}
      </div>
    </div>
  );
}

export default function JobRow({ job, onShotTileClick }: JobRowProps) {
  const router = useRouter();
  const shotTypes = APP_CONFIG.shotTypes as readonly string[];
  const v2Status = deriveV2Status({
    rawStatus: job.status,
    archived: job.archived,
    winnerCount: job.winnerCount,
    totalShotTypes: job.totalShotTypes,
  });

  const goToDetail = () => router.push(`/v2/jobs/${job.jobId}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToDetail}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToDetail(); } }}
      className="block bg-white border border-neutral-200 rounded-lg p-3 hover:border-neutral-300 transition-colors cursor-pointer"
    >
      <div className="flex items-stretch gap-3">
        <ReferenceBlock job={job} />
        <div className="flex-1 min-w-0 flex gap-1.5 items-center">
          {shotTypes.map(st => {
            const shot = job.shots[st] || { shotType: st };
            return (
              <ShotTile
                key={st}
                shot={shot}
                jobId={job.jobId}
                onClick={() => onShotTileClick?.({ job, shot })}
              />
            );
          })}
        </div>
        <ModelBlock job={job} />
        <div className="flex flex-col justify-between items-end text-right shrink-0 w-[160px] gap-2">
          <div className="w-full">
            <div className="text-[11px] text-neutral-400">{formatRowTime(job.updatedAt || job.createdAt)}</div>
            <div className="text-[12px] font-medium text-neutral-900 mt-0.5 leading-tight break-words">
              {job.focusDesignNumber || job.jobName || job.jobId}
            </div>
            <div
              className="text-[11px] text-neutral-500 leading-snug mt-0.5 break-words"
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {job.focusDesignName || job.focusName || ''}
            </div>
          </div>
          <StatusPill status={v2Status} winnerCount={job.winnerCount} totalShotTypes={job.totalShotTypes} />
        </div>
      </div>
    </div>
  );
}
