'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Shell from '@/components/Shell';

interface UserRecord {
  email: string;
  displayName?: string;
  role: 'admin' | 'creator';
  active: boolean;
  createdAt?: string;
  lastLogin?: string;
}

export default function UsersPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add user form
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'creator'>('creator');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail) return;
    setAdding(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, displayName: newName || newEmail.split('@')[0], role: newRole }),
      });
      if (res.ok) {
        setNewEmail('');
        setNewName('');
        setShowAdd(false);
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add user');
      }
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(email: string, active: boolean) {
    await fetch(`/api/users/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    fetchUsers();
  }

  async function toggleRole(email: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'creator' : 'admin';
    await fetch(`/api/users/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  }

  return (
    <Shell user={user ? { email: user.email, name: user.name || '', role: user.role || 'creator' } : undefined}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Users</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage who can access AI Studio.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors">
          {showAdd ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addUser} className="mb-6 bg-white border border-neutral-200 p-6 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Email</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              placeholder="user@example.com" required
              className="w-full border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Display Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Optional"
              className="w-full border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Role</label>
            <div className="flex gap-2">
              {(['creator', 'admin'] as const).map(r => (
                <button key={r} type="button" onClick={() => setNewRole(r)}
                  className={`px-3 py-2 text-sm border transition-colors ${newRole === r ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-300'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={adding || !newEmail}
            className="px-6 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40">
            {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading users...</p>
      ) : (
        <div className="bg-white border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Last Login</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.email} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-3 font-medium text-neutral-900">{u.email}</td>
                  <td className="px-4 py-3 text-neutral-600">{u.displayName || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs uppercase ${u.role === 'admin' ? 'bg-neutral-900 text-white' : 'bg-neutral-200 text-neutral-700'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs ${u.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {u.active !== false ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">
                    {u.lastLogin ? new Date(u.lastLogin._seconds ? u.lastLogin._seconds * 1000 : u.lastLogin).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleRole(u.email, u.role)}
                      className="text-xs text-neutral-500 hover:text-neutral-900 mr-3">
                      {u.role === 'admin' ? 'Make creator' : 'Make admin'}
                    </button>
                    <button onClick={() => toggleActive(u.email, u.active !== false)}
                      className={`text-xs ${u.active !== false ? 'text-red-500 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-800'}`}>
                      {u.active !== false ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
