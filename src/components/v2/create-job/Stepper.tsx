/**
 * <Stepper/> — horizontal step indicator with title + thin bar segments.
 *
 * Lets users see where they are and lets them jump backward to any
 * earlier step. Forward jumps are blocked (each step must be completed
 * before the next is reachable).
 *
 * 2026-05-27 (Phase 2 Slice 2D of dashboard redesign).
 */
import { TOTAL_STEPS } from './wizard-types';

export interface StepperProps {
  current: number;        // 1..TOTAL_STEPS
  completed: number;      // highest step index the user has finished
  onJump?: (step: number) => void;
}

const STEP_LABELS = [
  'Collection',
  'Focus garment',
  'Styling',
  'Model',
];

export default function Stepper({ current, completed, onJump }: StepperProps) {
  return (
    <div className="mb-6">
      <div className="flex gap-2 items-center mb-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const step = i + 1;
          const active = step === current;
          const isDone = step <= completed;
          const reachable = step <= completed + 1;
          return (
            <button
              key={step}
              type="button"
              onClick={() => reachable && onJump?.(step)}
              disabled={!reachable}
              className={`flex-1 h-1 rounded-full transition-colors disabled:cursor-not-allowed ${
                active
                  ? 'bg-neutral-900'
                  : isDone
                    ? 'bg-[#97C459]'
                    : 'bg-neutral-200'
              }`}
              aria-label={`Step ${step}: ${STEP_LABELS[i]}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-neutral-400">
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const active = step === current;
          return (
            <span
              key={label}
              className={`flex-1 ${i === 0 ? 'text-left' : i === STEP_LABELS.length - 1 ? 'text-right' : 'text-center'} ${
                active ? 'text-neutral-900 font-medium' : ''
              }`}
            >
              {step}. {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
