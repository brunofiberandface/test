/**
 * Angle backfill driver: for each of the 25 bottoms already at 2/6 (front+back 4K),
 * upload 4K versions of the 4 angle slots (front45Left, front45Right, back45Left,
 * back45Right) by invoking backfill-fitmodel-4k.ts twice per item with
 * --front-slot / --back-slot for the angle keys.
 *
 * The 4K destination URL is resolved from the wardrobe doc's fitModels.{slot}
 * field — the script's source of truth — so we don't need to know the slot
 * filename, only the slot key.
 *
 * Usage:
 *   npx tsx scripts/_run-angle-backfill-batch.ts            # process all
 *   npx tsx scripts/_run-angle-backfill-batch.ts <itemId>   # single item
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '..');

type AnglePlan = {
  id: string;
  name: string;
  designNumber?: string;
  category: 'bottom';
  folder: string;
  // Source file paths for each angle slot. Missing = skip that slot.
  front45Left?: string;
  front45Right?: string;
  back45Left?: string;
  back45Right?: string;
  notes?: string;
};

const ROOT = `/Users/bdheedene/Documents/Claude folder DON't remove/gstar`;

// Helpers for path construction
function aprilRunFile(folder: string, n: number): string {
  return `${ROOT}/000 run 09 april/${folder}/_DSC${n}.JPG`;
}
function april28File(folder: string, frame: number): string {
  // April 28 frames named "{folder} {frame}.jpg" where {folder} in the filename
  // has any trailing whitespace stripped (the dir name may have a trailing space).
  const filenameBase = folder.replace(/\s+$/, '');
  return `${ROOT}/shoot April 28 2026/${folder}/${filenameBase} ${frame}.jpg`;
}
function aiShootFile(folder: string, n: number): string {
  return `${ROOT}/new ai shoot 01042026/${folder}/G-Star AI test jeans ${n}.png`;
}

/**
 * 000 run 09 april (6-frame, 60° per frame, model rotates her LEFT):
 *   front=N, front45Left=N+1, back45Left=N+2, back=N+3, back45Right=N+4, front45Right=N+5
 *
 * Non-standard folders (back at +5, no front45R available, ~180° rotation):
 *   front=N, front45Left=N+1, back45Left=N+2, back45Right=N+3 or N+4, back=last frame
 *   No front45R — skip.
 */

