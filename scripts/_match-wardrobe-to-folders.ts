/**
 * Reads /tmp/wardrobe_audit.json and /tmp/shoot_folders.json, then for each
 * wardrobe item attempts to match it to a folder by design number prefix.
 * Outputs a JSON match plan.
 */
import * as fs from 'fs';

interface Item { id: string; name: string; designNumber: string; category: string; frontUrl: string|null; backUrl: string|null; }
interface Folder { folderName: string; fullPath: string; dPrefix: string; dscPath: string|null; dscFiles: string[]; }

const items: Item[] = JSON.parse(fs.readFileSync('/tmp/wardrobe_audit.json', 'utf-8'));
const folders: Folder[] = JSON.parse(fs.readFileSync('/tmp/shoot_folders.json', 'utf-8'));

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

function dnumKey(s: string): string {
  // pick everything up to first space; strip trailing alphanumeric after the design number
  // e.g. "D22889-D436-D331" or "D22889-D436-C947 52"
  return normalize(s);
}

interface Match { folder: Folder; score: number; reason: string; }

function matchItem(it: Item): Match | null {
  if (!it.designNumber) return null;
  const want = dnumKey(it.designNumber);
  // exact dPrefix match (case-insensitive, normalized whitespace)
  let best: Match | null = null;
  for (const f of folders) {
    if (!f.dscPath || f.dscFiles.length < 2) continue;
    const have = normalize(f.dPrefix);
    if (have === want) {
      const m = { folder: f, score: 100, reason: 'exact-dPrefix' };
      if (!best || m.score > best.score) best = m;
    }
  }
  if (best) return best;
  // prefix match: wardrobe designNumber starts with folder dPrefix or vice versa
  for (const f of folders) {
    if (!f.dscPath || f.dscFiles.length < 2) continue;
    const have = normalize(f.dPrefix);
    if (!have) continue;
    if (want.startsWith(have) || have.startsWith(want)) {
      const score = Math.min(have.length, want.length);
      if (!best || score > best.score) best = { folder: f, score, reason: 'prefix-overlap' };
    }
  }
  if (best) return best;
  // also try matching the FIRST 3 hyphen-segments (full D-id only) e.g. D22889-D436-D331
  const wantCore = want.match(/^D\d+(?:-[A-Z0-9]+){0,3}/i)?.[0] || '';
  if (wantCore.length >= 10) {
    for (const f of folders) {
      if (!f.dscPath || f.dscFiles.length < 2) continue;
      const have = normalize(f.dPrefix);
      const haveCore = have.match(/^D\d+(?:-[A-Z0-9]+){0,3}/i)?.[0] || '';
      if (haveCore && haveCore === wantCore) {
        const score = haveCore.length;
        if (!best || score > best.score) best = { folder: f, score, reason: 'core-match' };
      }
    }
  }
  return best;
}

interface Out {
  id: string; name: string; designNumber: string; category: string;
  frontUrl: string|null; backUrl: string|null;
  match: { folderName: string; dscPath: string; dscFiles: string[]; score: number; reason: string } | null;
}
const out: Out[] = items.map(it => {
  const m = matchItem(it);
  return {
    id: it.id,
    name: it.name,
    designNumber: it.designNumber,
    category: it.category,
    frontUrl: it.frontUrl,
    backUrl: it.backUrl,
    match: m ? { folderName: m.folder.folderName, dscPath: m.folder.dscPath!, dscFiles: m.folder.dscFiles, score: m.score, reason: m.reason } : null,
  };
});

console.log(JSON.stringify(out, null, 2));
