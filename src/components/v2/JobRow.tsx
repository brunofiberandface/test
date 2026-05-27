'use client';

/**
 * <JobRow/> — one row in the chronological feed.
 *
 * Layout matches the mockup: left = focus garment hero, middle = 4 generated
 * shot thumbnails (M01 / M02 / M03 / M05), right-of-middle = model
 * thumbnail, far right = compact metadata (time, design code, ★ count).
 *
 * Clicking the row navigates to /v2/jobs/[id]. Slice 1C will wire tile
 * clicks to open the modal instead of navigating.
 *
 * 2026-05-27 (Phase 1 Slice 1B of dashboard redesign).
 */
import Link from 'next/link';
import Image from 'next/image';
import { APP_CONFIG } from '@/lib/config';
import { formatRowTime, type FeedJob, type ShotSummary } from './feed-types';

interface JobRowProps {
  job: FeedJob;
}

function placeholderBg(seed: string): string {
  // Stable greyscale gradient per shotType so empty tiles aren't pure white.
  let hash = 0;
  for (const c of seed) hash = ((hash << 5) - hash) + c.charCodeAt(0);
  const v = Math.abs(hash) % 60 + 180; // 180-240 grey band
  return `linear-gradient(160deg, rgb(${v},${v},${v}), rgb(${v - 20},${v - 20},${v - 20}))`;
}

function ShotTile({ shot, jobId }: { shot: ShotSummary; jobId: string }) {
  const hasImage = !!shot.imageUrl;
  return (
    <div className="relative flex-1 aspect-[3/4] rounded-sm overflow-hidden bg-neutral-100">
      {hasImage ? (
        <Image
          src={shot.imageUrl as string}
          alt={`${shot.shotType} v${shot.version || 1}`}
          fill
          sizes="80px"
          className="object-cover"
          unoptimized
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
    </div>
  );
}

function ReferenceBlock({ job }: { job: FeedJob }) {
  const heroUrl = job.focusFitModelFrontUrl;
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <div className="w-[60px] h-20 bg-neutral-100 rounded-sm overflow-hidden relative">
        {heroUrl ? (
          <Image src={heroUrl} alt={job.focusName || ''} fill sizes="60px" className="object-cover" unoptimized />
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
          <Image src={url} alt={job.modelName || ''} fill sizes="44px" className="object-cover" unoptimized />
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

function StatusPill({ job }: { job: FeedJob }) {
  if (job.winnerCount >= job.totalShotTypes && job.totalShotTypes > 0) {
    return (
      <span className="bg-[#EAF3DE] text-[#173404] text-[10px] font-medium px-1.5 py-px rounded-sm">
        complete
      </span>
    );
  }
  if (job.winnerCount > 0) {
    return (
      <span className="bg-[#EAF3DE] text-[#173404] text-[10px] font-medium px-1.5 py-px rounded-sm">
        ★ {job.winnerCount}
      </span>
    );
  }
  if (job.status === 'failed') {
    return <span className="bg-[#FCEBEB] text-[#791F1F] text-[10px] px-1.5 py-px rounded-sm">failed</span>;
  }
  if (job.status === 'generating' || job.status === 'queued' || job.status === 'uploading') {
    return <span className="bg-[#EEEDFE] text-[#26215C] text-[10px] px-1.5 py-px rounded-sm">running</span>;
  }
  return <span className="bg-neutral-100 text-neutral-500 text-[10px] px-1.5 py-px rounded-sm">exploring</span>;
}

export default function JobRow({ job }: JobRowProps) {
  const shotTypes = APP_CONFIG.shotTypes as readonly string[];
  return (
    <Link
      href={`/v2/jobs/${job.jobId}`}
      className="block bg-white border border-neutral-200 rounded-lg p-3 hover:border-neutral-300 transition-colors"
    >
      <div className="flex items-stretch gap-3">
        <ReferenceBlock job={job} />
        <div className="flex-1 min-w-0 flex gap-1.5 items-center">
          {shotTypes.map(st => (
            <ShotTile key={st} shot={job.shots[st] || { shotType: st }} jobId={job.jobId} />
          ))}
        </div>
        <ModelBlock job={job} />
        <div className="flex flex-col justify-between items-end text-right shrink-0 w-[100px]">
          <div>
            <div className="text-[11px] text-neutral-400">{formatRowTime(job.updatedAt || job.createdAt)}</div>
            <div className="text-[12px] font-medium text-neutral-900 mt-0.5 truncate">
              {job.focusDesignNumber || job.jobName || job.jobId}
            </div>
            <div className="text-[11px] text-neutral-500 truncate">
              {job.focusDesignName || job.focusName || ''}
            </div>
          </div>
          <StatusPill job={job} />
        </div>
      </div>
    </Link>
  );
}
