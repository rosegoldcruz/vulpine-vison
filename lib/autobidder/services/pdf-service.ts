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
    classification: ClassifiedPage['classification'];
    confidence: number;
    reason: string;
  }>;
}

function classifyPageText(text: string): {
  classification: ClassifiedPage['classification'];
  confidence: number;
  reason: string;
} {
  const t = text.toLowerCase();
  if (t.includes('unit matrix') || t.includes('unit mix')) {
    return { classification: 'UNIT_MATRIX', confidence: 0.85, reason: 'Detected unit matrix keywords.' };
  }
  if (t.includes('kitchen elevation')) {
    return { classification: 'KITCHEN_ELEVATION', confidence: 0.8, reason: 'Detected kitchen elevation keywords.' };
  }
  if (t.includes('bath elevation') || t.includes('vanity')) {
    return { classification: 'BATH_ELEVATION', confidence: 0.8, reason: 'Detected bathroom elevation keywords.' };
  }
  if (t.includes('schedule') && t.includes('casework')) {
    return { classification: 'CASEWORK_SCHEDULE', confidence: 0.8, reason: 'Detected casework schedule keywords.' };
  }
  if (t.includes('cover') || t.includes('title sheet')) {
    return { classification: 'COVER', confidence: 0.7, reason: 'Detected cover/title keywords.' };
  }
  if (t.includes('index') || t.includes('sheet index')) {
    return { classification: 'INDEX', confidence: 0.75, reason: 'Detected index keywords.' };
  }
  return { classification: 'UNKNOWN', confidence: 0.3, reason: 'No reliable cabinet-estimating pattern detected.' };
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
    pages.push({
      pageNumber: i,
      text,
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
