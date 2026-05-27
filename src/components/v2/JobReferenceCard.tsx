'use client';

/**
 * <JobReferenceCard/> — the visual header on the v2 job detail page.
 *
 * Shows the four reference blocks: focus garment hero, model headshot,
 * styling items (top/bottom/shoe), and the right-side meta column
 * with status + ★ progress + design code.
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import Image from 'next/image';
import StatusPill from './StatusPill';
import type { V2Status } from '@/lib/v2/job-status';

export interface JobReferenceData {
  jobId: string;
  jobName?: string;
  status: V2Status;
  winnerCount: number;
  totalShotTypes: number;
  focusDesignNumber?: string;
  focusDesignName?: string;
  focusFitModelFrontUrl?: string;
  modelName?: string;
  modelReferenceImageUrl?: string;
  wardrobe: Array<{ slot: 'top' | 'bottom' | 'shoe'; name?: string; thumbnailUrl?: string; isFocus?: boolean }>;
  totalVersionsAcrossShots: number;
}

function ImageOr({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) return <div className={`${className} bg-neutral-200`} />;
  return (
    <div className={`${className} relative bg-neutral-100 overflow-hidden`}>
      <Image src={src} alt={alt} fill sizes="80px" className="object-cover" loading="lazy" />
    </div>
  );
}

export default function JobReferenceCard({ data }: { data: JobReferenceData }) {
  const stylingItems = data.wardrobe.filter(w => !w.isFocus && w.thumbnailUrl);

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4 flex gap-4 items-stretch">
      {/* Focus garment */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">Focus</div>
        <ImageOr src={data.focusFitModelFrontUrl} alt={data.focusDesignName || ''} className="w-[60px] h-20 rounded-sm" />
        <div className="text-[11px] font-medium text-neutral-900 max-w-[80px] truncate">
          {data.focusDesignName || data.focusDesignNumber || '—'}
        </div>
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">Model</div>
        <ImageOr src={data.modelReferenceImageUrl} alt={data.modelName || ''} className="w-14 h-[72px] rounded-sm" />
        <div className="text-[11px] font-medium text-neutral-900">{data.modelName || '—'}</div>
      </div>

      {/* Styling */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">Styling</div>
        <div className="flex gap-1">
          {stylingItems.length > 0 ? stylingItems.map((it, i) => (
            <ImageOr key={i} src={it.thumbnailUrl} alt={it.name || ''} className="w-9 h-12 rounded-sm" />
          )) : (
            <div className="text-[11px] text-neutral-400 italic h-12 flex items-center">No styling items</div>
          )}
        </div>
        <div className="text-[11px] text-neutral-500 truncate">
          {stylingItems.map(s => s.name).filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-col items-end justify-between text-right shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Job</div>
          <div className="text-[12px] font-medium text-neutral-900">{data.focusDesignNumber || data.jobName || data.jobId}</div>
          <div className="text-[11px] text-neutral-500">{data.totalVersionsAcrossShots} versions</div>
        </div>
        <div>
          <StatusPill
            status={data.status}
            size="md"
            winnerCount={data.winnerCount}
            totalShotTypes={data.totalShotTypes}
          />
        </div>
      </div>
    </div>
  );
}
