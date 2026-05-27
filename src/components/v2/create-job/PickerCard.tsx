'use client';

/**
 * <PickerCard/> — shared wardrobe-item tile for the focus + styling
 * pickers. Click toggles selection. The selected variant shows a
 * checkmark + blue border.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import Image from 'next/image';
import type { WardrobeItemRef } from './wizard-types';

export default function PickerCard({
  item,
  selected,
  onClick,
}: {
  item: WardrobeItemRef;
  selected: boolean;
  onClick: () => void;
}) {
  const heroUrl = item.flatFrontUrl || item.fitFrontUrl;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative bg-white rounded-md p-2 text-left transition-colors ${
        selected
          ? 'border-2 border-[#378ADD]'
          : 'border border-neutral-200 hover:border-neutral-300'
      }`}
    >
      {selected && (
        <span className="absolute top-1.5 right-1.5 z-10 bg-[#185FA5] text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]">
          ✓
        </span>
      )}
      <div className="relative aspect-[3/4] bg-neutral-100 rounded-sm overflow-hidden mb-2">
        {heroUrl ? (
          <Image
            src={heroUrl}
            alt={item.name}
            fill
            sizes="(max-width: 768px) 33vw, 180px"
            className="object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400">no image</div>
        )}
      </div>
      <div className="text-[11px] font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
      <div className="text-[10px] text-neutral-400 truncate" title={item.designNumber}>{item.designNumber || ''}</div>
      <div className="text-[9px] text-neutral-400 capitalize mt-0.5">
        {item.category}{item.gender ? ` · ${item.gender}` : ''}
      </div>
    </button>
  );
}
