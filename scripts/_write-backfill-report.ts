/**
 * Build /Users/.../gstar/BACKFILL_FITMODEL_4K_REPORT.md from the audit, match
 * plan, and verify results.
 */
import * as fs from 'fs';

interface AuditItem { id: string; name: string; designNumber: string; category: string; frontUrl: string|null; backUrl: string|null; }
interface MatchItem extends AuditItem { match: { folderName: string; dscPath: string; dscFiles: string[]; score: number; reason: string } | null; }
interface VerifyItem { id: string; name: string; category: string; frontSlot: string|null; backSlot: string|null; status: string; frontDims?: string; backDims?: string; verifyOk?: boolean; verifyMsg?: string; }

const matches: MatchItem[] = JSON.parse(fs.readFileSync('/tmp/wardrobe_matches.json', 'utf-8'));
const verifies: VerifyItem[] = JSON.parse(fs.readFileSync('/tmp/backfill_verify.json', 'utf-8'));
const verifyMap = new Map<string, VerifyItem>(verifies.map(v => [v.id, v]));

const JUDEE_ALREADY = '4nyMHh7ICQLrpxBX8zmP';

function slotName(url: string | null): string {
  if (!url) return '-';
  const m = url.match(/fitmodel_([^/]+)\.jpg/);
  return m ? `fitmodel_${m[1]}.jpg` : url;
}

interface Row {
  name: string; id: string; category: string; designNumber: string;
  sourceFolder: string;
  frontSlot: string; backSlot: string;
  frontStatus: string; backStatus: string;
  notes: string;
}

const rows: Row[] = [];
let totals = { bottoms: 0, tops: 0, backfilled: 0, skipped: 0, errored: 0, previouslyCompleted: 0 };
const bottomBreakdown = { total: 0, backfilled: 0, skipped: 0, errored: 0, previouslyCompleted: 0 };
const topBreakdown = { total: 0, backfilled: 0, skipped: 0, errored: 0 };

for (const it of matches.sort((a, b) => a.name.localeCompare(b.name))) {
  const front = slotName(it.frontUrl);
  const back = slotName(it.backUrl);
  let sourceFolder = it.match ? it.match.folderName : '(no folder match)';
  let frontStatus: string, backStatus: string, notes: string;

  if (it.category === 'bottom') {
    bottomBreakdown.total += 1;
    totals.bottoms += 1;
  } else {
    topBreakdown.total += 1;
    totals.tops += 1;
  }

  if (it.id === JUDEE_ALREADY) {
    frontStatus = 'OK (previously completed)';
    backStatus = 'OK (previously completed)';
    notes = 'Backfilled in prior session — skipped this run.';
    sourceFolder = 'D22889-D436-D331 JUDEE LOOSE WMN';
    bottomBreakdown.previouslyCompleted += 1;
    totals.previouslyCompleted += 1;
  } else {
    const v = verifyMap.get(it.id);
    if (v && v.status === 'OK') {
      const fOk = v.frontDims && v.frontDims.endsWith('x4096');
      const bOk = v.backDims && v.backDims.endsWith('x4096');
      frontStatus = fOk ? `OK (${v.frontDims})` : `ERROR (${v.frontDims})`;
      backStatus = bOk ? `OK (${v.backDims})` : `ERROR (${v.backDims})`;
      notes = '';
      if (fOk && bOk) {
        if (it.category === 'bottom') bottomBreakdown.backfilled += 1; else topBreakdown.backfilled += 1;
        totals.backfilled += 1;
      } else {
        if (it.category === 'bottom') bottomBreakdown.errored += 1; else topBreakdown.errored += 1;
        totals.errored += 1;
      }
    } else if (it.match) {
      frontStatus = 'ERROR';
      backStatus = 'ERROR';
      notes = v ? (v.verifyMsg || v.status) : 'no verify entry';
      if (it.category === 'bottom') bottomBreakdown.errored += 1; else topBreakdown.errored += 1;
      totals.errored += 1;
    } else {
      // SKIP path
      frontStatus = 'SKIPPED';
      backStatus = 'SKIPPED';
      if (!it.designNumber && !it.frontUrl && !it.backUrl) {
        notes = 'No design number, no fit-model images — not from a DSLR shoot.';
      } else if (!it.designNumber) {
        notes = 'No design number — cannot match shoot folder.';
      } else {
        notes = 'No matching DSLR shoot folder for this design number.';
      }
      if (it.category === 'bottom') bottomBreakdown.skipped += 1; else topBreakdown.skipped += 1;
      totals.skipped += 1;
    }
  }

  rows.push({
    name: it.name, id: it.id, category: it.category, designNumber: it.designNumber || '-',
    sourceFolder, frontSlot: front, backSlot: back, frontStatus, backStatus, notes,
  });
}

