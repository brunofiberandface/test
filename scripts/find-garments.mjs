import { Firestore } from '@google-cloud/firestore';
const db = new Firestore({ projectId: 'gstar-ai-studio' });
const NEEDLES = ['rr kick', 'contor 3d wide', 'cargo trouser'];
const snap = await db.collection('wardrobe').get();
const hits = {};
snap.forEach(d => {
  const data = d.data();
  const n = (data.name || '').toLowerCase();
  for (const needle of NEEDLES) {
    if (n.includes(needle)) {
      (hits[needle] = hits[needle] || []).push({
        id: d.id,
        name: data.name,
        fitBack: data.fitModels?.back || data.fitModelBack || null,
      });
    }
  }
});
console.log(JSON.stringify(hits, null, 2));
process.exit(0);
