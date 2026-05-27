'use client';

/**
 * <LegacyMigrationBanner/> — amber banner shown above the wardrobe grid
 * surfacing how many items are still sitting in the NOOS · Legacy bucket
 * (auto-tagged by the Phase 2 Slice 2A migration) and offering a quick
 * "Review" click to filter to them.
 *
 * Hidden when count is 0.
 *
 * 2026-05-27 (Phase 2 Slice 2B of dashboard redesign).
 */
export default function LegacyMigrationBanner({
  legacyCount,
  onReview,
}: {
  legacyCount: number;
  onReview: () => void;
}) {
  if (legacyCount === 0) return null;
  return (
    <div className="bg-[#FAEEDA] border border-[#F0C36C] rounded-md px-3 py-2 mb-3 flex items-center gap-2">
      <span className="text-[14px] text-[#854F0B] leading-none">⏱</span>
      <div className="text-[11px] text-[#633806] flex-1">
        {legacyCount} pre-classification {legacyCount === 1 ? 'item' : 'items'} moved to
        {' '}<span className="font-medium">NOOS · Legacy</span>. Reclassify as needed.
      </div>
      <button
        type="button"
        onClick={onReview}
        className="text-[11px] text-[#854F0B] underline hover:text-[#633806]"
      >
        Review
      </button>
    </div>
  );
}
