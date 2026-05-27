'use client';

/**
 * /v2/jobs — chronological feed (Slice 1B).
 *
 * Shell + filters strip (placeholder for now) + <ChronologicalFeed/>.
 * Slice 1C adds the tile-click modal so individual shot tiles open in
 * place instead of forcing a navigation to the job detail page.
 *
 * 2026-05-27 (Phase 1 Slice 1B of dashboard redesign).
 */
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Shell from '@/components/Shell';
import ChronologicalFeed from '@/components/v2/ChronologicalFeed';

export default function V2JobsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth/signin');
  }, [status, router]);

  if (status === 'loading' || !session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  const user = {
    email: session.user.email || '',
    name: session.user.name || '',
    role: (session.user as { role?: 'admin' | 'creator' }).role || 'creator',
  };

  return (
    <Shell user={user}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">Jobs</h1>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              Latest first. Click any row to open the job.
            </p>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">
            /v2 · Slice 1B
          </div>
        </div>
        <ChronologicalFeed />
      </div>
    </Shell>
  );
}
