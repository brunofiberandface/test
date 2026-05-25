import { Firestore } from '@google-cloud/firestore';
const db = new Firestore({ projectId: 'gstar-ai-studio' });
const snap = await db.collection('wardrobe').get();
console.log(`total wardrobe docs: ${snap.size}`);
let hits = [];
snap.forEach(d => {
  const data = d.data();
  const n = (data.name || '').toLowerCase();
  if (n.includes('bowey')) {
    hits.push({
      id: d.id,
      name: data.name,
      fitModelsKeys: Object.keys(data.fitModels || {}),
      fitBack: data.fitModels?.back,
      flatBack: data.flatBackUrl,
    });
  }
});
console.log(JSON.stringify(hits, null, 2));
process.exit(0);
