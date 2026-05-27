'use client';

/**
 * <ShotRow/> — one of the stacked rows on the job detail page.
 *
 * Layout: [label + status] · [big current thumbnail] · [version strip] ·
 * [actions]. Click the big thumbnail OR any version pill → opens the modal
 * via the onOpenModal handler the parent passes in.
 *
 * Slice 3A: the "Sheet" action is now a Link to the contact sheet page
 * /v2/jobs/[id]/shots/[shotType] (was a no-op button before).
 *
 * 2026-05-27 (Phase 1 Slice 1C + Phase 3 Slice 3A of dashboard redesign).
 */
import Link from 'next/link';
import Image from 'next/image';
import VersionStrip, { type VersionTile } from './VersionStrip';
import WinnerBadge from './WinnerBadge';

export interface VersionEntry {
  imageUrl: string;
  version: number;
  createdAt?: string;
  provider?: string;
}

export interface ShotRowData {
  shotType: string;
  shotId?: string;
  imageUrl?: string;
  version?: number;
  totalVersions?: number;
  status?: string;
  isWinner?: boolean;
  previousVersions: VersionEntry[];
}

export default function ShotRow({
  shot,
  jobId,
  onOpenModal,
}: {
  shot: ShotRowData;
  jobId: string;
  onOpenModal?: (versionImageUrl: string | undefined, versionNumber: number | undefined) => void;
}) {
  const isRunning = shot.status === 'generating';
  const versionTiles: VersionTile[] = [
    ...shot.previousVersions.map((v): VersionTile => ({
      imageUrl: v.imageUrl,
      version: v.version,
      isCurrent: false,
    })),
    {
      imageUrl: shot.imageUrl,
      version: shot.version,
      isCurrent: true,
      isWinner: shot.isWinner,
    },
  ].filter(v => v.imageUrl !== undefined || v.version !== undefined);

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-3 flex gap-3 items-center">
      <div className="shrink-0 w-14">
        <div className="text-[14px] font-medium text-neutral-900">{shot.shotType}</div>
        <div className="mt-1">
          {shot.isWinner ? (
            <WinnerBadge size={11} />
          ) : isRunning ? (
            <span className="bg-[#EEEDFE] text-[#26215C] text-[10px] px-1.5 py-px rounded-sm">running</span>
          ) : (
            <span className="bg-neutral-100 text-neutral-500 text-[10px] px-1.5 py-px rounded-sm">{shot.status || 'open'}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpenModal?.(shot.imageUrl, shot.version)}
        className="shrink-0 relative w-[90px] aspect-[3/4] rounded-md overflow-hidden bg-neutral-100 hover:opacity-95 transition-opacity"
        aria-label={`Open ${shot.shotType} v${shot.version || 1}`}
      >
        {shot.imageUrl ? (
          <Image src={shot.imageUrl} alt={`${shot.shotType} v${shot.version || 1}`} fill sizes="120px" className="object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">{shot.shotType}</div>
        )}
        {shot.version && (
          <span className="absolute bottom-1 right-1 bg-black/65 text-white text-[10px] px-1.5 py-px rounded-sm">v{shot.version}</span>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
          {shot.totalVersions ? `${shot.totalVersions} ${shot.totalVersions === 1 ? 'version' : 'versions'}` : 'no versions'}
          {!shot.isWinner && shot.totalVersions && shot.totalVersions > 0 ? ' · no winner yet' : ''}
        </div>
        <VersionStrip
          versions={versionTiles}
          onTileClick={(v) => onOpenModal?.(v.imageUrl, v.version)}
        />
      </div>

      <div className="shrink-0">
        <Link
          href={`/v2/jobs/${jobId}/shots/${shot.shotType}`}
          className="text-[11px] text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-md px-2.5 py-1.5 hover:border-neutral-300 transition-colors whitespace-nowrap"
        >
          Sheet →
        </Link>
      </div>
    </div>
  );
}
