'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import ViewToggle from '@/components/v2/ViewToggle';

interface ShellProps {
  children: React.ReactNode;
  user?: { email: string; name: string; role: 'admin' | 'creator' };
}

// Map of Classic href → v2 href. When the user is currently on a /v2/*
// route, nav items in this map navigate to the v2 equivalent so the user
// stays in v2 instead of bouncing between Classic and New.
//
// Phase 2 Slice 2B: only Wardrobe has a v2 destination. Add more entries
// as later slices ship (e.g. /jobs/new → /v2/jobs/new in Slice 2D).
const V2_NAV_MAP: Record<string, string> = {
  '/wardrobe': '/v2/wardrobe',
  '/jobs/new': '/v2/jobs/new',
};

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin', 'creator'] },
  { href: '/jobs/new', label: 'New Job', roles: ['admin', 'creator'], exact: true },
  { href: '/models', label: 'Models', roles: ['admin', 'creator'] },
  { href: '/wardrobe', label: 'Wardrobe', roles: ['admin', 'creator'] },
  { href: '/labels', label: 'Labels', roles: ['admin'] },
  { href: '/qa/shoe-matrix', label: 'QA Matrix', roles: ['admin'] },
  { href: '/admin/monitoring', label: 'Monitoring', roles: ['admin'] },
  { href: '/prompt-vault', label: 'Prompt Vault', roles: ['admin'] },
  { href: '/admin/users', label: 'Users', roles: ['admin'] },
];

export default function Shell({ children, user }: ShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="h-14 border-b border-neutral-200 flex items-center px-6 justify-between bg-white sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-neutral-900">G-STAR</span>
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-widest">AI Studio</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS
              .filter(item => !user || item.roles.includes(user.role))
              .map(item => {
                const onV2 = pathname?.startsWith('/v2');
                const href = onV2 && V2_NAV_MAP[item.href] ? V2_NAV_MAP[item.href] : item.href;
                const active = item.exact
                  ? pathname === href || pathname === item.href
                  : pathname?.startsWith(href) || pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={href}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'text-neutral-900 font-medium'
                        : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
          </nav>
        </div>

        {user && (
          <div className="flex items-center gap-4">
            <ViewToggle />
            <span className="text-xs text-neutral-500">{user.email}</span>
            <span className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-600 uppercase tracking-wider">
              {user.role}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="text-xs text-neutral-400 hover:text-neutral-900 transition-colors ml-2"
            >
              Logout
            </button>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 bg-neutral-50">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-3 text-center border-t border-neutral-200 bg-white">
        <a
          href="https://fiberandface.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Powered by fiberandface.com
        </a>
      </footer>
    </div>
  );
}
