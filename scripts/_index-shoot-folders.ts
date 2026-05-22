/**
 * One-off: index all photoshoot folders to a JSON mapping D-number prefix → full path.
 * Searches the 5 documented shoot locations.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = [
  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/000 run 09 april",
  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/AI shoot 24-3-26/MEN",
  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/AI shoot 24-3-26/WOMEN",
  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/new ai shoot 01042026",
  "/Users/bdheedene/Documents/Claude folder DON't remove/gstar/shoot April 28 2026",
];

interface Entry { folderName: string; fullPath: string; dPrefix: string; jpgCount: number; dscPath: string | null; dscFiles: string[]; }
const entries: Entry[] = [];

function findDscFolder(root: string): { dscPath: string | null; dscFiles: string[] } {
  // BFS up to depth 3 for first folder that contains _DSC*.JPG files
  const queue: { p: string; depth: number }[] = [{ p: root, depth: 0 }];
  while (queue.length) {
    const { p, depth } = queue.shift()!;
    if (depth > 3) continue;
    let items: string[] = [];
    try { items = fs.readdirSync(p); } catch { continue; }
    const dscs = items.filter(f => /^_DSC\d+\.JPG$/i.test(f)).sort();
    if (dscs.length >= 2) return { dscPath: p, dscFiles: dscs };
    // also accept "<designnumber> 0.jpg .. 5.jpg" naming used in shoot April 28 2026
    const numbered = items.filter(f => /^D\d+.* \d+\.jpg$/i.test(f)).sort();
    if (numbered.length >= 2) return { dscPath: p, dscFiles: numbered };
    for (const item of items) {
      const sub = path.join(p, item);
      try {
        if (fs.statSync(sub).isDirectory()) queue.push({ p: sub, depth: depth + 1 });
      } catch { /* skip */ }
    }
  }
  return { dscPath: null, dscFiles: [] };
}

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    // extract D-prefix
    const m = name.match(/^(D\d{3,}(?:-[A-Z0-9]+)*(?:\s+\d+)?)/i);
    const dPrefix = m ? m[1].trim() : '';
    // count JPGs (top level only)
    let jpgCount = 0;
    try {
      for (const f of fs.readdirSync(full)) {
        if (/\.jpg$/i.test(f)) jpgCount++;
      }
    } catch { /* skip */ }
    const { dscPath, dscFiles } = findDscFolder(full);
    entries.push({ folderName: name, fullPath: full, dPrefix, jpgCount, dscPath, dscFiles });
  }
}

console.log(JSON.stringify(entries, null, 2));
