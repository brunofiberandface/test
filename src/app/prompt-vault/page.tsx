'use client';

import { useState, useEffect, useRef } from 'react';

interface PromptFile {
  id: string;
  filename: string;
  shotType: string;
  revision: number;
  isActive: boolean;
  isAlternative?: boolean;
  label?: string;
  content?: string;
  uploadedAt: string;
  uploadedBy?: string;
  pipeline?: 'gemini' | 'seedream';
}

const SHOT_TYPES = ['M01', 'M02', 'M03', 'M04', 'M05'];
const SHOT_LABELS: Record<string, string> = {
  M01: 'Cropped Front',
  M02: 'Cropped Back',
  M03: 'Full Body Front',
  M04: 'Full Body Back',
  M05: 'Detail (Pocket)',
};

export default function PromptVaultPage() {
  const [prompts, setPrompts] = useState<PromptFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterKind, setFilterKind] = useState<'all' | 'base' | 'alternative'>('all');
  const [filterPipeline, setFilterPipeline] = useState<'all' | 'gemini' | 'seedream'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Upload form state
  const [uploadShotType, setUploadShotType] = useState('M01');
  const [uploadIsAlternative, setUploadIsAlternative] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadPipeline, setUploadPipeline] = useState<'' | 'gemini' | 'seedream'>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchPrompts = async () => {
    try {
      const res = await fetch('/api/prompt-vault');
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch (err) {
      console.error('Failed to fetch prompts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('shotType', uploadShotType);
      formData.append('uploadedBy', 'admin');
      formData.append('isAlternative', String(uploadIsAlternative));
      if (uploadIsAlternative && uploadLabel) {
        formData.append('label', uploadLabel);
      }
      if (uploadPipeline) {
        formData.append('pipeline', uploadPipeline);
      }

      const res = await fetch('/api/prompt-vault', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      // Reset form
      setShowUpload(false);
      setUploadLabel('');
      setUploadIsAlternative(false);
      setUploadPipeline('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchPrompts();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const filtered = prompts.filter(p => {
    if (filterType !== 'all' && p.shotType !== filterType) return false;
    if (filterKind === 'base' && p.isAlternative) return false;
    if (filterKind === 'alternative' && !p.isAlternative) return false;
    if (filterPipeline !== 'all') {
      // 'gemini' matches docs without pipeline field (legacy) or with pipeline='gemini'
      if (filterPipeline === 'gemini' && p.pipeline && p.pipeline !== 'gemini') return false;
      if (filterPipeline === 'seedream' && p.pipeline !== 'seedream') return false;
    }
    return true;
  });

  // Group by shot type
  const grouped: Record<string, PromptFile[]> = {};
  for (const p of filtered) {
    if (!grouped[p.shotType]) grouped[p.shotType] = [];
    grouped[p.shotType].push(p);
  }

  const extractStep2Preview = (content: string | undefined) => {
    if (!content) return '';
    const idx = content.indexOf('OBJECTIVE:');
    if (idx === -1) return content.substring(0, 200) + '...';
    return content.substring(idx, idx + 200) + '...';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Prompt Vault</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {prompts.filter(p => !p.isAlternative && p.isActive && p.pipeline !== 'seedream').length} Gemini active,{' '}
            {prompts.filter(p => !p.isAlternative && p.isActive && p.pipeline === 'seedream').length} Seedream active,{' '}
            {prompts.filter(p => p.isAlternative).length} alternatives
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="px-4 py-2 bg-neutral-900 text-white text-sm rounded-lg hover:bg-neutral-800 transition-colors"
        >
          {showUpload ? 'Cancel' : 'Upload Prompt'}
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="bg-white border border-neutral-200 rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-neutral-900 mb-4">Upload New Prompt</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Shot Type</label>
              <select
                value={uploadShotType}
                onChange={e => setUploadShotType(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
              >
                {SHOT_TYPES.map(st => (
                  <option key={st} value={st}>{st} — {SHOT_LABELS[st]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Prompt Type</label>
              <div className="flex items-center gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!uploadIsAlternative}
                    onChange={() => setUploadIsAlternative(false)}
                    className="accent-neutral-900"
                  />
                  Base (replaces active)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={uploadIsAlternative}
                    onChange={() => setUploadIsAlternative(true)}
                    className="accent-blue-600"
                  />
                  Alternative (rerun only)
                </label>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-neutral-600 mb-1">Pipeline</label>
            <div className="flex items-center gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pipeline"
                  checked={uploadPipeline === ''}
                  onChange={() => setUploadPipeline('')}
                  className="accent-neutral-900"
                />
                Gemini (default)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pipeline"
                  checked={uploadPipeline === 'seedream'}
                  onChange={() => setUploadPipeline('seedream')}
                  className="accent-purple-600"
                />
                Seedream
              </label>
            </div>
          </div>

          {uploadIsAlternative && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Button Label (shown on results page)
              </label>
              <input
                type="text"
                value={uploadLabel}
                onChange={e => setUploadLabel(e.target.value)}
                placeholder="e.g. Color Fidelity, Top Enforcement, Fit Wide/Loose..."
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-medium text-neutral-600 mb-1">Prompt File (.md)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-neutral-100 file:text-neutral-700 hover:file:bg-neutral-200"
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 bg-neutral-900 text-white text-sm rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              filterType === 'all' ? 'bg-white text-neutral-900 shadow-sm font-medium' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            All Types
          </button>
          {SHOT_TYPES.map(st => (
            <button
              key={st}
              onClick={() => setFilterType(st)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                filterType === st ? 'bg-white text-neutral-900 shadow-sm font-medium' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          {(['all', 'base', 'alternative'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilterKind(k)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors capitalize ${
                filterKind === k ? 'bg-white text-neutral-900 shadow-sm font-medium' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {k === 'all' ? 'All' : k === 'base' ? 'Base Prompts' : 'Alternatives'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          {(['all', 'gemini', 'seedream'] as const).map(p => (
            <button
              key={p}
              onClick={() => setFilterPipeline(p)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                filterPipeline === p ? 'bg-white text-neutral-900 shadow-sm font-medium' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {p === 'all' ? 'All Pipelines' : p === 'gemini' ? 'Gemini' : 'Seedream'}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt list */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 text-neutral-400">No prompts match your filters</div>
      ) : (
        <div className="space-y-6">
          {SHOT_TYPES.filter(st => grouped[st]?.length).map(st => (
            <div key={st}>
              <h3 className="text-sm font-semibold text-neutral-700 mb-3">
                {st} — {SHOT_LABELS[st]}
              </h3>
              <div className="space-y-2">
                {grouped[st].map(p => {
                  const isExpanded = expandedId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`bg-white border rounded-xl transition-all ${
                        p.isAlternative
                          ? 'border-blue-200 hover:border-blue-300'
                          : p.isActive
                          ? 'border-green-200 hover:border-green-300'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        <div className="flex items-center gap-3">
                          {/* Status badge */}
                          {p.isAlternative ? (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700 rounded-full">
                              Alternative
                            </span>
                          ) : p.isActive ? (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-green-50 text-green-700 rounded-full">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-neutral-100 text-neutral-500 rounded-full">
                              Inactive
                            </span>
                          )}

                          {/* Pipeline badge */}
                          {p.pipeline === 'seedream' ? (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-purple-50 text-purple-700 rounded-full">
                              Seedream
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 rounded-full">
                              Gemini
                            </span>
                          )}

                          <div>
                            <span className="text-sm font-medium text-neutral-900">
                              {p.isAlternative && p.label ? p.label : p.filename}
                            </span>
                            <span className="ml-2 text-xs text-neutral-400">rev {p.revision}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs text-neutral-400">
                            {p.uploadedAt ? new Date(p.uploadedAt).toLocaleDateString() : '—'}
                          </span>
                          <svg
                            className={`w-4 h-4 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && p.content && (
                        <div className="border-t border-neutral-100 px-4 py-4">
                          <div className="text-xs text-neutral-500 mb-2 flex items-center gap-4">
                            <span>{p.content.length} chars</span>
                            {p.uploadedBy && <span>by {p.uploadedBy}</span>}
                          </div>
                          <pre className="text-xs text-neutral-700 bg-neutral-50 rounded-lg p-4 overflow-auto max-h-[500px] whitespace-pre-wrap font-mono leading-relaxed">
                            {p.content}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
