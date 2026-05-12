'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';

// RESTORED 2026-05-10 from commit d2cb22c^ (deleted in d2cb22c "v2 Pro pipeline"
// rewrite, April 4 2026). Every existing model in the system was originally
// created via this flow. Per Bruno: "i want the same as how they were created."
// Two minor adaptations from the original v1: (1) the POST body field is
// `referenceImageUrl` (current /api/models POST handler signature) instead of
// the legacy `cardImageUrl`; (2) post-save redirects to `/models/${modelId}`
// instead of `/models`, so the operator lands on the new model's detail page.
export default function CreateModelPage() {
  const { data: session } = useSession();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const user = session?.user
    ? { email: session.user.email || '', name: session.user.name || '', role: (sessionAny?.role as 'admin' | 'creator') || 'creator' }
    : { email: 'loading...', name: '', role: 'creator' as const };

  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('female');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!description) return;
    setGenerating(true);
    setError('');
    setGeneratedImage(null);

    try {
      const res = await fetch('/api/models/generate-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, gender }),
      });
      const data = await res.json();

      if (data.success && data.image) {
        setGeneratedImage(data.image);
      } else {
        setError(data.error || 'Generation failed');
      }
    } catch {
      setError('Connection error');
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!modelId || !name || !description || !generatedImage) return;
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId,
          name,
          description,
          gender,
          referenceImageUrl: `data:image/png;base64,${generatedImage}`,
          createdBy: user.email,
        }),
      });
      const data = await res.json();

      if (data.success) {
        router.push(`/models/${modelId}`);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Save failed');
    }
    setSaving(false);
  };

  return (
    <Shell user={user}>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-neutral-900 mb-2">Create New Model</h1>
        <p className="text-sm text-neutral-500 mb-8">
          Define a new AI model identity. The model card will always show the model in a neutral athletic base layer — this is the mandatory foundation for all AI models.
        </p>

        <div className="space-y-6">
          {/* Base layer notice */}
          <div className="bg-neutral-50 border border-neutral-200 p-4">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
              Base Layer — Automatic
            </p>
            <p className="text-sm text-neutral-700">
              {gender === 'male'
                ? 'Bare torso + black compression shorts (mid-thigh, fitted) — barefoot on the seamless infinity cove backdrop'
                : 'Black sports bra (plain, no logos) + black compression shorts (mid-thigh, fitted) — barefoot on the seamless infinity cove backdrop'
              }
            </p>
            <p className="text-xs text-neutral-400 mt-1">
              Every model is generated in this neutral base layer to match the existing roster. This cannot be changed.
            </p>
          </div>

          {/* Model ID & Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Model ID
              </label>
              <input
                type="text"
                value={modelId}
                onChange={e => setModelId(e.target.value.toUpperCase())}
                placeholder="e.g., F6 or M5"
                className="w-full border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Mediterranean Grace"
                className="w-full border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              Gender
            </label>
            <div className="flex gap-2">
              {(['female', 'male'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    gender === g
                      ? 'bg-neutral-900 text-white'
                      : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {g === 'female' ? 'Woman' : 'Man'}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              Full Description
            </label>
            <p className="text-xs text-neutral-400 mb-2">
              Describe the model in detail: ethnicity, age, height, build, hair, eyes, expression, attitude.
              The AI will generate them in the standard base layer automatically.
            </p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={10}
              placeholder={`Example:\nEuropean woman (Mediterranean type), mid 20s, 175cm tall with athletic build.\nDark brown wavy hair past shoulders, olive skin with warm undertone.\nDark brown eyes, strong eyebrows, full lips.\nExpression: confident warmth, direct gaze, subtle smile.\nBODY SHAPE: Natural feminine curves, athletic legs.`}
              className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900 resize-none"
            />
          </div>

          {/* Generate */}
          <div className="border-t border-neutral-200 pt-6">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
              Model Card — in Neutral Base Layer
            </p>
            <button
              onClick={handleGenerate}
              disabled={!description || generating}
              className="bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              {generating ? 'Generating (30-60s)...' : 'Generate Model Card'}
            </button>

            {/* Preview */}
            {generatedImage && (
              <div className="mt-6 flex gap-6 items-start">
                <div className="w-56 aspect-[3/4] bg-neutral-100 border border-neutral-200 overflow-hidden">
                  <img
                    src={`data:image/png;base64,${generatedImage}`}
                    alt="Generated model card"
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <div className="space-y-3">
                  <button
                    onClick={handleSave}
                    disabled={!modelId || !name || saving}
                    className="block bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-30"
                  >
                    {saving ? 'Saving...' : 'Approve & Save'}
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="block border border-neutral-300 px-5 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
                  >
                    Regenerate
                  </button>
                  <p className="text-xs text-neutral-400 max-w-[200px]">
                    Model will always appear in the neutral base layer when used in product shots.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
