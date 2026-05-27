'use client';

/**
 * /v2/jobs/new — 4-step create-job wizard.
 *
 *   1. Collection — Drop (year/Q/N) or NOOS
 *   2. Focus garment — items in the chosen collection
 *   3. Styling — NOOS items for the 2 non-focus slots
 *   4. Model — gender-filtered by focus, summary card, Run
 *
 * Submit posts to the existing /api/jobs endpoint (no new write API
 * needed; Phase 1 already enriches v2 reads from the same data).
 * On success → redirect to /v2/jobs/[id] so Bruno lands on the
 * v2 detail page where shots stream in.
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import Stepper from '@/components/v2/create-job/Stepper';
import CollectionPickerStep from '@/components/v2/create-job/CollectionPickerStep';
import FocusItemPickerStep from '@/components/v2/create-job/FocusItemPickerStep';
import StylingPickerStep from '@/components/v2/create-job/StylingPickerStep';
import ModelPickerStep from '@/components/v2/create-job/ModelPickerStep';
import {
  ALL_SLOTS, categoryToSlot, INITIAL_WIZARD_STATE,
  type SlotKey, type WizardState,
} from '@/components/v2/create-job/wizard-types';

export default function V2CreateJobPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const [step, setStep] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Completed = the highest step the user has finished (i.e. its required
  // picks are populated). Used by the Stepper to allow backward jumps.
  const completed = useMemo(() => {
    if (!state.collection) return 0;
    if (!state.focus) return 1;
    const focusSlot = categoryToSlot(state.focus.category);
    const unfilled = ALL_SLOTS.filter(s => s !== focusSlot);
    const stylingDone = unfilled.every(s => !!state.styling[s]);
    if (!stylingDone) return 2;
    if (!state.model) return 3;
    return 4;
  }, [state]);

  const canAdvance = completed >= step;

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  if (status === 'loading' || !session?.user) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Loading…</div>;
  }
  const user = {
    email: session.user.email || '',
    name: session.user.name || '',
    role: (session.user as { role?: 'admin' | 'creator' }).role || 'creator',
  };

  const onSubmit = async () => {
    if (!state.collection || !state.focus || !state.model) return;
    const focusSlot = categoryToSlot(state.focus.category);
    if (!focusSlot) {
      setSubmitError(`Focus item category "${state.focus.category}" can't be mapped to a slot.`);
      return;
    }
    // Build the wardrobe payload the existing /api/jobs POST expects.
    const wardrobe: Record<SlotKey, { itemId: string; isFocus: boolean }> = {
      shoe:   { itemId: '', isFocus: false },
      top:    { itemId: '', isFocus: false },
      bottom: { itemId: '', isFocus: false },
    };
    wardrobe[focusSlot] = { itemId: state.focus.wardrobeId, isFocus: true };
    for (const slot of ALL_SLOTS) {
      if (slot === focusSlot) continue;
      const it = state.styling[slot];
      if (!it) {
        setSubmitError(`Missing styling item for ${slot}.`);
        return;
      }
      wardrobe[slot] = { itemId: it.wardrobeId, isFocus: false };
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorEmail: user.email,
          modelId: state.model.modelId,
          wardrobe,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `responded ${r.status}`);
      }
      const j = await r.json();
      const jobId = j.jobId || j.id;
      if (jobId) {
        router.push(`/v2/jobs/${jobId}`);
      } else {
        router.push('/v2/jobs');
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  // Step component for the current step.
  const stepView = (() => {
    if (step === 1) {
      return (
        <CollectionPickerStep
          value={state.collection}
          onChange={collection => setState(s => ({ ...s, collection }))}
        />
      );
    }
    if (step === 2) {
      if (!state.collection) return <Empty msg="Pick a collection first." />;
      return (
        <FocusItemPickerStep
          collection={state.collection}
          value={state.focus}
          onChange={focus => setState(s => ({ ...s, focus, styling: {} }))}
        />
      );
    }
    if (step === 3) {
      if (!state.focus) return <Empty msg="Pick a focus garment first." />;
      return (
        <StylingPickerStep
          focus={state.focus}
          value={state.styling}
          onChange={styling => setState(s => ({ ...s, styling }))}
        />
      );
    }
    if (step === 4) {
      if (!state.focus || !state.collection) return <Empty msg="Earlier steps incomplete." />;
      return (
        <ModelPickerStep
          collection={state.collection}
          focus={state.focus}
          styling={state.styling}
          value={state.model}
          onChange={model => setState(s => ({ ...s, model }))}
        />
      );
    }
    return null;
  })();

  return (
    <Shell user={user}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-3">
            <Link href="/v2/jobs" className="text-[12px] text-neutral-500 hover:text-neutral-900">← Jobs</Link>
            <h1 className="text-xl font-semibold text-neutral-900">New job</h1>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">/v2 · Slice 2D</div>
        </div>

        <Stepper current={step} completed={completed} onJump={setStep} />

        {stepView}

        {submitError && (
          <div className="mt-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            Failed to create job: {submitError}
          </div>
        )}

        <div className="flex items-center justify-between mt-5">
          <button
            type="button"
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1 || submitting}
            className="text-[12px] text-neutral-500 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Back
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.min(4, s + 1))}
              disabled={!canAdvance}
              className="bg-neutral-900 text-white rounded-md px-4 py-2 text-[12px] font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canAdvance || submitting}
              className="bg-neutral-900 text-white rounded-md px-4 py-2 text-[12px] font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating job…' : 'Run job'}
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="bg-white border border-dashed border-neutral-200 rounded-lg p-6 text-center text-[12px] text-neutral-500">
      {msg}
    </div>
  );
}
