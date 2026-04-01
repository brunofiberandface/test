/**
 * Google Drive integration for G-Star AI Studio.
 * Manages per-design-number folder structure:
 *   G-Star AI Studio / {designNumber} / input / {360, flat}
 *   G-Star AI Studio / {designNumber} / output / {working, final}
 */

import { google } from 'googleapis';

async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// Cache folder IDs to avoid repeated lookups
const folderCache = new Map<string, string>();

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string> {
  const cacheKey = `${parentId || 'root'}/${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  // Search for existing
  const query = parentId
    ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const res = await drive.files.list({ q: query, fields: 'files(id)' });

  if (res.data.files?.length) {
    const id = res.data.files[0].id!;
    folderCache.set(cacheKey, id);
    return id;
  }

  // Create new
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });

  const id = folder.data.id!;
  folderCache.set(cacheKey, id);
  return id;
}

/**
 * Ensure the full folder structure exists for a design number.
 * Returns folder IDs for each subfolder.
 */
export async function ensureDesignFolders(designNumber: string) {
  const drive = await getDriveClient();

  const rootId = await findOrCreateFolder(drive, 'G-Star AI Studio');
  const designId = await findOrCreateFolder(drive, designNumber, rootId);
  const inputId = await findOrCreateFolder(drive, 'input', designId);
  const input360Id = await findOrCreateFolder(drive, '360', inputId);
  const inputFlatId = await findOrCreateFolder(drive, 'flat', inputId);
  const outputId = await findOrCreateFolder(drive, 'output', designId);
  const workingId = await findOrCreateFolder(drive, 'working', outputId);
  const finalId = await findOrCreateFolder(drive, 'final', outputId);

  return { rootId, designId, inputId, input360Id, inputFlatId, outputId, workingId, finalId };
}

/**
 * Upload a generated image to the working folder.
 */
export async function uploadToWorking(
  designNumber: string,
  filename: string,
  imageBuffer: Buffer,
  mimeType = 'image/png'
): Promise<string> {
  const drive = await getDriveClient();
  const folders = await ensureDesignFolders(designNumber);

  const { Readable } = await import('stream');

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folders.workingId],
    },
    media: {
      mimeType,
      body: Readable.from(imageBuffer),
    },
    fields: 'id,webViewLink',
  });

  return file.data.id!;
}

/**
 * Move a file from working/ to final/ (on approval).
 * Strips version suffix from filename (M1_M01_v2.png → M1_M01.png).
 */
export async function moveToFinal(
  designNumber: string,
  fileId: string,
  finalFilename: string
): Promise<void> {
  const drive = await getDriveClient();
  const folders = await ensureDesignFolders(designNumber);

  // Get current parents
  const file = await drive.files.get({ fileId, fields: 'parents' });
  const previousParents = file.data.parents?.join(',') || '';

  // Move to final folder + rename
  await drive.files.update({
    fileId,
    addParents: folders.finalId,
    removeParents: previousParents,
    requestBody: { name: finalFilename },
    fields: 'id',
  });
}

/**
 * Upload input images (360 or flat) to the input folder.
 */
export async function uploadInput(
  designNumber: string,
  type: '360' | 'flat',
  filename: string,
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<string> {
  const drive = await getDriveClient();
  const folders = await ensureDesignFolders(designNumber);
  const parentId = type === '360' ? folders.input360Id : folders.inputFlatId;

  const { Readable } = await import('stream');

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: Readable.from(imageBuffer),
    },
    fields: 'id',
  });

  return file.data.id!;
}
