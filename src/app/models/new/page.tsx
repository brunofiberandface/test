'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reference image upload
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)');
      return;
    }

    // Validate file size (max 20MB for 4K images)
    if (file.size > 20 * 1024 * 1024) {
      setError('Image too large. Max 20MB.');
      return;
    }

    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreviewUrl(dataUrl);
      setImageDataUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!modelId || !name || !imageDataUrl) return;
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
          referenceImageUrl: imageDataUrl,
          createdBy: user.email,
        }),
      });
      const data = await res.json();

      if (data.success) {
        router.push('/models');
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
          Upload a high-resolution 4K reference photo of the model. This photo will be used as the identity reference for all generated shots.
        </p>

        <div className="space-y-6">
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
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Notes about the model — ethnicity, build, distinguishing features, etc."
              className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900 resize-none"
            />
          </div>

          {/* Reference Image Upload */}
          <div className="border-t border-neutral-200 pt-6">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
              Reference Photo — 4K recommended
            </p>
            <p className="text-xs text-neutral-400 mb-4">
              Upload a high-resolution full-body photo of the model. This will be used as the identity reference
              for all AI-generated shots. 4K (3000px+ height) recommended for best results.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {!previewUrl ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-56 aspect-[3/4] border-2 border-dashed border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100 transition-colors flex flex-col items-center justify-center cursor-pointer"
              >
                <svg className="w-8 h-8 text-neutral-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm text-neutral-400">Upload Photo</span>
                <span className="text-[10px] text-neutral-300 mt-1">PNG, JPG — max 20MB</span>
              </button>
            ) : (
              <div className="flex gap-6 items-start">
                <div className="w-56 aspect-[3/4] bg-neutral-100 border border-neutral-200 overflow-hidden relative">
                  <img
                    src={previewUrl}
                    alt="Reference photo preview"
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <div className="space-y-3">
                  <button
                    onClick={handleSave}
                    disabled={!modelId || !name || saving}
                    className="block bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-30"
                  >
                    {saving ? 'Saving...' : 'Save Model'}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="block border border-neutral-300 px-5 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
                  >
                    Replace Photo
                  </button>
                  <button
                    onClick={() => { setPreviewUrl(null); setImageDataUrl(null); }}
                    className="block text-xs text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    Remove
                  </button>
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
