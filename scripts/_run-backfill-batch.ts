/**
 * Driver: read the curated match plan and run backfill-fitmodel-4k.ts per item.
 * For each item: derive the correct --front-name/--back-name based on the
 * existing wardrobe doc's fitModels URLs (so we overwrite the SAME slot file).
 *
 * Usage:
 *   npx tsx scripts/_run-backfill-batch.ts            # process all
 *   npx tsx scripts/_run-backfill-batch.ts <itemId>   # single item
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

interface Plan {
  id: string;
  name: string;
  category: string;
  frontUrl: string | null;
  backUrl: string | null;
  frontSrc: string;
  backSrc: string;
  reason?: string;
  skip?: boolean;
}

const projectRoot = path.resolve(__dirname, '..');

function slotName(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/fitmodel_([^/]+)\.jpg/);
  return m ? `fitmodel_${m[1]}.jpg` : null;
}

const RUN: Plan[] = [
  // 000 run 09 april — DSLR landscape (sharp .rotate() handles EXIF)
  { id: '1DnvEYl01rDqggKgKTQa', name: '3301 Flare Jeans', category: 'bottom',
    frontUrl: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/1DnvEYl01rDqggKgKTQa/fitmodel_00.jpg',
    backUrl: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/1DnvEYl01rDqggKgKTQa/fitmodel_03.jpg',
    frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D21290-A634-G730 3301 FLARE WMN/_DSC4736.JPG",
    backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D21290-A634-G730 3301 FLARE WMN/_DSC4739.JPG" },
  { id: 'zIevwoBxsrHoqZpqB3sj', name: '3301 Skinny Jeans', category: 'bottom',
    frontUrl: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/zIevwoBxsrHoqZpqB3sj/fitmodel_00.jpg',
    backUrl: 'https://storage.googleapis.com/gstar-ai-studio-assets/wardrobe/bottom/zIevwoBxsrHoqZpqB3sj/fitmodel_03.jpg',
    frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D05175-8968-89 3301 SKINNY WMN/_DSC4755.JPG",
    backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D05175-8968-89 3301 SKINNY WMN/_DSC4758.JPG" },
  // Midge Bootcut Jeans - slots 00/05
  { id: 'PLACEHOLDER_MidgeBootcut', name: 'Midge Bootcut Jeans', category: 'bottom',
    frontUrl: null, backUrl: null,
    frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D01896-6553-89 MIDGE BOOTCUT WMN /_DSC4705.JPG",
    backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D01896-6553-89 MIDGE BOOTCUT WMN /_DSC4754.JPG" },
];

(async () => {
  const audit = JSON.parse(fs.readFileSync('/tmp/wardrobe_audit.json', 'utf-8'));
  // resolve all plans with actual IDs/URLs from audit
  // we use the audit JSON as ground truth for IDs and slot URLs
  type AuditItem = { id: string; name: string; designNumber: string; category: string; frontUrl: string|null; backUrl: string|null };
  const findByDesign = (d: string): AuditItem | undefined => audit.find((a: AuditItem) => a.designNumber === d);

  const plans: Array<Plan & { skipReason?: string }> = [
    // 000 run 09 april (DSLR landscape originals, sharp handles rotation)
    { ...(findByDesign('D21290-A634-G730') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D21290-A634-G730 3301 FLARE WMN/_DSC4736.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D21290-A634-G730 3301 FLARE WMN/_DSC4739.JPG" },
    { ...(findByDesign('D05175-8968-89') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D05175-8968-89 3301 SKINNY WMN/_DSC4755.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D05175-8968-89 3301 SKINNY WMN/_DSC4758.JPG" },
    { ...(findByDesign('D01896-6553-89') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D01896-6553-89 MIDGE BOOTCUT WMN /_DSC4705.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D01896-6553-89 MIDGE BOOTCUT WMN /_DSC4754.JPG" },
    { ...(findByDesign('D07145-8968-6028') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D07145-8968-6028 MIDGE SLIM STRAIGHT WMN/_DSC4761.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D07145-8968-6028 MIDGE SLIM STRAIGHT WMN/_DSC4764.JPG" },
    { ...(findByDesign('D15264-C052-D332') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D15264-C052-D332 KATE BOYFRIEND WMN/_DSC4719.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D15264-C052-D332 KATE BOYFRIEND WMN/_DSC4751.JPG" },
    { ...(findByDesign('D15264-D931-H095') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D15264-D931-H095 KATE BOYFIEND WMN/_DSC4767.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D15264-D931-H095 KATE BOYFIEND WMN/_DSC4771.JPG" },
    { ...(findByDesign('D22889-D933-H087') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D22889-D933-H087 JUDEE LOOSE WMN/_DSC4745.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D22889-D933-H087 JUDEE LOOSE WMN/_DSC4748.JPG" },
    { ...(findByDesign('D26163-E205-H914') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D26163-E205-H914 G-STRAIGHT /_DSC4724.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D26163-E205-H914 G-STRAIGHT /_DSC4729.JPG" },
    { ...(findByDesign('D26163-E205-H918') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D26163-E205-H918 G-STRAIGHT WMN/_DSC4730.JPG",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april/D26163-E205-H918 G-STRAIGHT WMN/_DSC4733.JPG" },

    // shoot April 28 2026 — pre-rotated, frames 0/3
    { ...(findByDesign('D21290-D987-H280 53') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D21290-D987-H280 53/D21290-D987-H280 53 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D21290-D987-H280 53/D21290-D987-H280 53 3.jpg" },
    { ...(findByDesign('D21290-D987-H281 61') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D21290-D987-H281 61 /D21290-D987-H281 61 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D21290-D987-H281 61 /D21290-D987-H281 61 3.jpg" },
    { ...(findByDesign('D25372-E266-H545 53') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D25372-E266-H545 53/D25372-E266-H545 53 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D25372-E266-H545 53/D25372-E266-H545 53 3.jpg" },
    { ...(findByDesign('D22889-D436-C947 52') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D22889-D436-C947 52/D22889-D436-C947 52 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D22889-D436-C947 52/D22889-D436-C947 52 3.jpg" },
    { ...(findByDesign('D22889-D536-G841 53') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D22889-D536-G841 53/D22889-D536-G841 53 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D22889-D536-G841 53/D22889-D536-G841 53 3.jpg" },
    { ...(findByDesign('D15264-C052-A802 51') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C052-A802 51/D15264-C052-A802 51 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C052-A802 51/D15264-C052-A802 51 3.jpg" },
    { ...(findByDesign('D15264-C052-8436 53') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C052-8436 53/D15264-C052-8436 53 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C052-8436 53/D15264-C052-8436 53 3.jpg" },
    { ...(findByDesign('D15264-D775-G803 61') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-D775-G803 61/D15264-D775-G803 61 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-D775-G803 61/D15264-D775-G803 61 3.jpg" },
    { ...(findByDesign('D15264-C293-B168 62') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C293-B168 62/D15264-C293-B168 62 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D15264-C293-B168 62/D15264-C293-B168 62 3.jpg" },
    { ...(findByDesign('D02153-6553-89 52') as AuditItem),
      frontSrc: "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D02153-6553-89 52/D02153-6553-89 52 0.jpg",
      backSrc:  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026/D02153-6553-89 52/D02153-6553-89 52 3.jpg" },
  ];

  const onlyId = process.argv[2];
  type Result = { id: string; name: string; category: string; frontSlot: string|null; backSlot: string|null; status: 'OK'|'ERROR'|'SKIPPED'; message?: string; frontVerified?: string; backVerified?: string };
  const results: Result[] = [];

  for (const plan of plans) {
    if (onlyId && plan.id !== onlyId) continue;
    const frontSlot = slotName(plan.frontUrl);
    const backSlot = slotName(plan.backUrl);
    if (!frontSlot || !backSlot) {
      results.push({ id: plan.id, name: plan.name, category: plan.category, frontSlot, backSlot, status: 'SKIPPED', message: 'missing-slot-url' });
      continue;
    }
    if (!fs.existsSync(plan.frontSrc)) {
      results.push({ id: plan.id, name: plan.name, category: plan.category, frontSlot, backSlot, status: 'ERROR', message: `front src missing: ${plan.frontSrc}` });
      continue;
    }
    if (!fs.existsSync(plan.backSrc)) {
      results.push({ id: plan.id, name: plan.name, category: plan.category, frontSlot, backSlot, status: 'ERROR', message: `back src missing: ${plan.backSrc}` });
      continue;
    }
    console.log(`\n\n========================================`);
    console.log(`[${plan.id}] ${plan.name} (${plan.category})`);
    console.log(`  slots: ${frontSlot} / ${backSlot}`);
    console.log(`========================================`);

    const args = [
      'tsx',
      path.join(projectRoot, 'scripts', 'backfill-fitmodel-4k.ts'),
      plan.category, plan.id,
      plan.frontSrc, plan.backSrc,
      '--front-name', frontSlot,
      '--back-name', backSlot,
    ];
    const r = spawnSync('npx', args, { stdio: 'inherit', cwd: projectRoot });
    if (r.status !== 0) {
      results.push({ id: plan.id, name: plan.name, category: plan.category, frontSlot, backSlot, status: 'ERROR', message: `script exit ${r.status}` });
      continue;
    }
    results.push({ id: plan.id, name: plan.name, category: plan.category, frontSlot, backSlot, status: 'OK' });
  }

  fs.writeFileSync('/tmp/backfill_results.json', JSON.stringify(results, null, 2));
  console.log(`\n\nWROTE /tmp/backfill_results.json (${results.length} entries)`);
})().catch(e => { console.error(e); process.exit(1); });
