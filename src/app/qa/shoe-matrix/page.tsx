'use client';

import { useEffect, useState, useCallback } from 'react';
import Shell from '@/components/Shell';

interface WardrobeShoe {
  id: string;
  name: string;
  flatFrontUrl?: string;
  category: string;
  gender?: 'male' | 'female';
}

interface ModelLite {
  id: string;
  name?: string;
  cardImageUrl?: string;
  active?: boolean;
  gender?: 'male' | 'female';
}

interface MatrixCell {
  id: string;
  shoeId: string;
  modelId: string;
  imageUrl?: string;
  status: 'pending' | 'rendering' | 'done' | 'failed';
  blocked: boolean;
  blockedReason?: string;
  errorMessage?: string;
}

export default function ShoeMatrixPage() {
  const [shoes, setShoes] = useState<WardrobeShoe[]>([]);
  const [models, setModels] = useState<ModelLite[]>([]);
  const [selectedShoeId, setSelectedShoeId] = useState<string | null>(null);
  const [cells, setCells] = useState<MatrixCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [renderingCells, setRenderingCells] = useState<Set<string>>(new Set());

  const fetchShoes = useCallback(async () => {
    const res = await fetch('/api/wardrobe?category=shoes');
    const data = await res.json();
    const items = (data.items || []) as WardrobeShoe[];
    setShoes(items);
  }, []);

  const fetchModels = useCallback(async () => {
    const res = await fetch('/api/models');
    const data = await res.json();
    const all = (data.models || []) as ModelLite[];
    setModels(all.filter(m => m.active !== false));
  }, []);

  const fetchCells = useCallback(async (shoeId: string) => {
    const res = await fetch(`/api/qa/shoe-matrix?shoeId=${encodeURIComponent(shoeId)}`);
    const data = await res.json();
    setCells((data.cells || []) as MatrixCell[]);
  }, []);

  useEffect(() => {
    Promise.all([fetchShoes(), fetchModels()]).finally(() => setLoading(false));
  }, [fetchShoes, fetchModels]);

  useEffect(() => {
    if (selectedShoeId) fetchCells(selectedShoeId);
    else setCells([]);
  }, [selectedShoeId, fetchCells]);

  // Poll for status updates while any cell is rendering.
  useEffect(() => {
    if (!selectedShoeId) return;
    if (renderingCells.size === 0) return;
    const interval = setInterval(() => fetchCells(selectedShoeId), 5000);
    return () => clearInterval(interval);
  }, [selectedShoeId, renderingCells, fetchCells]);

  function cellFor(modelId: string): MatrixCell | undefined {
    return cells.find(c => c.modelId === modelId);
  }

  async function renderCell(modelId: string) {
    if (!selectedShoeId) return;
    const id = `${selectedShoeId}_${modelId}`;
    setRenderingCells(prev => new Set(prev).add(id));
    try {
      const res = await fetch('/api/qa/shoe-matrix/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoeId: selectedShoeId, modelId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Render failed: ${data.error || res.statusText}`);
      }
    } finally {
      setRenderingCells(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedShoeId) fetchCells(selectedShoeId);
    }
  }

  async function renderAllForShoe() {
    if (!selectedShoeId) return;
    if (!confirm(`Render ${visibleModels.length} cells for this shoe? ~$${(visibleModels.length * 0.04).toFixed(2)}, ~${Math.ceil(visibleModels.length * 40 / 60)} min.`)) return;
    for (const m of visibleModels) {
      // Skip if already done and not failed.
      const existing = cellFor(m.id);
      if (existing && existing.status === 'done') continue;
      await renderCell(m.id);
    }
  }

  async function toggleBlock(modelId: string, currentlyBlocked: boolean) {
    if (!selectedShoeId) return;
    const id = `${selectedShoeId}_${modelId}`;
    let reason: string | null = null;
    if (!currentlyBlocked) {
      reason = prompt('Reason for blocking this combo?', 'shoe scale wrong on this model');
      if (reason === null) return;
    }
    const res = await fetch(`/api/qa/shoe-matrix/${encodeURIComponent(id)}/block`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked: !currentlyBlocked, reason }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(`Block toggle failed: ${data.error || res.statusText}`);
    }
    fetchCells(selectedShoeId);
  }

  const selectedShoe = shoes.find(s => s.id === selectedShoeId);
  // Filter models to match the selected shoe's gender. Every shoe has a gender
  // (male/female) — only render the corresponding models for the matrix.
  // If a shoe has no gender field set (legacy items), fall back to showing all.
  const visibleModels = (selectedShoe?.gender)
    ? models.filter(m => m.gender === selectedShoe.gender)
    : models;

  return (
    <Shell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-neutral-900 mb-2">QA — Shoe × Model Matrix</h1>
        <p className="text-sm text-neutral-600 mb-6">
          Pre-render each model wearing each shoe (basics + shoes, no jeans) to verify shoe scale and fit per
          combination. Block bad combos so the new-job wizard warns when picking them.
        </p>

        {loading && <div className="text-neutral-500">Loading…</div>}

        {!loading && (
          <div className="grid grid-cols-12 gap-6">
            {/* Shoe list */}
            <div className="col-span-3 border-r border-neutral-200 pr-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3">Shoes ({shoes.length})</h2>
              <div className="space-y-1">
                {shoes.map(shoe => (
                  <button
                    key={shoe.id}
                    onClick={() => setSelectedShoeId(shoe.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 hover:bg-neutral-100 ${selectedShoeId === shoe.id ? 'bg-neutral-100 font-medium' : ''}`}
                  >
                    {shoe.flatFrontUrl && (
                      <img src={shoe.flatFrontUrl} alt="" className="w-10 h-10 object-contain bg-neutral-50 border border-neutral-200" />
                    )}
                    <span className="flex-1 truncate">{shoe.name}</span>
                    {shoe.gender && (
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${shoe.gender === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>{shoe.gender === 'female' ? 'F' : 'M'}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Matrix cells for selected shoe */}
            <div className="col-span-9">
              {!selectedShoeId && (
                <div className="text-neutral-500 text-sm">Pick a shoe to see / render its model matrix.</div>
              )}
              {selectedShoeId && selectedShoe && (
                <>
                  <div className="flex items-start justify-between mb-4 gap-4">
                    <div className="flex items-center gap-3">
                      {selectedShoe.flatFrontUrl && (
                        <img src={selectedShoe.flatFrontUrl} alt="" className="w-16 h-16 object-contain bg-neutral-50 border border-neutral-200" />
                      )}
                      <div>
                        <h2 className="text-lg font-bold">{selectedShoe.name}</h2>
                        <p className="text-xs text-neutral-500">
                          {selectedShoe.gender ? <span className="uppercase tracking-wider mr-2">{selectedShoe.gender}</span> : null}
                          {visibleModels.length} {selectedShoe.gender || ''} models · {cells.filter(c => c.status === 'done').length} rendered · {cells.filter(c => c.blocked).length} blocked
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={renderAllForShoe}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-medium"
                    >
                      Render all missing
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-4">
                    {visibleModels.map(m => {
                      const cell = cellFor(m.id);
                      const cellRenderId = `${selectedShoeId}_${m.id}`;
                      const isLocallyRendering = renderingCells.has(cellRenderId);
                      const status = cell?.status || (isLocallyRendering ? 'rendering' : 'pending');
                      return (
                        <div
                          key={m.id}
                          className={`border rounded overflow-hidden ${cell?.blocked ? 'border-red-400 bg-red-50' : 'border-neutral-200 bg-white'}`}
                        >
                          <div className="aspect-[3/4] bg-neutral-100 relative">
                            {cell?.imageUrl && status === 'done' && (
                              <img src={cell.imageUrl} alt="" className="w-full h-full object-contain" />
                            )}
                            {!cell?.imageUrl && status === 'pending' && (
                              <div className="w-full h-full flex items-center justify-center text-neutral-400 text-sm">not rendered</div>
                            )}
                            {status === 'rendering' && (
                              <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">rendering…</div>
                            )}
                            {status === 'failed' && (
                              <div className="w-full h-full flex items-center justify-center text-red-600 text-xs p-2 text-center">failed: {cell?.errorMessage}</div>
                            )}
                            {cell?.blocked && (
                              <div className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">blocked</div>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-2">
                              {m.cardImageUrl && (
                                <img src={m.cardImageUrl} alt="" className="w-6 h-6 object-cover rounded-full" />
                              )}
                              <div className="text-sm font-medium truncate">{m.name || m.id}</div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => renderCell(m.id)}
                                disabled={status === 'rendering'}
                                className="flex-1 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 text-xs px-2 py-1 rounded"
                              >
                                {status === 'done' ? 'Re-render' : 'Render'}
                              </button>
                              {status === 'done' && (
                                <button
                                  onClick={() => toggleBlock(m.id, cell?.blocked || false)}
                                  className={`text-xs px-2 py-1 rounded ${cell?.blocked ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-neutral-100 hover:bg-neutral-200'}`}
                                >
                                  {cell?.blocked ? 'Unblock' : 'Block'}
                                </button>
                              )}
                            </div>
                            {cell?.blocked && cell.blockedReason && (
                              <p className="text-[10px] text-red-700 mt-1">{cell.blockedReason}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