const sections: string[] = [];
sections.push('# 4K Fit-Model Backfill Report');
sections.push('');
sections.push('Replaces canonical wardrobe `fitModels.front` + `fitModels.back` slot files with');
sections.push('4096px-height JPEGs sourced from DSLR/4K originals.');
sections.push('');
sections.push('- Pipeline: EXIF-rotate → resize to height=4096 (preserve aspect) → JPEG q92 mozjpeg → upload to GCS at the existing slot URL.');
sections.push('- The 45° variants (`fitmodel_00`–`_03` when not used as canonical front/back) were left untouched, as were Firestore docs (URLs unchanged).');
sections.push('');
sections.push('## Summary');
sections.push('');
sections.push('| Category | Total | Backfilled | Previously done | Skipped (no folder) | Errored |');
sections.push('|---|--:|--:|--:|--:|--:|');
sections.push(`| **Bottoms** | ${bottomBreakdown.total} | ${bottomBreakdown.backfilled} | ${bottomBreakdown.previouslyCompleted} | ${bottomBreakdown.skipped} | ${bottomBreakdown.errored} |`);
sections.push(`| **Tops** | ${topBreakdown.total} | ${topBreakdown.backfilled} | 0 | ${topBreakdown.skipped} | ${topBreakdown.errored} |`);
sections.push(`| **All** | ${totals.bottoms + totals.tops} | ${totals.backfilled} | ${totals.previouslyCompleted} | ${totals.skipped} | ${totals.errored} |`);
sections.push('');
sections.push('## Per-item results');
sections.push('');
sections.push('| Name | category | designNumber | wardrobeId | source folder | front slot | back slot | front | back | notes |');
sections.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const safeNotes = r.notes.replace(/\|/g, '\\|');
  sections.push(`| ${r.name} | ${r.category} | ${r.designNumber} | \`${r.id}\` | ${r.sourceFolder} | ${r.frontSlot} | ${r.backSlot} | ${r.frontStatus} | ${r.backStatus} | ${safeNotes} |`);
}

sections.push('');
sections.push('## Skipped items (no DSLR shoot folder)');
sections.push('');
sections.push('These items had no matching photoshoot folder. They were uploaded from G-Star.com');
sections.push('product photography, vendor refs, AI mockups, or never had fit-model images.');
sections.push('No backfill attempted; existing URLs untouched.');
sections.push('');
sections.push('| Name | category | designNumber | reason |');
sections.push('|---|---|---|---|');
for (const r of rows) {
  if (r.frontStatus === 'SKIPPED') {
    sections.push(`| ${r.name} | ${r.category} | ${r.designNumber} | ${r.notes.replace(/\|/g, '\\|')} |`);
  }
}

