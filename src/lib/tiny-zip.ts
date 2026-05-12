/**
 * Minimal STORED-mode zip writer (no compression, no deps).
 *
 * Built because the dev sandbox blocks `npm install` so we can't pull in
 * `archiver`. STORED is fine here — the deliverable files are JPEGs, which
 * are already entropy-compressed; DEFLATE would gain ~0% and burn CPU.
 *
 * Output is a fully-valid .zip that opens in any unzipper (macOS Archive
 * Utility, 7-Zip, Windows Explorer, `unzip` CLI, etc.).
 *
 * Spec reference: PKWARE APPNOTE.TXT (ZIP File Format) sections 4.3.6, 4.3.7,
 * 4.3.16. Local file header → file data → central directory → EOCD record.
 */
import { crc32 } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataLen = entry.data.length;
    const crc = crc32(entry.data);

    // ── Local file header (30 bytes) + filename + data ──
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed to extract
    local.writeUInt16LE(0x0800, 6);       // general purpose bit flag (UTF-8 filename)
    local.writeUInt16LE(0, 8);            // compression method = stored
    local.writeUInt16LE(0, 10);           // last mod time
    local.writeUInt16LE(0, 12);           // last mod date
    local.writeUInt32LE(crc, 14);         // CRC-32 of uncompressed data
    local.writeUInt32LE(dataLen, 18);     // compressed size
    local.writeUInt32LE(dataLen, 22);     // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // filename length
    local.writeUInt16LE(0, 28);           // extra field length

    localParts.push(local, nameBuf, entry.data);

    // ── Central directory file header (46 bytes) + filename ──
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);     // flags (UTF-8)
    central.writeUInt16LE(0, 10);         // compression method
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);       // CRC-32
    central.writeUInt32LE(dataLen, 20);   // compressed size
    central.writeUInt32LE(dataLen, 24);   // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // filename length
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // offset of local header

    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + dataLen;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const centralOffset = localBuf.length;
  const centralSize = centralBuf.length;

  // ── End of central directory record (22 bytes) ──
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);   // EOCD signature
  eocd.writeUInt16LE(0, 4);            // disk number
  eocd.writeUInt16LE(0, 6);            // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);    // central dir size
  eocd.writeUInt32LE(centralOffset, 16);  // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}
