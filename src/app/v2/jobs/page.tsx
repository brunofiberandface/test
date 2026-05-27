'use client';

/**
 * /v2/jobs — placeholder for the chronological feed (Slice 1B).
 *
 * Slice 1A ships this stub so the dual-view plumbing (nav toggle + route
 * tree) can be validated in production before the real feed lands.
 * Bruno hits Classic ↔ New in the nav, lands here, sees the stub, switches
 * back. If that round-trip works without breaking Classic, Slice 1A is done.
 *
 * 2026-05-27 (Phase 1 Slice 1A of dashboard redesign).
 */
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';

export default function V2JobsStub() {
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
      <div className="max-w-2xl mx-auto py-24 text-center">
        <div className="text-xs uppercase tracking-widest text-neutral-400 mb-3">
          /v2 · preview
        </div>
        <h1 className="text-3xl font-semibold text-neutral-900 mb-3">
          New view is coming.
        </h1>
        <p className="text-neutral-500 mb-8 leading-relaxed">
          The chronological jobs feed lands in Slice 1B.
          <br />
          This stub proves the dual-view plumbing works end-to-end.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-neutral-300 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors"
        >
          ← Back to Classic
        </Link>
      </div>
    </Shell>
  );
}
