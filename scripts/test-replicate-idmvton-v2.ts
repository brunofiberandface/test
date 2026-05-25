import * as fs from 'fs';
import * as path from 'path';
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
import Replicate from 'replicate';
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const HUMAN_URL = 'https://storage.googleapis.com/gstar-ai-studio-assets/experiments/sole-mode/contor-run4-1779247500.png';
const OUT_DIR = path.join(projectRoot, 'test_outputs/sole-mode/replicate-idmvton');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Fetch latest version dynamically
async function getLatestVersion(slug: string): Promise<string> {
  const r = await fetch(`https://api.replicate.com/v1/models/${slug}`, {
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
  });
  const d = await r.json() as any;
  return d.latest_version?.id;
}

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_00.jpg' },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_front.jpg' },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_front.jpg' },
];

async function main() {
  const version = await getLatestVersion('cuuupid/idm-vton');
  console.log(`Using cuuupid/idm-vton:${version.slice(0,12)}…`);

  for (let i = 0; i < SHOES.length; i++) {
    const shoe = SHOES[i];
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    if (i > 0) {
      console.log('Sleeping 15s for rate-limit…');
      await new Promise(r => setTimeout(r, 15000));
    }
    const t0 = Date.now();
    try {
      const output = await replicate.run(`cuuupid/idm-vton:${version}` as `${string}/${string}:${string}`, {
        input: {
          human_img: HUMAN_URL,
          garm_img: shoe.url,
          category: 'lower_body',
          garment_des: shoe.name,
          crop: false,
        },
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const url = typeof output === 'string' ? output
        : Array.isArray(output) ? String(output[0])
        : ((output as any)?.url?.()?.toString?.() ?? String(output));
      console.log(`DONE in ${dt}s — ${url.slice(0, 100)}`);
      if (url.startsWith('http')) {
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        const outPath = path.join(OUT_DIR, `${shoe.id}.png`);
        fs.writeFileSync(outPath, buf);
        console.log(`Saved ${(buf.length/1024).toFixed(0)}KB → ${outPath}`);
      }
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
