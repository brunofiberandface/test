'use client';

/**
 * Pose pickers used in step 4 of the create-job wizard.
 *
 *   <M03TopPosePicker/> — Gender-specific (f-poses for women, m-poses for
 *     men). Drives the M01/M02 top-focus paint pass. Only visually
 *     impactful when the focus garment is a TOP; for bottom-focus jobs
 *     the value is still persisted so future top-focus reruns inherit it.
 *
 *   <M03PosePicker/> — Gender-agnostic library. Drives the M03 free pose
 *     shot. Always relevant.
 *
 * Both pickers default to "no selection" — backend then picks a sensible
 * default at generation time. User can explicitly pick to override.
 *
 * Mirrors the Classic /jobs/new picker UX. Reuses the existing
 * pose libraries (src/lib/m03-top-poses.ts, src/lib/m03-poses.ts) so
 * thumbnails + ids match exactly.
 *
 * 2026-05-27 (Phase 2 Slice 2D hotfix of dashboard redesign).
 */
import Image from 'next/image';
import { getM03TopPosesForGender, type M03TopPose } from '@/lib/m03-top-poses';
import { M03_POSES, type M03Pose } from '@/lib/m03-poses';

interface PoseTileProps {
  id: string;
  label: string;
  thumbnailUrl?: string;
  selected: boolean;
  onClick: () => void;
}

function PoseTile({ id, label, thumbnailUrl, selected, onClick }: PoseTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative bg-white rounded-md p-1.5 text-center transition-colors ${
        selected
          ? 'border-2 border-[#378ADD]'
          : 'border border-neutral-200 hover:border-neutral-300'
      }`}
    >
      {selected && (
        <span className="absolute top-1 right-1 z-10 bg-[#185FA5] text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px]">✓</span>
      )}
      <div className="relative aspect-[3/4] bg-neutral-100 rounded-sm overflow-hidden mb-1">
        {thumbnailUrl ? (
          <Image src={thumbnailUrl} alt={label} fill sizes="100px" className="object-cover object-top" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400">{id}</div>
        )}
      </div>
      <div className="text-[10px] font-medium text-neutral-900">{id}</div>
      <div className="text-[9px] text-neutral-500 truncate" title={label}>{label}</div>
    </button>
  );
}

export function M03TopPosePicker({
  modelGender,
  value,
  onChange,
}: {
  modelGender: 'female' | 'male' | undefined;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const poses: M03TopPose[] = getM03TopPosesForGender(modelGender);
  if (poses.length === 0) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="text-[14px] font-medium text-neutral-900 mb-1">Top-focus pose (M01 / M02)</div>
      <div className="text-[12px] text-neutral-500 mb-4">
        {modelGender === 'female'
          ? "Female model · one of the WOMEN catalog stances."
          : modelGender === 'male'
            ? "Male model · one of the MEN catalog stances."
            : 'Catalog stance — applies to the top-focus M01/M02 paint pass.'}
        {' '}Bottom-focus jobs use the standard standing pose; this picker still records your preference for any later top-focus reruns.
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-md p-1.5 text-center aspect-[3/4] flex items-center justify-center transition-colors ${
            value === null
              ? 'border-2 border-[#378ADD] bg-[#E6F1FB]'
              : 'border border-dashed border-neutral-300 hover:border-neutral-400 text-neutral-500'
          }`}
        >
          <span className="text-[11px] font-medium">Auto<br/><span className="text-[9px] font-normal opacity-75">backend default</span></span>
        </button>
        {poses.map(p => (
          <PoseTile
            key={p.id}
            id={p.id}
            label={p.label}
            thumbnailUrl={p.thumbnailUrl}
            selected={value === p.id}
            onClick={() => onChange(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function M03PosePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const poses: M03Pose[] = M03_POSES.filter(p => !p.hidden);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <div className="text-[14px] font-medium text-neutral-900 mb-1">Free pose (M03)</div>
      <div className="text-[12px] text-neutral-500 mb-4">
        Drives the M03 (Full Body / Functionality) shot. Gender-agnostic library.
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-md p-1.5 text-center aspect-[3/4] flex items-center justify-center transition-colors ${
            value === null
              ? 'border-2 border-[#378ADD] bg-[#E6F1FB]'
              : 'border border-dashed border-neutral-300 hover:border-neutral-400 text-neutral-500'
          }`}
        >
          <span className="text-[11px] font-medium">Auto<br/><span className="text-[9px] font-normal opacity-75">backend default</span></span>
        </button>
        {poses.map(p => (
          <PoseTile
            key={p.id}
            id={p.id}
            label={p.label}
            thumbnailUrl={p.thumbnailUrl}
            selected={value === p.id}
            onClick={() => onChange(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
