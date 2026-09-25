import 'server-only';
import type { ClassifiedPage } from '@/types';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

export interface ParsedPdf {
  documentName: string;
  pageCount: number;
  fileSizeBytes: number;
  metadataDurationMs: number;
  textExtractionDurationMs: number;
  textExtractionAttempts: number;
  pages: Array<{
    pageNumber: number;
    text: string;
    sheetNumber?: string;
    sheetTitle?: string;
    classification: ClassifiedPage['classification'];
    confidence: number;
    reason: string;
  }>;
}

export function classifyPageText(text: string): {
  classification: ClassifiedPage['classification'];
  confidence: number;
  reason: string;
} {
  const t = text.toLowerCase();
  if (/\b(enlarged\s+)?unit\s+(floor\s+)?plan\b/.test(t) || /\bapartment\s+plan\b/.test(t)) {
    return { classification: 'UNIT_PLAN', confidence: 0.86, reason: 'Detected unit or enlarged-unit plan terminology in extracted source text.' };
  }
  if (t.includes('unit matrix') || t.includes('unit mix')) {
    return { classification: 'UNIT_MATRIX', confidence: 0.85, reason: 'Detected unit matrix keywords.' };
  }
  if (t.includes('kitchen elevation')) {
    return { classification: 'KITCHEN_ELEVATION', confidence: 0.8, reason: 'Detected kitchen elevation keywords.' };
  }
  if (t.includes('bath elevation') || t.includes('vanity')) {
    return { classification: 'BATH_ELEVATION', confidence: 0.8, reason: 'Detected bathroom elevation keywords.' };
  }
  if (t.includes('interior elevation')) {
    return { classification: 'INTERIOR_ELEVATION', confidence: 0.78, reason: 'Detected interior elevation terminology.' };
  }
  if (t.includes('schedule') && (t.includes('casework') || t.includes('millwork') || t.includes('cabinet'))) {
    return { classification: 'CASEWORK_SCHEDULE', confidence: 0.84, reason: 'Detected cabinet, millwork, or casework schedule terminology.' };
  }
  if (t.includes('finish schedule') || (t.includes('finish') && t.includes('schedule'))) {
    return { classification: 'FINISH_SCHEDULE', confidence: 0.79, reason: 'Detected finish schedule terminology.' };
  }
  if (t.includes('appliance schedule') || (t.includes('appliance') && t.includes('schedule'))) {
    return { classification: 'APPLIANCE_SCHEDULE', confidence: 0.82, reason: 'Detected appliance schedule terminology.' };
  }
  if (/\b(ada|accessible|accessibility|type\s+a)\b/.test(t)) {
    return { classification: 'ACCESSIBILITY', confidence: 0.78, reason: 'Detected ADA, accessibility, or Type A terminology.' };
  }
  if (t.includes('architectural detail') || /\bdetail\s+[a-z0-9]+\b/.test(t)) {
    return { classification: 'DETAIL', confidence: 0.68, reason: 'Detected architectural detail terminology; human review remains advisable.' };
  }
  if (t.includes('floor plan')) {
    return { classification: 'FLOOR_PLAN', confidence: 0.68, reason: 'Detected floor plan terminology without a reliable unit-plan identifier.' };
  }
  if (t.includes('cover') || t.includes('title sheet')) {
    return { classification: 'COVER', confidence: 0.7, reason: 'Detected cover/title keywords.' };
  }
  if (t.includes('index') || t.includes('sheet index')) {
    return { classification: 'INDEX', confidence: 0.75, reason: 'Detected index keywords.' };
  }
  if (/\b(civil|grading|drainage|landscape|structural|electrical|fire alarm)\b/.test(t) && !/\b(cabinet|casework|millwork|kitchen|vanity)\b/.test(t)) {
    return { classification: 'IRRELEVANT', confidence: 0.7, reason: 'Detected a non-cabinet discipline without cabinet-estimating terminology.' };
  }
  return { classification: 'UNKNOWN', confidence: 0.3, reason: 'No reliable cabinet-estimating pattern detected.' };
}

function sheetMetadata(text: string): { sheetNumber?: string; sheetTitle?: string } {
  const compact = text.replace(/\s+/g, ' ').trim();
  const number = compact.match(/(?:sheet(?:\s+no\.?|\s+number)?\s*[:#-]?\s*)?\b([A-Z]{1,3}[-.]?\d{2,4}(?:\.\d{1,2})?)\b/i)?.[1];
  const title = compact.match(/\b(kitchen elevations?|bath(?:room)? elevations?|interior elevations?|unit (?:floor )?plans?|unit matrix|casework schedule|millwork schedule|finish schedule|appliance schedule|accessibility plan)\b/i)?.[1];
  return { sheetNumber: number?.toUpperCase(), sheetTitle: title ? title.replace(/\b\w/g, (character) => character.toUpperCase()) : undefined };
}

export async function parsePdf(buffer: Buffer, documentName: string): Promise<ParsedPdf> {
  const metadataStart = Date.now();
  let pdfjsLib: any;
  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    pdfjsLib = await import('pdfjs-dist');
  }

  let pdf: any;
  try {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    pdf = await task.promise;
  } catch {
    throw new ApiServiceError('CORRUPT_PDF', 'PDF file is corrupt or unreadable.', 400, {
      documentName,
    });
  }
  const metadataDurationMs = Date.now() - metadataStart;

  const textStart = Date.now();
  const pages: ParsedPdf['pages'] = [];
  let textExtractionAttempts = 0;

  for (let i = 1; i <= pdf.numPages; i += 1) {
    textExtractionAttempts += 1;
    let page: any;
    try {
      page = await pdf.getPage(i);
    } catch {
      throw new ApiServiceError('PDF_PAGE_READ_FAILED', 'Failed to read a PDF page.', 400, {
        documentName,
        pageNumber: i,
      });
    }

    let content: any;
    try {
      content = await page.getTextContent();
    } catch {
      throw new ApiServiceError('PDF_TEXT_EXTRACTION_FAILED', 'Failed to extract text from a PDF page.', 400, {
        documentName,
        pageNumber: i,
      });
    }
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();
    const classification = classifyPageText(text);
    const metadata = sheetMetadata(text);
    pages.push({
      pageNumber: i,
      text,
      ...metadata,
      classification: classification.classification,
      confidence: classification.confidence,
      reason: classification.reason,
    });
  }

  return {
    documentName,
    pageCount: pdf.numPages,
    fileSizeBytes: buffer.length,
    metadataDurationMs,
    textExtractionDurationMs: Date.now() - textStart,
    textExtractionAttempts,
    pages,
  };
}
