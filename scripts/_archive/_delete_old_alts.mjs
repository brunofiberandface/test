import { Firestore } from '@google-cloud/firestore';
const db = new Firestore({ projectId: 'gstar-ai-studio' });

const ids = [
  ['M03 rev 22 hem-fix', '6Lmyh53COLlOi1yplIxM'],
  ['M03 rev 21 fullbody-v1', 'cGOOjc1ZPR2OwIEiCknQ'],
  ['M04 rev 22 hem-fix', 'FaOM34D4rWhefDQfVcTF'],
  ['M04 rev 21 fullbody-v1', 'aM8L5WGtCKgKGHCixyKh'],
];

for (const [label, id] of ids) {
  const ref = db.collection('promptVault').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`SKIP ${label} (${id}) — not found`);
    continue;
  }
  const d = snap.data();
  console.log(`Deleting ${label}: rev=${d.revision} pipeline=${d.pipeline} fn=${d.filename}`);
  await ref.delete();
  console.log(`  ✓ deleted`);
}
console.log('done');
