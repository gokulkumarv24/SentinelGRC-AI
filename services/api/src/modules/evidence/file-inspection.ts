import { fileTypeFromBuffer } from 'file-type';
import { extname } from 'node:path';
import { badRequest } from '../../common/errors.js';

const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.log': 'text/plain',
};

/** Types safe to render in the browser (inside a sandboxed response). Everything else is forced to download. */
export const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv']);

/**
 * Determines the real media type from file content (magic bytes), ignoring the browser-supplied MIME type
 * (spec §8.4). Text formats have no magic bytes, so they must be valid UTF-8 without NUL bytes.
 */
export async function inspectFile(buffer: Buffer, originalName: string, allowed: string[]): Promise<{ mediaType: string; safeName: string }> {
  const safeName = sanitizeFilename(originalName);
  const ext = extname(safeName).toLowerCase();
  const detected = await fileTypeFromBuffer(buffer);
  let mediaType: string;
  if (detected) {
    mediaType = detected.mime;
    const expectedExt = `.${detected.ext}`;
    const aliases: Record<string, string[]> = { '.jpg': ['.jpeg', '.jpg'] };
    if (ext && ext !== expectedExt && !(aliases[expectedExt] ?? []).includes(ext)) {
      throw badRequest('file_type_mismatch', `The file content (${detected.ext}) does not match its extension (${ext}).`);
    }
  } else {
    const textType = TEXT_TYPES[ext];
    if (!textType || !isPlainText(buffer)) throw badRequest('unsupported_file_type', 'This file type is not allowed.');
    mediaType = textType;
  }
  if (!allowed.includes(mediaType)) throw badRequest('unsupported_file_type', `Files of type ${mediaType} are not allowed.`);
  return { mediaType, safeName };
}

function isPlainText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/** Keeps a display name only: no directories, control characters or reserved characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKC')
    // oxlint-disable-next-line no-control-regex -- intentionally strips control characters from filenames
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}

/** Content-Disposition value safe for any filename (RFC 6266 / 5987). */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
