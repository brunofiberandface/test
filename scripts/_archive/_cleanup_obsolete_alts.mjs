import { Firestore } from '@google-cloud/firestore';
const db = new Firestore({ projectId: 'gstar-ai-studio' });
const ids = [
  ['M01 rev 21 neutral-stance-v1', '6UF6KBou0xnwgQQyBs4b'],
  ['M01 rev 22 neutral-stance-v2', 'G36OON5H3ogfjTvyaaED'],
  ['M01 rev 23 neutral-stance-v3', 'UL8faVQx5YoLVWZTtdPU'],
  ['M02 rev 21 neutral-stance-v1', 'cOTBsZGj22IAg2q0WBAp'],
  ['M02 rev 22 neutral-stance-v2', 'dU5QfbyGPLjxFm3X37xh'],
  ['M02 rev 23 neutral-stance-v3', 'tgbpZZYjMhs75apDfedc'],
];
for (const [label, id] of ids) {
  const ref = db.collection('promptVault').doc(id);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`SKIP ${label}`); continue; }
  await ref.delete();
  console.log(`✓ deleted ${label}`);
}
console.log('done');