const PLANS: AnglePlan[] = [
  // ===== 000 run 09 april (consecutive 360°) =====
  {
    id: '1DnvEYl01rDqggKgKTQa', name: '3301 Flare Jeans', category: 'bottom',
    folder: 'D21290-A634-G730 3301 FLARE WMN',
    front45Left:  aprilRunFile('D21290-A634-G730 3301 FLARE WMN', 4737),
    back45Left:   aprilRunFile('D21290-A634-G730 3301 FLARE WMN', 4738),
    back45Right:  aprilRunFile('D21290-A634-G730 3301 FLARE WMN', 4740),
    front45Right: aprilRunFile('D21290-A634-G730 3301 FLARE WMN', 4741),
  },
  {
    id: 'zIevwoBxsrHoqZpqB3sj', name: '3301 Skinny Jeans', category: 'bottom',
    folder: 'D05175-8968-89 3301 SKINNY WMN',
    front45Left:  aprilRunFile('D05175-8968-89 3301 SKINNY WMN', 4756),
    back45Left:   aprilRunFile('D05175-8968-89 3301 SKINNY WMN', 4757),
    back45Right:  aprilRunFile('D05175-8968-89 3301 SKINNY WMN', 4759),
    front45Right: aprilRunFile('D05175-8968-89 3301 SKINNY WMN', 4760),
  },
  {
    id: 'vdOxwqzTUBch6ktkOgfY', name: 'Midge Slim Straight Jeans', category: 'bottom',
    folder: 'D07145-8968-6028 MIDGE SLIM STRAIGHT WMN',
    front45Left:  aprilRunFile('D07145-8968-6028 MIDGE SLIM STRAIGHT WMN', 4762),
    back45Left:   aprilRunFile('D07145-8968-6028 MIDGE SLIM STRAIGHT WMN', 4763),
    back45Right:  aprilRunFile('D07145-8968-6028 MIDGE SLIM STRAIGHT WMN', 4765),
    front45Right: aprilRunFile('D07145-8968-6028 MIDGE SLIM STRAIGHT WMN', 4766),
  },
  {
    id: 'YOiSIPlqgjcduhR3R6Ix', name: 'Kate Boyfriend Jeans (D15264-D931-H095)', category: 'bottom',
    folder: 'D15264-D931-H095 KATE BOYFIEND WMN',
    front45Left:  aprilRunFile('D15264-D931-H095 KATE BOYFIEND WMN', 4768),
    back45Left:   aprilRunFile('D15264-D931-H095 KATE BOYFIEND WMN', 4770),
    back45Right:  aprilRunFile('D15264-D931-H095 KATE BOYFIEND WMN', 4772),
    front45Right: aprilRunFile('D15264-D931-H095 KATE BOYFIEND WMN', 4773),
  },
  {
    id: '6weuQ0caKivxaSTkr4Cw', name: 'Judee Low Waist Loose Jeans (D22889-D933-H087)', category: 'bottom',
    folder: 'D22889-D933-H087 JUDEE LOOSE WMN',
    front45Left:  aprilRunFile('D22889-D933-H087 JUDEE LOOSE WMN', 4746),
    back45Left:   aprilRunFile('D22889-D933-H087 JUDEE LOOSE WMN', 4747),
    back45Right:  aprilRunFile('D22889-D933-H087 JUDEE LOOSE WMN', 4749),
    front45Right: aprilRunFile('D22889-D933-H087 JUDEE LOOSE WMN', 4750),
  },
  {
    id: 'TT2f4TLx5SmYUFX8Yw0d', name: 'G-Straight Jeans (D26163-E205-H918)', category: 'bottom',
    folder: 'D26163-E205-H918 G-STRAIGHT WMN',
    front45Left:  aprilRunFile('D26163-E205-H918 G-STRAIGHT WMN', 4731),
    back45Left:   aprilRunFile('D26163-E205-H918 G-STRAIGHT WMN', 4732),
    back45Right:  aprilRunFile('D26163-E205-H918 G-STRAIGHT WMN', 4734),
    front45Right: aprilRunFile('D26163-E205-H918 G-STRAIGHT WMN', 4735),
  },

  // ===== 000 run 09 april (non-standard, ~180° rotation + retake back) =====
  // For these folders the model rotated only one direction (front -> back, 5 frames)
  // plus a back retake at the end. No front45R available; back is at position 5.
  // Available: front (pos 0), front45L (pos 1), back45L (pos 2), and a near-back at pos 3 / 4.
  // We use pos 1 = front45L, pos 2 = back45L, pos 4 = back45R (skipping pos 3 which is back-adjacent).
  // front45R is SKIPPED for these folders.
  {
    id: 'Hun27VKK37Ca4EWYOsfm', name: 'Midge Bootcut Jeans', category: 'bottom',
    folder: 'D01896-6553-89 MIDGE BOOTCUT WMN ',
    front45Left:  aprilRunFile('D01896-6553-89 MIDGE BOOTCUT WMN ', 4706),
    back45Left:   aprilRunFile('D01896-6553-89 MIDGE BOOTCUT WMN ', 4707),
    back45Right:  aprilRunFile('D01896-6553-89 MIDGE BOOTCUT WMN ', 4711),
    // No front45R available — model didn't complete the rotation
    notes: 'Non-standard folder; no front45R (model rotated only 180°)',
  },
  {
    id: 'OnOe3MaP00xavnoRtNN7', name: 'Kate Boyfriend Jeans (D15264-C052-D332)', category: 'bottom',
    folder: 'D15264-C052-D332 KATE BOYFRIEND WMN',
    front45Left:  aprilRunFile('D15264-C052-D332 KATE BOYFRIEND WMN', 4720),
    back45Left:   aprilRunFile('D15264-C052-D332 KATE BOYFRIEND WMN', 4721),
    back45Right:  aprilRunFile('D15264-C052-D332 KATE BOYFRIEND WMN', 4722),
    front45Right: aprilRunFile('D15264-C052-D332 KATE BOYFRIEND WMN', 4723), // 4723 showed navel again, likely front-side
    notes: 'Folder includes 4723 which shows front-angle (model returning), used as front45R',
  },
  {
    id: 'D1gooqDdFnvbzX6iDUHg', name: 'G-Straight Jeans (D26163-E205-H914)', category: 'bottom',
    folder: 'D26163-E205-H914 G-STRAIGHT ',
    front45Left:  aprilRunFile('D26163-E205-H914 G-STRAIGHT ', 4725),
    back45Left:   aprilRunFile('D26163-E205-H914 G-STRAIGHT ', 4726),
    back45Right:  aprilRunFile('D26163-E205-H914 G-STRAIGHT ', 4728),
    // No front45R available
    notes: 'Non-standard folder; no front45R',
  },
  // For 4nyMHh7ICQLrpxBX8zmP (prev-done Judee, D22889-D436-D331), the source folder
  // has 4714,4715,4716,4717,4718,4753. Front=4714, back=4753 (retake).
  // The rotation appears mostly back-side, no clean front45R.
  {
    id: '4nyMHh7ICQLrpxBX8zmP', name: 'Judee Low Waist Loose Jeans (D22889-D436-D331, prev-done)', category: 'bottom',
    folder: 'D22889-D436-D331 JUDEE LOOSE WMN',
    front45Left:  aprilRunFile('D22889-D436-D331 JUDEE LOOSE WMN', 4715),
    back45Left:   aprilRunFile('D22889-D436-D331 JUDEE LOOSE WMN', 4716),
    back45Right:  aprilRunFile('D22889-D436-D331 JUDEE LOOSE WMN', 4717),
    // No front45R available
    notes: 'Non-standard folder; no front45R',
  },

  // ===== shoot April 28 2026 (6-frame consecutive, 60° per frame, model rotates her LEFT) =====
  // Pattern: 0=front, 1=front45L, 2=back45L, 3=back, 4=back45R, 5=front45R
  {
    id: 'C8inPAjtaie8SxdMjs1s', name: '3301 Flare jeans 53', category: 'bottom',
    folder: 'D21290-D987-H280 53',
    front45Left:  april28File('D21290-D987-H280 53', 1),
    back45Left:   april28File('D21290-D987-H280 53', 2),
    back45Right:  april28File('D21290-D987-H280 53', 4),
    front45Right: april28File('D21290-D987-H280 53', 5),
  },
  {
    id: '8gr2tzr9Er8m00ZmRzLi', name: '3301 Flare jeans 61', category: 'bottom',
    folder: 'D21290-D987-H281 61 ',
    front45Left:  april28File('D21290-D987-H281 61 ', 1),
    back45Left:   april28File('D21290-D987-H281 61 ', 2),
    back45Right:  april28File('D21290-D987-H281 61 ', 4),
    front45Right: april28File('D21290-D987-H281 61 ', 5),
  },
  {
    id: 'Rq3K3UQGdJmVu4W0LwgK', name: 'Bowey Barrel jeans 53', category: 'bottom',
    folder: 'D25372-E266-H545 53',
    front45Left:  april28File('D25372-E266-H545 53', 1),
    back45Left:   april28File('D25372-E266-H545 53', 2),
    back45Right:  april28File('D25372-E266-H545 53', 4),
    front45Right: april28File('D25372-E266-H545 53', 5),
  },
  {
    id: 'IUqRKvjYj96i29RvdsbO', name: 'Judee Low Waist Loose Jeans 52', category: 'bottom',
    folder: 'D22889-D436-C947 52',
    front45Left:  april28File('D22889-D436-C947 52', 1),
    back45Left:   april28File('D22889-D436-C947 52', 2),
    back45Right:  april28File('D22889-D436-C947 52', 4),
    front45Right: april28File('D22889-D436-C947 52', 5),
  },
  {
    id: 'ME7QswY55jaCJQXGi3lc', name: 'Judee Low Waist Loose Jeans 53', category: 'bottom',
    folder: 'D22889-D536-G841 53',
    front45Left:  april28File('D22889-D536-G841 53', 1),
    back45Left:   april28File('D22889-D536-G841 53', 2),
    back45Right:  april28File('D22889-D536-G841 53', 4),
    front45Right: april28File('D22889-D536-G841 53', 5),
  },
  {
    id: 'OEyZ0lrt7soRIba963pI', name: 'Kate Boyfriend Jeans 51', category: 'bottom',
    folder: 'D15264-C052-A802 51',
    front45Left:  april28File('D15264-C052-A802 51', 1),
    back45Left:   april28File('D15264-C052-A802 51', 2),
    back45Right:  april28File('D15264-C052-A802 51', 4),
    front45Right: april28File('D15264-C052-A802 51', 5),
  },
  {
    id: '5LCOIQVA7GARxf33WxCY', name: 'Kate Boyfriend Jeans 53', category: 'bottom',
    folder: 'D15264-C052-8436 53',
    front45Left:  april28File('D15264-C052-8436 53', 1),
    back45Left:   april28File('D15264-C052-8436 53', 2),
    back45Right:  april28File('D15264-C052-8436 53', 4),
    front45Right: april28File('D15264-C052-8436 53', 7), // folder skips frame 5, has frame 7 in its place
    notes: 'Folder uses frame 7 instead of frame 5 for front45R position',
  },
  {
    id: '6aN3Hxx0GFJFCW9U2Oyj', name: 'Kate Boyfriend Jeans 61', category: 'bottom',
    folder: 'D15264-D775-G803 61',
    front45Left:  april28File('D15264-D775-G803 61', 1),
    back45Left:   april28File('D15264-D775-G803 61', 2),
    back45Right:  april28File('D15264-D775-G803 61', 4),
    front45Right: april28File('D15264-D775-G803 61', 5),
  },
  {
    id: 'PWYdwXzb61EXfjhSdulq', name: 'Kate Boyfriend Jeans 62', category: 'bottom',
    folder: 'D15264-C293-B168 62',
    front45Left:  april28File('D15264-C293-B168 62', 1),
    back45Left:   april28File('D15264-C293-B168 62', 2),
    back45Right:  april28File('D15264-C293-B168 62', 4),
    front45Right: april28File('D15264-C293-B168 62', 5),
  },
  {
    id: 'shU8uNGorWXuyMqS8Iis', name: 'Midge Straight jeans 52', category: 'bottom',
    folder: 'D02153-6553-89 52',
    front45Left:  april28File('D02153-6553-89 52', 1),
    back45Left:   april28File('D02153-6553-89 52', 2),
    back45Right:  april28File('D02153-6553-89 52', 4),
    front45Right: april28File('D02153-6553-89 52', 5),
  },

  // ===== new ai shoot 01042026 (8-frame, 45° per frame, model rotates her RIGHT) =====
  // Slot keys (in doc): fitmodel_NN.jpg where NN is the frame index (0..7) within the shoot.
  // Rotation: N+0=front, N+1=front45R, N+3=back45R, N+4=back, N+5=back45L, N+7=front45L
  // (positions 2 and 6 are the side profiles — not 45° angle slots)
  {
    id: 'YgYlPXyfF75wJNVdbtKK', name: 'CONTOR 3D EXTREME LOOSE WMN', category: 'bottom',
    folder: 'D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN',
    // front=4, back=8 (but prior pass used 7 — already done)
    front45Right: aiShootFile('D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN', 5),
    back45Right:  aiShootFile('D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN', 7),
    back45Left:   aiShootFile('D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN', 9),
    front45Left:  aiShootFile('D27690-D315-001 CONTOR 3D EXTREME LOOSE WMN', 11),
  },
  {
    id: 'ZB2GMhoH1hQDjdJQbD6d', name: 'CONTOR 3D WIDE WMN', category: 'bottom',
    folder: 'D27690-D788-H117 CONTOR 3D WIDE WMN',
    // frames: 35 36 37 38 40 41 42 43 (frame 39 skipped)
    // Treat as positions 0..7: 35=0(front), 36=1, 37=2, 38=3, 40=4(back), 41=5, 42=6, 43=7
    // Rotation: front45R=pos1=36, back45R=pos3=38, back45L=pos5=41, front45L=pos7=43
    front45Right: aiShootFile('D27690-D788-H117 CONTOR 3D WIDE WMN', 36),
    back45Right:  aiShootFile('D27690-D788-H117 CONTOR 3D WIDE WMN', 38),
    back45Left:   aiShootFile('D27690-D788-H117 CONTOR 3D WIDE WMN', 41),
    front45Left:  aiShootFile('D27690-D788-H117 CONTOR 3D WIDE WMN', 43),
  },
  {
    id: 'AJEFuiuVuSdYk1di1dcv', name: 'RR KICK CROPPED WMN', category: 'bottom',
    folder: 'D28619-E460 RR KICK CROPPED WMN',
    // frames: 25 26 27 28 29 30 31 32 (consecutive)
    front45Right: aiShootFile('D28619-E460 RR KICK CROPPED WMN', 26),
    back45Right:  aiShootFile('D28619-E460 RR KICK CROPPED WMN', 28),
    back45Left:   aiShootFile('D28619-E460 RR KICK CROPPED WMN', 30),
    front45Left:  aiShootFile('D28619-E460 RR KICK CROPPED WMN', 32),
  },
  {
    id: 'Cyz9pf1QsMuKX6T4UhxU', name: 'DARTT 3D ZIP SLIM WMN', category: 'bottom',
    folder: 'D29074-E540-D926 DARTT 3D ZIP SLIM WMN',
    // frames: 15-22 consecutive
    front45Right: aiShootFile('D29074-E540-D926 DARTT 3D ZIP SLIM WMN', 16),
    back45Right:  aiShootFile('D29074-E540-D926 DARTT 3D ZIP SLIM WMN', 18),
    back45Left:   aiShootFile('D29074-E540-D926 DARTT 3D ZIP SLIM WMN', 20),
    front45Left:  aiShootFile('D29074-E540-D926 DARTT 3D ZIP SLIM WMN', 22),
  },
  {
    id: 'k0FIVJnYT6jLqKc4EzsS', name: 'LOUX BOYFRIEND WMN', category: 'bottom',
    folder: 'D29953-E875-J648 LOUX BOYFRIEND WMN',
    // frames: 46-53 consecutive
    front45Right: aiShootFile('D29953-E875-J648 LOUX BOYFRIEND WMN', 47),
    back45Right:  aiShootFile('D29953-E875-J648 LOUX BOYFRIEND WMN', 49),
    back45Left:   aiShootFile('D29953-E875-J648 LOUX BOYFRIEND WMN', 51),
    front45Left:  aiShootFile('D29953-E875-J648 LOUX BOYFRIEND WMN', 53),
  },
  {
    id: 'GPJx6wpxwTfYsIqPAHnA', name: 'G-STAR RADAR LOOSE WMN', category: 'bottom',
    folder: 'D30419-E358-D926 G-STAR RADAR LOOSE WMN',
    // frames: 56-64 (9 frames; treat 56-63 as standard 8-frame rotation)
    front45Right: aiShootFile('D30419-E358-D926 G-STAR RADAR LOOSE WMN', 57),
    back45Right:  aiShootFile('D30419-E358-D926 G-STAR RADAR LOOSE WMN', 59),
    back45Left:   aiShootFile('D30419-E358-D926 G-STAR RADAR LOOSE WMN', 61),
    front45Left:  aiShootFile('D30419-E358-D926 G-STAR RADAR LOOSE WMN', 63),
  },
];

