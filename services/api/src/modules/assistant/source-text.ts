import { extractText, getDocumentProxy } from 'unpdf';

export interface ExtractedText {
  /** Text segments with a locator (page number for PDFs). */
  segments: Array<{ locator: string; text: string }>;
  limitation?: string;
}

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'application/json']);

/** Text extraction for evidence files. Files are parsed, never executed; unsupported types yield a limitation. */
export async function extractEvidenceText(buffer: Buffer, mediaType: string | null): Promise<ExtractedText> {
  if (mediaType && TEXT_TYPES.has(mediaType)) return { segments: [{ locator: 'file', text: buffer.toString('utf8') }] };
  if (mediaType === 'application/pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: false });
      const segments = (text as string[]).map((t, i) => ({ locator: `page ${i + 1}`, text: t.replace(/\s+/g, ' ').trim() })).filter((s) => s.text);
      return segments.length ? { segments } : { segments: [], limitation: 'The PDF contains no extractable text (it may be a scanned image); it was not analysed.' };
    } catch {
      return { segments: [], limitation: 'The PDF could not be parsed; it was not analysed.' };
    }
  }
  return { segments: [], limitation: `Files of type ${mediaType ?? 'unknown'} are not analysed (no text extraction for this type).` };
}

/** Splits text into sentences for extractive drafting. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 600);
}
