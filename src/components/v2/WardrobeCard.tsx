'use client';

/**
 * <WardrobeCard/> — single garment card in the v2 wardrobe grid.
 *
 * Four horizontal thumbs (flat front · fit front · fit back · 45° back-
 * right), name + SKU + category/gender chips below. Thumbs render at
 * ~80px wide on screen and use a `sizes="160px"` hint so the Next.js
 * image optimizer serves a 2x-density variant (~160px wide) instead of
 * the previous tiny 40px JPEG that looked pixelated.
 *
 * Slice 2C: the whole card is a link to /v2/wardrobe/[id] — the full
 * assessment page with all 6 fit angles, flats, metadata, and the
 * classify form.
 *
 * 2026-05-27 (Phase 2 Slice 2B + hotfix + Slice 2C of dashboard redesign).
 */
import Image from 'next/image';
import Link from 'next/link';

export interface WardrobeCardData {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  flatFrontUrl?: string;
  fitFrontUrl?: string;
  fitBackUrl?: string;
  fitBack45RightUrl?: string;
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: number; dropNumber: number };
  noosBucket?: string;
}

function Thumb({ src, alt, label }: { src?: string; alt: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <div className="relative aspect-[3/4] rounded-sm overflow-hidden bg-neutral-100">
        {src ? (
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 768px) 25vw, 160px"
            className="object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[9px] text-neutral-400">
            —
          </div>
        )}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-neutral-400 text-center">
        {label}
      </div>
    </div>
  );
}

export default function WardrobeCard({ item }: { item: WardrobeCardData }) {
  return (
    <Link
      href={`/v2/wardrobe/${item.wardrobeId}`}
      className="bg-white border border-neutral-200 rounded-md p-2.5 flex flex-col hover:border-neutral-300 transition-colors"
    >
      <div className="flex gap-1.5 mb-2.5">
        <Thumb src={item.flatFrontUrl} alt={`${item.name} flat front`} label="Flat" />
        <Thumb src={item.fitFrontUrl} alt={`${item.name} fit front`} label="Front" />
        <Thumb src={item.fitBackUrl} alt={`${item.name} fit back`} label="Back" />
        <Thumb src={item.fitBack45RightUrl} alt={`${item.name} 45 back right`} label="45° R" />
      </div>
      <div className="text-[12px] font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
      <div className="text-[10px] text-neutral-400 truncate" title={item.designNumber}>{item.designNumber || '—'}</div>
      <div className="flex gap-1.5 items-center mt-1.5">
        {item.category && (
          <span className="bg-neutral-100 text-neutral-600 text-[9px] px-1.5 py-px rounded-sm capitalize">
            {item.category}
          </span>
        )}
        {item.gender && (
          <span className="text-[9px] text-neutral-500 capitalize">{item.gender}</span>
        )}
        {item.classification === 'drop' && item.drop && (
          <span className="ml-auto text-[9px] text-[#26215C] bg-[#EEEDFE] px-1.5 py-px rounded-sm">
            {item.drop.year} · Q{item.drop.quarter} · D{item.drop.dropNumber}
          </span>
        )}
      </div>
    </Link>
  );
}