type SlotResult = { slot: string; status: 'OK' | 'ERROR' | 'SKIPPED'; message?: string };
type ItemResult = {
  id: string;
  name: string;
  slots: Record<string, SlotResult>;
};

function runBackfill(plan: AnglePlan, frontSlot: string, backSlot: string, frontSrc: string | undefined, backSrc: string | undefined): { front: SlotResult; back: SlotResult } {
  const result: { front: SlotResult; back: SlotResult } = {
    front: { slot: frontSlot, status: 'SKIPPED' },
    back: { slot: backSlot, status: 'SKIPPED' },
  };
  if (!frontSrc) result.front = { slot: frontSlot, status: 'SKIPPED', message: 'no src defined' };
  else if (!fs.existsSync(frontSrc)) result.front = { slot: frontSlot, status: 'ERROR', message: `src missing: ${frontSrc}` };
  if (!backSrc) result.back = { slot: backSlot, status: 'SKIPPED', message: 'no src defined' };
  else if (!fs.existsSync(backSrc)) result.back = { slot: backSlot, status: 'ERROR', message: `src missing: ${backSrc}` };
  if (!frontSrc || !backSrc || !fs.existsSync(frontSrc) || !fs.existsSync(backSrc)) {
    return result;
  }
  console.log(`\n>>> ${plan.name} | ${frontSlot} = ${path.basename(frontSrc)}, ${backSlot} = ${path.basename(backSrc)}`);
  const args = [
    'tsx',
    path.join(projectRoot, 'scripts', 'backfill-fitmodel-4k.ts'),
    plan.category, plan.id,
    frontSrc, backSrc,
    '--front-slot', frontSlot,
    '--back-slot', backSlot,
  ];
  const r = spawnSync('npx', args, { stdio: 'inherit', cwd: projectRoot });
  if (r.status !== 0) {
    result.front = { slot: frontSlot, status: 'ERROR', message: `script exit ${r.status}` };
    result.back = { slot: backSlot, status: 'ERROR', message: `script exit ${r.status}` };
  } else {
    result.front = { slot: frontSlot, status: 'OK' };
    result.back = { slot: backSlot, status: 'OK' };
  }
  return result;
}