sections.push('');
sections.push('## Provenance');
sections.push('');
sections.push('Each backfilled item used the canonical "directly facing camera" pose (front) and');
sections.push('"directly away from camera" pose (back) from its matched shoot folder. Pose identification:');
sections.push('');
sections.push('- **000 run 09 april** folders contain 6 EXIF-landscape DSLR _DSC files per garment.');
sections.push('  Front frames identified by visible button fly + navel; back frames by symmetric back pockets + leather patch on right hip. The `backfill-fitmodel-4k.ts` script applies `sharp.rotate()` to honor EXIF orientation.');
sections.push('- **shoot April 28 2026** folders contain 6 pre-rotated JPGs at 2608–2644×3908–3962. Pattern is consistently `frame 0 = canonical front`, `frame 3 = canonical back` (frames 1–2 are 45° variants, 4–5 are details/closer crops).');
sections.push('');
sections.push('## Source DSC mapping (backfilled bottoms)');
sections.push('');
sections.push('| wardrobeId | name | source folder | front file | back file |');
sections.push('|---|---|---|---|---|');
const SRCS: Record<string, { folder: string; f: string; b: string }> = {
  '1DnvEYl01rDqggKgKTQa': { folder: 'D21290-A634-G730 3301 FLARE WMN', f: '_DSC4736.JPG', b: '_DSC4739.JPG' },
  'zIevwoBxsrHoqZpqB3sj': { folder: 'D05175-8968-89 3301 SKINNY WMN', f: '_DSC4755.JPG', b: '_DSC4758.JPG' },
  'Hun27VKK37Ca4EWYOsfm': { folder: 'D01896-6553-89 MIDGE BOOTCUT WMN', f: '_DSC4705.JPG', b: '_DSC4754.JPG' },
  'vdOxwqzTUBch6ktkOgfY': { folder: 'D07145-8968-6028 MIDGE SLIM STRAIGHT WMN', f: '_DSC4761.JPG', b: '_DSC4764.JPG' },
  'OnOe3MaP00xavnoRtNN7': { folder: 'D15264-C052-D332 KATE BOYFRIEND WMN', f: '_DSC4719.JPG', b: '_DSC4751.JPG' },
  'YOiSIPlqgjcduhR3R6Ix': { folder: 'D15264-D931-H095 KATE BOYFIEND WMN', f: '_DSC4767.JPG', b: '_DSC4771.JPG' },
  '6weuQ0caKivxaSTkr4Cw': { folder: 'D22889-D933-H087 JUDEE LOOSE WMN', f: '_DSC4745.JPG', b: '_DSC4748.JPG' },
  'D1gooqDdFnvbzX6iDUHg': { folder: 'D26163-E205-H914 G-STRAIGHT', f: '_DSC4724.JPG', b: '_DSC4729.JPG' },
  'TT2f4TLx5SmYUFX8Yw0d': { folder: 'D26163-E205-H918 G-STRAIGHT WMN', f: '_DSC4730.JPG', b: '_DSC4733.JPG' },
  'C8inPAjtaie8SxdMjs1s': { folder: 'D21290-D987-H280 53', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  '8gr2tzr9Er8m00ZmRzLi': { folder: 'D21290-D987-H281 61', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'Rq3K3UQGdJmVu4W0LwgK': { folder: 'D25372-E266-H545 53', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'IUqRKvjYj96i29RvdsbO': { folder: 'D22889-D436-C947 52', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'ME7QswY55jaCJQXGi3lc': { folder: 'D22889-D536-G841 53', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'OEyZ0lrt7soRIba963pI': { folder: 'D15264-C052-A802 51', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  '5LCOIQVA7GARxf33WxCY': { folder: 'D15264-C052-8436 53', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  '6aN3Hxx0GFJFCW9U2Oyj': { folder: 'D15264-D775-G803 61', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'PWYdwXzb61EXfjhSdulq': { folder: 'D15264-C293-B168 62', f: 'frame 0.jpg', b: 'frame 3.jpg' },
  'shU8uNGorWXuyMqS8Iis': { folder: 'D02153-6553-89 52', f: 'frame 0.jpg', b: 'frame 3.jpg' },
};
const okRows = rows.filter(r => r.frontStatus.startsWith('OK (') && r.id in SRCS);
for (const r of okRows) {
  const s = SRCS[r.id];
  sections.push(`| \`${r.id}\` | ${r.name} | ${s.folder} | ${s.f} | ${s.b} |`);
}

sections.push('');
sections.push('## Tops summary');
sections.push('');
sections.push(`All ${topBreakdown.total} tops were skipped — none had a matching DSLR fit-model shoot folder.`);
sections.push('Most tops in the wardrobe are studio shots with no fit-model imagery, or were sourced');
sections.push('from G-Star.com product photography. Five top items carry design numbers');
sections.push('(`D23007-E358-D926`, `D29107-E358-D926`, `D28956-E513-1603`, `D27939-E680-001-61`,');
sections.push('`D29076-C895-110`, `D29076-D592-G459`, `d28476-d788-082`) but none of the photoshoot folders');
sections.push('listed (000 run 09 april, AI shoot 24-3-26, new ai shoot 01042026, shoot April 28 2026)');
sections.push('contain matching fit-model shoots for these.');
sections.push('');
sections.push('## Notes on "new ai shoot 01042026" bottoms');
sections.push('');
sections.push('Six bottoms with design numbers `D27690-D315-001`, `D27690-D788-H117`, `D28619-E460`,');
sections.push('`D29074-E540-D926`, `D29953-E875-J648`, `D30419-E358-D926` have folders under that path,');
sections.push('but those folders contain only PNG flat product shots (the same images currently used as');
sections.push('the existing low-res fit-model assets, per the file names). No DSLR fit-model originals');
sections.push('are present for these items in any indexed source. Skipped.');

fs.writeFileSync("/Users/bdheedene/Documents/Claude folder DON't remove/gstar/BACKFILL_FITMODEL_4K_REPORT.md", sections.join('\n') + '\n');
console.log('Wrote /Users/bdheedene/Documents/Claude folder DON\\\'t remove/gstar/BACKFILL_FITMODEL_4K_REPORT.md');
