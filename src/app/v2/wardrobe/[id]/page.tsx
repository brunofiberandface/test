'use client';

/**
 * /v2/wardrobe/[id] — full wardrobe item assessment view.
 *
 * Left: 6 fit-model angles arranged as Classic does (45L / center / 45R
 * for both front and back rows) + the two flat product images.
 * Right: metadata (name, design code, category, gender, description),
 * the current classification chip, and the ClassifyForm.
 *
 * Plus quick links to the existing /wardrobe/[id]/label-setup and
 * /wardrobe/[id]/angle-setup tools so Bruno can drop into the same
 * Classic admin flows without leaving v2.
 *
 * 2026-05-27 (Phase 2 Slice 2C-classify of dashboard redesign).
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Shell from '@/components/Shell';
import ClassifyForm, { type ClassifyFormValue } from '@/components/v2/ClassifyForm';
import { formatDrop, type V2Quarter } from '@/lib/v2/wardrobe-classification';

interface WardrobeDetail {
  wardrobeId: string;
  name: string;
  designNumber?: string;
  category?: string;
  gender?: string;
  description?: string;
  flatFrontUrl?: string;
  flatBackUrl?: string;
  thumbnailUrl?: string;
  fitModels?: Partial<Record<
    'front' | 'front45Left' | 'front45Right' | 'back' | 'back45Left' | 'back45Right',
    string
  >>;
  classification: 'drop' | 'noos';
  drop?: { year: number; quarter: V2Quarter; dropNumber: number };
  noosBucket?: string;
  classifiedAt?: string;
  classifiedBy?: string;
  rawClassification?: 'drop' | 'noos';
  leatherLabelTemplateId?: string;
  pocketLabelTemplateId?: string;
  fitModels4K_count?: number;
  fitModels4K_populatedCount?: number;
  fitModels4K_all?: boolean;
  fitModels4K_auditedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const FIT_SLOTS: Array<{
  key: 'front' | 'front45Left' | 'front45Right' | 'back' | 'back45Left' | 'back45Right';
  label: string;
  row: 'front' | 'back';
}> = [
  { key: 'front45Left',  label: '45° Left',       row: 'front' },
  { key: 'front',        label: 'Front',          row: 'front' },
  { key: 'front45Right', label: '45° Right',      row: 'front' },
  { key: 'back45Left',   label: 'Back 45° Left',  row: 'back'  },
  { key: 'back',         label: 'Back',           row: 'back'  },
  { key: 'back45Right',  label: 'Back 45° Right', row: 'back'  },
];

function MaybeImage({ src, alt, sizes }: { src?: string; alt: string; sizes?: string }) {
  return (
    <div className="relative aspect-[3/4] bg-neutral-100 rounded overflow-hidden">
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes || '(max-width: 1024px) 33vw, 280px'}
          className="object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400">missing</div>
      )}
    </div>
  );
}

function ClassificationChip({ item }: { item: WardrobeDetail }) {
  if (item.classification === 'drop' && item.drop) {
    return (
      <span className="bg-[#E6F1FB] text-[#185FA5] text-[11px] font-medium px-2 py-0.5 rounded-sm">
        {formatDrop(item.drop)}
      </span>
    );
  }
  return (
    <span className="bg-[#E1F5EE] text-[#04342C] text-[11px] font-medium px-2 py-0.5 rounded-sm">
      NOOS · {item.category ? item.category[0].toUpperCase() + item.category.slice(1) : 'item'}
    </span>
  );
}

export default function V2WardrobeDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const wardrobeId = params?.id || '';

  const [item, setItem] = useState<WardrobeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  const loadItem = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch(`/api/v2/wardrobe/${wardrobeId}`);
      if (!r.ok) throw new Error(`responded ${r.status}`);
      const j = await r.json();
      setItem(j.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wardrobeId]);

  useEffect(() => {
    if (wardrobeId) loadItem();
  }, [wardrobeId, loadItem]);

  const onClassify = async (value: ClassifyFormValue) => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/v2/wardrobe/${wardrobeId}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text || `responded ${r.status}`);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      await loadItem();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || !session?.user) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Loading…</div>;
  }
  const user = {
    email: session.user.email || '',
    name: session.user.name || '',
    role: (session.user as { role?: 'admin' | 'creator' }).role || 'creator',
  };

  if (error) {
    return (
      <Shell user={user}>
        <div className="max-w-2xl mx-auto py-12 text-center">
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3 mb-4">
            Failed to load wardrobe item: {error}
          </div>
          <Link href="/v2/wardrobe" className="text-[12px] text-neutral-500 underline">← Back to wardrobe</Link>
        </div>
      </Shell>
    );
  }

  if (!item) {
    return (
      <Shell user={user}>
        <div className="text-sm text-neutral-400 py-12 text-center">Loading item…</div>
      </Shell>
    );
  }

  const front = FIT_SLOTS.filter(s => s.row === 'front');
  const back = FIT_SLOTS.filter(s => s.row === 'back');

  return (
    <Shell user={user}>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-3">
            <Link href="/v2/wardrobe" className="text-[12px] text-neutral-500 hover:text-neutral-900">← Wardrobe</Link>
            <div className="text-[15px] font-medium text-neutral-900">{item.name}</div>
            <span className="text-[12px] text-neutral-400">{item.designNumber || ''}</span>
            <ClassificationChip item={item} />
            {!item.rawClassification && (
              <span className="text-[10px] text-[#854F0B] bg-[#FAEEDA] italic px-1.5 py-px rounded-sm">
                inferred — save to confirm
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            {item.fitModels4K_all ? (
              <span className="bg-[#EAF3DE] text-[#173404] px-1.5 py-px rounded-sm">all angles 4K</span>
            ) : item.fitModels4K_populatedCount !== undefined ? (
              <span className="bg-[#FAEEDA] text-[#854F0B] px-1.5 py-px rounded-sm">
                {item.fitModels4K_populatedCount}/{6} angles 4K
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* IMAGES (left) */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Fit model · Front row</div>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {front.map(s => (
                <div key={s.key}>
                  <MaybeImage src={item.fitModels?.[s.key]} alt={`${item.name} ${s.label}`} />
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 text-center mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Fit model · Back row</div>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {back.map(s => (
                <div key={s.key}>
                  <MaybeImage src={item.fitModels?.[s.key]} alt={`${item.name} ${s.label}`} />
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 text-center mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Flat product</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <MaybeImage src={item.flatFrontUrl} alt={`${item.name} flat front`} />
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 text-center mt-1">Flat front</div>
              </div>
              <div>
                <MaybeImage src={item.flatBackUrl} alt={`${item.name} flat back`} />
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 text-center mt-1">Flat back</div>
              </div>
            </div>
          </div>

          {/* METADATA + CLASSIFY (right) */}
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-neutral-200 rounded-lg p-4">
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Details</div>
              <dl className="text-[12px] flex flex-col gap-1.5">
                <Row label="Name" value={item.name} />
                <Row label="Design #" value={item.designNumber || '—'} />
                <Row label="Category" value={item.category || '—'} capitalize />
                <Row label="Gender" value={item.gender || '—'} capitalize />
                {item.description && (
                  <div className="pt-1">
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">Description</div>
                    <div className="text-[12px] text-neutral-700 whitespace-pre-wrap">{item.description}</div>
                  </div>
                )}
              </dl>
            </div>

            <div className="bg-white border border-neutral-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400">Classification</div>
                {savedFlash && (
                  <span className="text-[10px] text-[#173404] bg-[#EAF3DE] px-1.5 py-px rounded-sm">saved</span>
                )}
              </div>
              <div className="text-[12px] text-neutral-700 mb-3">
                {item.classifiedBy
                  ? <>Last set by <span className="text-neutral-900">{item.classifiedBy}</span>{item.classifiedAt ? ` · ${new Date(item.classifiedAt).toLocaleDateString()}` : ''}</>
                  : 'Not yet classified.'}
              </div>
              <ClassifyForm
                initial={{ classification: item.classification, drop: item.drop }}
                category={item.category}
                busy={saving}
                errorMessage={saveError}
                onSubmit={onClassify}
              />
            </div>

            <div className="bg-white border border-neutral-200 rounded-lg p-4">
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Tools</div>
              <div className="flex flex-col gap-1">
                <Link
                  href={`/wardrobe/${item.wardrobeId}/angle-setup`}
                  className="text-[12px] text-neutral-700 hover:text-neutral-900 underline"
                >
                  Angle setup
                </Link>
                <Link
                  href={`/wardrobe/${item.wardrobeId}/label-setup`}
                  className="text-[12px] text-neutral-700 hover:text-neutral-900 underline"
                >
                  Label setup
                </Link>
                <Link
                  href={`/wardrobe`}
                  className="text-[12px] text-neutral-400 hover:text-neutral-700"
                >
                  Open in Classic wardrobe
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Row({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-400">{label}</dt>
      <dd className={`text-neutral-900 text-right ${capitalize ? 'capitalize' : ''}`}>{value}</dd>
    </div>
  );
}
