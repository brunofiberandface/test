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

const SHOES = [
  { id: 'white-sneaker', name: 'White leather low-top sneaker',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/3xKezovO6eef7SJfMioC/360_00.jpg' },
  { id: 'grey-sneaker', name: 'Grey low-top sneaker',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/xaVs4I5KFQKq5AEq5m6I/flat_front.jpg' },
  { id: 'brown-suede-boot', name: 'Brown suede ankle boot',
    url: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/shoes/C0QleJPtkd58NRiHhPES/flat_front.jpg' },
];

async function main() {
  for (const shoe of SHOES) {
    console.log(`\n=== ${shoe.name} (${shoe.id}) ===`);
    const t0 = Date.now();
    try {
      const output = await replicate.run('cuuupid/idm-vton', {
        input: {
          human_img: HUMAN_URL,
          garm_img: shoe.url,
          category: 'lower_body',
          garment_des: shoe.name,
          crop: false,
        },
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      // output is a ReadableStream from replicate v1
      const url = typeof output === 'string' ? output : (Array.isArray(output) ? output[0] : (output as any)?.url?.()?.toString() ?? String(output));
      console.log(`DONE in ${dt}s — output URL: ${url}`);
      if (typeof url === 'string' && url.startsWith('http')) {
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        const outPath = path.join(OUT_DIR, `${shoe.id}.png`);
        fs.writeFileSync(outPath, buf);
        console.log(`Saved ${(buf.length/1024).toFixed(0)}KB → ${outPath}`);
      } else {
        console.log(`Output (non-URL): ${JSON.stringify(output).slice(0,200)}`);
      }
    } catch (e) {
      console.error(`FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1)});
