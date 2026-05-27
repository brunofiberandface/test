'use client';

/**
 * <VersionStrip/> — horizontal strip of version thumbnails for one shot.
 * Current version is bordered in indigo. Earlier versions are dimmed.
 * Click any tile → opens it in the modal (handler passed in by parent).
 *
 * 2026-05-27 (Phase 1 Slice 1C of dashboard redesign).
 */
import Image from 'next/image';

export interface VersionTile {
  imageUrl?: string;
  version?: number;
  isCurrent: boolean;
  isWinner?: boolean;
}

export default function VersionStrip({
  versions,
  onTileClick,
  tileSize = 32,
}: {
  versions: VersionTile[];
  onTileClick?: (v: VersionTile, index: number) => void;
  tileSize?: number;
}) {
  if (versions.length === 0) {
    return <div className="text-[11px] text-neutral-400">no versions yet</div>;
  }
  return (
    <div className="flex gap-1 overflow-x-auto">
      {versions.map((v, i) => {
        const w = tileSize;
        const h = Math.round(tileSize * 1.25);
        return (
          <button
            key={`${v.version}-${i}`}
            type="button"
            onClick={() => onTileClick?.(v, i)}
            className="relative shrink-0 rounded-sm overflow-hidden bg-neutral-100 hover:opacity-100 transition-opacity"
            style={{
              width: w,
              height: h,
              opacity: v.isCurrent ? 1 : 0.6,
              border: v.isCurrent ? '1.5px solid #534AB7' : '0.5px solid rgba(0,0,0,0.1)',
            }}
            aria-label={`version ${v.version || i + 1}`}
          >
            {v.imageUrl ? (
              <Image
                src={v.imageUrl}
                alt={`v${v.version || i + 1}`}
                fill
                sizes={`${w}px`}
                className="object-cover"
                loading="lazy"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-[8px] text-neutral-400">
                v{v.version || i + 1}
              </span>
            )}
            {v.isWinner && (
              <span className="absolute -top-0.5 -right-0.5 bg-[#97C459] text-[#173404] text-[8px] font-medium px-1 rounded-sm">★</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
