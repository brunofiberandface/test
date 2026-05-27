'use client';

/**
 * <GlobalSearch/> — cmd-K / ctrl-K global search modal.
 *
 * Lives in Shell so it's reachable from every page. Listens for the
 * keyboard shortcut, opens a modal with a search input, debounces
 * requests to /api/v2/search, renders grouped results (jobs / wardrobe
 * / models). Keyboard navigable: arrow keys move the focused row,
 * enter navigates.
 *
 * 2026-05-27 (Phase 3 Slice 3C of dashboard redesign).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  rank: number;
}

interface SearchResponse {
  query: string;
  jobs: SearchHit[];
  wardrobe: SearchHit[];
  models: SearchHit[];
}

const EMPTY: SearchResponse = { query: '', jobs: [], wardrobe: [], models: [] };

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [resp, setResp] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // cmd-K / ctrl-K to open. Escape to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when opened.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (!open) {
      // Reset state when closing so the next open is fresh.
      setQuery('');
      setResp(EMPTY);
      setActiveIndex(0);
      setError(null);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResp(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/v2/search?q=${encodeURIComponent(q)}`);
        if (!r.ok) throw new Error(`responded ${r.status}`);
        const j: SearchResponse = await r.json();
        if (!cancelled) {
          setResp(j);
          setActiveIndex(0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, open]);

  // Flatten results for keyboard navigation.
  const flatResults = useMemo(() => {
    return [
      ...resp.jobs.map(h => ({ group: 'Jobs', ...h })),
      ...resp.wardrobe.map(h => ({ group: 'Wardrobe', ...h })),
      ...resp.models.map(h => ({ group: 'Models', ...h })),
    ];
  }, [resp]);

  const navigate = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  // Arrow keys + Enter.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(flatResults.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const hit = flatResults[activeIndex];
      if (hit) {
        e.preventDefault();
        navigate(hit.href);
      }
    }
  };

  // Render a result group.
  const renderGroup = (label: string, hits: SearchHit[], baseIndex: number) => {
    if (hits.length === 0) return null;
    return (
      <div key={label}>
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 px-3 pt-2 pb-1">
          {label} <span className="text-neutral-300">{hits.length}</span>
        </div>
        {hits.map((h, i) => {
          const idx = baseIndex + i;
          const active = idx === activeIndex;
          return (
            <Link
              key={h.id}
              href={h.href}
              onClick={() => setOpen(false)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] transition-colors ${
                active ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              }`}
            >
              <span className="truncate">
                <span className="text-neutral-900 font-medium">{h.title}</span>
                {h.subtitle && <span className="text-neutral-500"> · {h.subtitle}</span>}
              </span>
              {active && <span className="text-neutral-400 text-[11px]">↵</span>}
            </Link>
          );
        })}
      </div>
    );
  };

  // Trigger button — small icon in the Shell header.
  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="hidden md:flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-900 border border-neutral-200 rounded-md px-2 py-1 hover:border-neutral-300 transition-colors"
      title="Search (⌘K)"
    >
      <span>Search</span>
      <span className="text-[10px] text-neutral-400">⌘K</span>
    </button>
  );

  // Modal (rendered conditionally).
  const modal = open && (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-lg border border-neutral-200 shadow-xl w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-neutral-200">
          <span className="text-neutral-400 text-[14px]">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search SKU, model, garment, design code…"
            className="flex-1 text-[14px] outline-none placeholder:text-neutral-400 bg-transparent"
          />
          {loading && <span className="text-[11px] text-neutral-400">…</span>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-neutral-400 hover:text-neutral-900 text-[12px] px-1"
            aria-label="Close"
          >
            esc
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-1">
          {error && (
            <div className="px-3 py-3 text-[12px] text-red-600">
              Search failed: {error}
            </div>
          )}
          {!error && query.trim().length < 2 && (
            <div className="px-3 py-6 text-[12px] text-neutral-400 text-center">
              Type at least 2 characters. Searches jobs, wardrobe, and models.
            </div>
          )}
          {!error && query.trim().length >= 2 && flatResults.length === 0 && !loading && (
            <div className="px-3 py-6 text-[12px] text-neutral-400 text-center">
              No results for &quot;{query.trim()}&quot;.
            </div>
          )}
          {!error && flatResults.length > 0 && (
            <>
              {renderGroup('Jobs', resp.jobs, 0)}
              {renderGroup('Wardrobe', resp.wardrobe, resp.jobs.length)}
              {renderGroup('Models', resp.models, resp.jobs.length + resp.wardrobe.length)}
            </>
          )}
        </div>

        <div className="border-t border-neutral-200 px-3 py-1.5 text-[10px] text-neutral-400 flex justify-between">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>v2 search</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {trigger}
      {modal}
    </>
  );
}
