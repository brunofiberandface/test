import * as fs from 'fs';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';

const projectRoot = path.resolve(__dirname, '..');
const saKey = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sa_key.json'), 'utf-8'));
const db = new Firestore({
  projectId: saKey.project_id || 'gstar-ai-studio',
  credentials: { client_email: saKey.client_email, private_key: saKey.private_key },
});

const JOBS = [
  { jobNum: 176, jobId: 'wTqVWk8Y0SFdACpKsp9w', desc: 'F2 × white shirt × CONTOR Extreme + brown loafer' },
  { jobNum: 159, jobId: '5gmKGdX4wvFwnk0xWTpH', desc: 'F1 × Resort Boxy × jeans + white sneaker' },
  { jobNum: 184, jobId: 'c8M0QkHGNkoDynD9VCzw', desc: 'F6 × Flowy Mock × CONTOR + heavy blue heel' },
];

async function main() {
  const outDir = path.join(projectRoot, 'test_outputs/prod-confirm-00607');
  fs.mkdirSync(outDir, { recursive: true });
  for (const j of JOBS) {
    console.log(`──── #${j.jobNum} ${j.jobId} (${j.desc}) ────`);
    const shotsSnap = await db.collection('shots').where('jobId', '==', j.jobId).get();
    for (const doc of shotsSnap.docs) {
      const shot = doc.data();
      const st = shot.shotType as string;
      if (st !== 'M01' && st !== 'M02') continue;
      const url = shot.imageUrl as string;
      const greyUrl = shot.greyMasterUrl as string | undefined;
      const whiteUrl = shot.whiteMasterUrl as string | undefined;
      const teeEdited = shot.teeEdited;
      const teeEditError = shot.teeEditError as string | undefined;
      const seedreamModel = shot.seedreamModel as string | undefined;
      console.log(`  ${st} v${shot.version} status=${shot.status} teeEdited=${teeEdited}`);
      if (teeEditError) console.log(`    ⚠ teeEditError: ${teeEditError}`);
      if (seedreamModel) console.log(`    seedreamModel: ${seedreamModel}`);
      console.log(`    imageUrl:  ${url}`);
      if (greyUrl) console.log(`    greyMaster: ${greyUrl}`);
      if (whiteUrl) console.log(`    whiteMaster: ${whiteUrl}`);

      // Download imageUrl
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`download ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const out = path.join(outDir, `prod_${j.jobNum}_${st}_v${shot.version}.png`);
        fs.writeFileSync(out, buf);
        console.log(`    ✓ saved ${path.basename(out)} (${(buf.length / 1024).toFixed(0)}KB)`);
      } catch (e) {
        console.error(`    download FAIL: ${(e as Error).message}`);
      }
    }
    console.log();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
