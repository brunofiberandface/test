/**
 * Read-only: dump the active M04 prompt + content for hem-over-shoe edit.
 */
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const c = fs.readFileSync(envPath, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, 'sa_key.json');

import { Firestore } from '@google-cloud/firestore';

async function main() {
  const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
  const db = new Firestore({
    projectId: saKey.project_id || 'gstar-ai-studio',
    credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
  });

  const snap = await db.collection('promptVault')
    .where('shotType', '==', 'M04')
    .where('isActive', '==', true)
    .limit(1).get();
  if (snap.empty) { console.log('no active M04 prompt'); return; }
  const p = snap.docs[0].data() as any;
  console.log('id:', snap.docs[0].id);
  console.log('revision:', p.revision);
  console.log('uploadedAt:', p.uploadedAt?.toDate?.() || p.uploadedAt);
  console.log('content length:', (p.content || '').length);

  // Look for FOOTWEAR section
  const content = p.content as string;
  const fwIdx = content.indexOf('Footwear');
  if (fwIdx >= 0) {
    console.log('\n=== Footwear-adjacent text (200 chars before, 400 after) ===');
    console.log(content.substring(Math.max(0, fwIdx - 200), fwIdx + 400));
  }
  // Also pose
  const poseIdx = content.indexOf('Pose');
  if (poseIdx >= 0) {
    console.log('\n=== Pose-adjacent text (100 before, 300 after) ===');
    console.log(content.substring(Math.max(0, poseIdx - 100), poseIdx + 300));
  }
  // Also hem
  const hemIdx = content.toLowerCase().indexOf('hem');
  if (hemIdx >= 0) {
    console.log('\n=== Hem-adjacent text (100 before, 400 after) ===');
    console.log(content.substring(Math.max(0, hemIdx - 100), hemIdx + 400));
  }

  // Check pipeline
  console.log('\npipeline:', p.pipeline || '(none)');

  // Extract Step 2 Prompt fenced block + look for shoe/hem language
  const step2Idx = content.indexOf('## Step 2 Prompt');
  if (step2Idx >= 0) {
    const after = content.substring(step2Idx);
    const codeStart = after.indexOf('```\n');
    if (codeStart >= 0) {
      const promptBody = after.substring(codeStart + 4);
      const codeEnd = promptBody.indexOf('\n```');
      const prompt = codeEnd >= 0 ? promptBody.substring(0, codeEnd) : promptBody;
      console.log('\n=== STEP 2 PROMPT BODY (length=', prompt.length, ') ===\n');
      console.log(prompt);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
