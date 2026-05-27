'use client';

/**
 * /v2/jobs/[id] — placeholder for the new job detail page (Slice 1C).
 *
 * Slice 1A ships this stub so links from the feed can resolve to *something*
 * during the dual-view validation phase. The real detail page lands in Slice 1C.
 *
 * 2026-05-27 (Phase 1 Slice 1A of dashboard redesign).
 */
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';

export default function V2JobDetailStub() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const jobId = params?.id || '';

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
          /v2/jobs/{jobId} · preview
        </div>
        <h1 className="text-3xl font-semibold text-neutral-900 mb-3">
          Job detail page coming in Slice 1C.
        </h1>
        <p className="text-neutral-500 mb-8 leading-relaxed">
          Five shot rows with big visuals and a tile-click modal.
          <br />
          For now, use the Classic results page.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href={`/jobs/${jobId}/results`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition-colors"
          >
            Open in Classic
          </Link>
          <Link
            href="/v2/jobs"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-neutral-300 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            ← Back to feed
          </Link>
        </div>
      </div>
    </Shell>
  );
}
