'use client';

/**
 * <WardrobeCard/> — single garment card in the v2 wardrobe grid.
 *
 * Layout: hero photo (60×80) on the left + 2×2 mosaic of fit-angle
 * thumbs on the right. Name + SKU + category/gender chip below.
 *
 * 2026-05-27 (Phase 2 Slice 2B of dashboard redesign).
 */
import Image from 'next/image';
import type { V2NoosBucket } from '@/lib/v2/wardrobe-classification';

export interface WardrobeCardData {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  thumbnailUrl?: string;
  fitModelThumbs: string[];
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: number; dropNumber: number };
  noosBucket?: V2NoosBucket;
}

function MaybeImage({ src, alt, className, sizes }: { src?: string; alt: string; className?: string; sizes?: string }) {
  if (!src) return <div className={`${className} bg-neutral-200`} />;
  return (
    <div className={`${className} relative bg-neutral-100 overflow-hidden`}>
      <Image src={src} alt={alt} fill sizes={sizes || '60px'} className="object-cover" loading="lazy" />
    </div>
  );
}

export default function WardrobeCard({ item }: { item: WardrobeCardData }) {
  const thumbs = item.fitModelThumbs.slice(0, 4);
  // Pad to exactly 4 entries (with undefineds) so the 2x2 grid always renders.
  while (thumbs.length < 4) thumbs.push('' as unknown as string);
  const isLegacy = item.classification === 'noos' && item.noosBucket === 'legacy';

  return (
    <div className="bg-white border border-neutral-200 rounded-md p-2.5 flex flex-col">
      <div className="flex gap-1.5 mb-2">
        <MaybeImage src={item.thumbnailUrl} alt={item.name} className="w-[60px] h-20 rounded-sm" sizes="60px" />
        <div className="grid grid-cols-2 gap-0.5 flex-1">
          {thumbs.map((src, i) => (
            <MaybeImage key={i} src={src || undefined} alt={`fit ${i + 1}`} className="aspect-square rounded-sm" sizes="40px" />
          ))}
        </div>
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
          <span className="text-[9px] text-neutral-400 capitalize">{item.gender}</span>
        )}
        {isLegacy && (
          <span className="ml-auto text-[9px] text-[#854F0B] bg-[#FAEEDA] px-1.5 py-px rounded-sm italic">
            legacy
          </span>
        )}
      </div>
    </div>
  );
}