(async () => {
  const onlyId = process.argv[2];
  const results: ItemResult[] = [];

  for (const plan of PLANS) {
    if (onlyId && plan.id !== onlyId) continue;
    console.log(`\n\n========================================`);
    console.log(`[${plan.id}] ${plan.name}`);
    console.log(`========================================`);
    const item: ItemResult = { id: plan.id, name: plan.name, slots: {} };

    // Pair 1: front45Left + back45Left
    const p1 = runBackfill(plan, 'front45Left', 'back45Left', plan.front45Left, plan.back45Left);
    item.slots['front45Left'] = p1.front;
    item.slots['back45Left'] = p1.back;

    // Pair 2: front45Right + back45Right
    const p2 = runBackfill(plan, 'front45Right', 'back45Right', plan.front45Right, plan.back45Right);
    item.slots['front45Right'] = p2.front;
    item.slots['back45Right'] = p2.back;

    results.push(item);
  }

  fs.writeFileSync('/tmp/angle_backfill_results.json', JSON.stringify(results, null, 2));
  console.log(`\n\nWROTE /tmp/angle_backfill_results.json (${results.length} entries)`);

  // Print summary
  for (const r of results) {
    const slots = Object.entries(r.slots);
    const ok = slots.filter(([_, s]) => s.status === 'OK').length;
    const errs = slots.filter(([_, s]) => s.status === 'ERROR').length;
    const skips = slots.filter(([_, s]) => s.status === 'SKIPPED').length;
    console.log(`  ${r.name.padEnd(50)} OK=${ok} ERR=${errs} SKIP=${skips}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
