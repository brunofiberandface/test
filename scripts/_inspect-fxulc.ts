import * as path from 'path';
import * as fs from 'fs';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');
import { Firestore } from '@google-cloud/firestore';
async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({ projectId: saKey.project_id || 'gstar-ai-studio', credentials: { client_email: saKey.client_email, private_key: saKey.private_key } });
  const jobId = 'FXulcOtwRE2T7HNM3vJD';
  const job = (await db.collection('jobs').doc(jobId).get()).data() as any;
  console.log(`\n=== JOB ${jobId} ===`);
  console.log('jobName:', job?.jobName);
  console.log('modelId:', job?.modelId);
  console.log('status:', job?.status);
  console.log('wardrobe:', JSON.stringify(job?.wardrobe, null, 2));
  
  const shotsSnap = await db.collection('shots').where('jobId', '==', jobId).get();
  const byType: Record<string, any[]> = {};
  for (const d of shotsSnap.docs) {
    const s = d.data() as any;
    if (!byType[s.shotType]) byType[s.shotType] = [];
    byType[s.shotType].push({ id: d.id, ...s });
  }
  console.log(`\n${shotsSnap.size} shots:`);
  for (const t of ['M01', 'M02', 'M06']) {
    if (!byType[t]) continue;
    const latest = byType[t].sort((a,b)=>(b.version??0)-(a.version??0))[0];
    console.log(`\n  ${t} v${latest.version} (${latest.id}):`);
    console.log(`    status=${latest.status} teeEditApplied=${latest.teeEditApplied} teeEditError=${latest.teeEditError}`);
    console.log(`    promptRevision=${latest.promptRevision} provider=${latest.provider} seedreamModel=${latest.seedreamModel}`);
    console.log(`    imageUrl=${latest.imageUrl}`);
    console.log(`    pipelineStages=${Object.keys(latest.pipelineStages || {}).join(', ')}`);
    if (latest.pipelineStages?.seedream) console.log(`      seedream: ${latest.pipelineStages.seedream}`);
    if (latest.pipelineStages?.teeedit) console.log(`      teeedit: ${latest.pipelineStages.teeedit}`);
  }
  
  // Wardrobe items
  const w = job?.wardrobe || {};
  for (const slot of ['bottom', 'top', 'shoe'] as const) {
    const id = w[slot]?.itemId;
    if (!id) continue;
    const wd = (await db.collection('wardrobe').doc(id).get()).data() as any;
    console.log(`\n  ${slot.toUpperCase()} (${id}): ${wd?.name}`);
    console.log(`    description (first 250): ${(wd?.description||'').slice(0, 250)}`);
    if (slot === 'bottom') {
      console.log(`    silhouetteFront FIT CATEGORY: ${(wd?.silhouetteFront||'').match(/FIT CATEGORY[^\n]{0,300}/i)?.[0]?.slice(0,300) || '(none)'}`);
      console.log(`    silhouetteBack  FIT CATEGORY: ${(wd?.silhouetteBack ||'').match(/FIT CATEGORY[^\n]{0,300}/i)?.[0]?.slice(0,300) || '(none)'}`);
      // HEM-TO-GROUND section
      const hemFront = (wd?.silhouetteFront||'').match(/HEM-TO-GROUND[^\n]*\n([\s\S]{0,500})/i)?.[1]?.slice(0,500);
      const hemBack = (wd?.silhouetteBack ||'').match(/HEM-TO-GROUND[^\n]*\n([\s\S]{0,500})/i)?.[1]?.slice(0,500);
      console.log(`    HEM front: ${hemFront || '(none)'}`);
      console.log(`    HEM back: ${hemBack || '(none)'}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
