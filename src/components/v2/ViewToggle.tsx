'use client';

/**
 * <ViewToggle/> — segmented control in the Shell header.
 *
 * Lets users switch between the Classic dashboard (/dashboard) and the new
 * v2 jobs feed (/v2/jobs). Choice persists in localStorage so the user
 * stays on their preferred view across sessions. Defaults to Classic for
 * safety — users opt in to New by clicking it.
 *
 * 2026-05-27 (Phase 1 Slice 1A of dashboard redesign).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const STORAGE_KEY = 'gstar.viewMode';
const ROUTE_CLASSIC = '/dashboard';
const ROUTE_NEW = '/v2/jobs';

export default function ViewToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const onNew = !!pathname?.startsWith('/v2');

  // Persist last-chosen view so a fresh tab opens to the user's preference.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, onNew ? 'new' : 'classic');
  }, [onNew]);

  // On Shell mount, if the user is on the root or a non-toggled page and
  // their stored preference is 'new', send them there. Skip if we're already
  // on a v2 route, on Classic, or on a non-toggled admin/auth page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname?.startsWith('/v2')) return;
    if (pathname === ROUTE_CLASSIC) return;
    // Only auto-route from the top level — don't yank users out of
    // /jobs/[id]/results, /wardrobe, /models, etc.
    if (pathname && pathname !== '/') return;
    const pref = window.localStorage.getItem(STORAGE_KEY);
    if (pref === 'new') router.replace(ROUTE_NEW);
  }, [pathname, router]);

  return (
    <div className="flex items-center text-[11px] border border-neutral-200 rounded-md overflow-hidden">
      <Link
        href={ROUTE_CLASSIC}
        className={`px-2.5 py-1 transition-colors ${
          onNew ? 'text-neutral-500 hover:text-neutral-900' : 'bg-neutral-900 text-white'
        }`}
      >
        Classic
      </Link>
      <Link
        href={ROUTE_NEW}
        className={`px-2.5 py-1 transition-colors ${
          onNew ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'
        }`}
      >
        New
      </Link>
    </div>
  );
}
