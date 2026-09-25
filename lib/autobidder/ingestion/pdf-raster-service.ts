import 'server-only';

import { createHash } from 'node:crypto';
import path from 'path';
import { createCanvas } from 'canvas';

export type RasterArtifactFormat = 'jpeg' | 'png';

export interface PdfRasterLimits {
  requestedDpi: number;
  maxDpi: number;
  maxPages: number;
  maxInputBytes: number;
  maxPixelsPerPage: number;
  maxDimensionPixels: number;
  maxArtifactBytesPerPage: number;
  format: RasterArtifactFormat;
  jpegQuality: number;
}

export const DEFAULT_PDF_RASTER_LIMITS: Readonly<PdfRasterLimits> = Object.freeze({
  requestedDpi: 200,
  maxDpi: 300,
  maxPages: 1_500,
  maxInputBytes: 1024 * 1024 * 1024,
  maxPixelsPerPage: 40_000_000,
  maxDimensionPixels: 16_384,
  maxArtifactBytesPerPage: 64 * 1024 * 1024,
  format: 'jpeg',
  jpegQuality: 0.92,
});

export interface PdfRasterRequest {
  sourceDocumentId: string;
  documentName: string;
  pdf: Buffer;
  limits?: Partial<PdfRasterLimits>;
}

export interface RasterizedPdfPage {
  pageIdentity: string;
  sourceDocumentId: string;
  documentName: string;
  pageNumber: number;
  pageCount: number;
  rotationDegrees: number;
  widthPoints: number;
  heightPoints: number;
  widthPixels: number;
  heightPixels: number;
  requestedDpi: number;
  effectiveDpi: number;
  downscaledToSafetyLimit: boolean;
  mimeType: 'image/jpeg' | 'image/png';
  artifact: Buffer;
  artifactSha256: string;
  renderDurationMs: number;
}

export class PdfRasterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'PdfRasterError';
  }
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Canvas dimensions must be positive.');
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext: ReturnType<NodeCanvasFactory['create']>, width: number, height: number) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }

  destroy(canvasAndContext: ReturnType<NodeCanvasFactory['create']>) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

function withRasterDefaults(overrides: Partial<PdfRasterLimits> = {}): PdfRasterLimits {
  const limits = { ...DEFAULT_PDF_RASTER_LIMITS, ...overrides };
  const positiveFields: Array<keyof PdfRasterLimits> = [
    'requestedDpi',
    'maxDpi',
    'maxPages',
    'maxInputBytes',
    'maxPixelsPerPage',
    'maxDimensionPixels',
    'maxArtifactBytesPerPage',
  ];
  for (const field of positiveFields) {
    const value = limits[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new PdfRasterError('INVALID_RASTER_LIMIT', `Raster limit ${field} must be a positive finite number.`, {
        field,
        value,
      });
    }
  }
  if (limits.jpegQuality <= 0 || limits.jpegQuality > 1) {
    throw new PdfRasterError('INVALID_JPEG_QUALITY', 'JPEG quality must be greater than 0 and at most 1.', {
      jpegQuality: limits.jpegQuality,
    });
  }
  return limits;
}

function pdfAssetOptions() {
  // Keep this as a runtime filesystem path. Next's server bundler rewrites
  // require.resolve('pdfjs-dist/package.json') to a numeric module id, which
  // made path.dirname throw before pdf.js could open an otherwise valid PDF.
  const packageRoot = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
  const asDirectoryUrl = (child: string) => `${path.join(packageRoot, child).replace(/\\/g, '/')}/`;
  return {
    cMapUrl: asDirectoryUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asDirectoryUrl('standard_fonts'),
    wasmUrl: asDirectoryUrl('wasm'),
  };
}

function boundedPageScale(
  page: any,
  limits: PdfRasterLimits,
): { viewport: any; requestedDpi: number; effectiveDpi: number; downscaled: boolean } {
  const requestedDpi = Math.min(limits.requestedDpi, limits.maxDpi);
  const requestedScale = requestedDpi / 72;
  const requestedViewport = page.getViewport({ scale: requestedScale });
  const requestedPixels = requestedViewport.width * requestedViewport.height;
  const pixelFactor = requestedPixels > limits.maxPixelsPerPage
    ? Math.sqrt(limits.maxPixelsPerPage / requestedPixels)
    : 1;
  const dimensionFactor = Math.min(
    1,
    limits.maxDimensionPixels / requestedViewport.width,
    limits.maxDimensionPixels / requestedViewport.height,
  );
  const safetyFactor = Math.min(pixelFactor, dimensionFactor);
  const effectiveScale = requestedScale * safetyFactor;
  if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) {
    throw new PdfRasterError('INVALID_PAGE_DIMENSIONS', 'PDF page dimensions cannot be rasterized safely.');
  }
  return {
    viewport: page.getViewport({ scale: effectiveScale }),
    requestedDpi: limits.requestedDpi,
    effectiveDpi: effectiveScale * 72,
    downscaled: limits.requestedDpi > limits.maxDpi || safetyFactor < 0.999999,
  };
}

export async function* iteratePdfRasterPages(request: PdfRasterRequest): AsyncGenerator<RasterizedPdfPage> {
  const limits = withRasterDefaults(request.limits);
  if (!request.sourceDocumentId.trim()) {
    throw new PdfRasterError('SOURCE_DOCUMENT_ID_REQUIRED', 'A stable source-document identity is required.');
  }
  if (!request.documentName.trim()) {
    throw new PdfRasterError('DOCUMENT_NAME_REQUIRED', 'A source-document name is required.');
  }
  if (request.pdf.length === 0) {
    throw new PdfRasterError('EMPTY_PDF', 'Cannot rasterize an empty PDF.');
  }
  if (request.pdf.length > limits.maxInputBytes) {
    throw new PdfRasterError('PDF_INPUT_TOO_LARGE', 'PDF exceeds the configured input-size limit.', {
      actualBytes: request.pdf.length,
      maxBytes: limits.maxInputBytes,
    });
  }

  let pdfjs: any;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    pdfjs = await import('pdfjs-dist');
  }

  let document: any;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(request.pdf),
      CanvasFactory: NodeCanvasFactory,
      ...pdfAssetOptions(),
    }).promise;
  } catch (error) {
    throw new PdfRasterError('PDF_OPEN_FAILED', 'PDF is corrupt, encrypted, or unreadable.', {
      documentName: request.documentName,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (document.numPages > limits.maxPages) {
      throw new PdfRasterError('PDF_PAGE_LIMIT_EXCEEDED', 'PDF contains more pages than the configured raster limit.', {
        actualPages: document.numPages,
        maxPages: limits.maxPages,
      });
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      let page: any;
      try {
        page = await document.getPage(pageNumber);
      } catch (error) {
        throw new PdfRasterError('PDF_PAGE_READ_FAILED', 'Failed to read a PDF page for rasterization.', {
          pageNumber,
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      const canvasFactory = new NodeCanvasFactory();
      let canvasAndContext: ReturnType<NodeCanvasFactory['create']> | undefined;
      try {
        const pointViewport = page.getViewport({ scale: 1 });
        const bounded = boundedPageScale(page, limits);
        canvasAndContext = canvasFactory.create(bounded.viewport.width, bounded.viewport.height);
        const startedAt = Date.now();
        await page.render({
          canvas: canvasAndContext.canvas,
          viewport: bounded.viewport,
          background: '#FFFFFF',
        }).promise;

        const artifact = limits.format === 'png'
          ? canvasAndContext.canvas.toBuffer('image/png')
          : canvasAndContext.canvas.toBuffer('image/jpeg', { quality: limits.jpegQuality });
        if (artifact.length > limits.maxArtifactBytesPerPage) {
          throw new PdfRasterError('RASTER_ARTIFACT_TOO_LARGE', 'Rendered page exceeds the configured artifact-size limit.', {
            pageNumber,
            actualBytes: artifact.length,
            maxBytes: limits.maxArtifactBytesPerPage,
          });
        }

        yield {
          pageIdentity: `${request.sourceDocumentId}:page:${pageNumber}`,
          sourceDocumentId: request.sourceDocumentId,
          documentName: request.documentName,
          pageNumber,
          pageCount: document.numPages,
          rotationDegrees: Number(page.rotate || 0),
          widthPoints: pointViewport.width,
          heightPoints: pointViewport.height,
          widthPixels: canvasAndContext.canvas.width,
          heightPixels: canvasAndContext.canvas.height,
          requestedDpi: bounded.requestedDpi,
          effectiveDpi: bounded.effectiveDpi,
          downscaledToSafetyLimit: bounded.downscaled,
          mimeType: limits.format === 'png' ? 'image/png' : 'image/jpeg',
          artifact,
          artifactSha256: createHash('sha256').update(artifact).digest('hex'),
          renderDurationMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof PdfRasterError) throw error;
        throw new PdfRasterError('PDF_PAGE_RENDER_FAILED', 'Failed to rasterize a PDF page.', {
          pageNumber,
          cause: error instanceof Error ? error.message : String(error),
        });
      } finally {
        try {
          page.cleanup();
        } catch {}
        if (canvasAndContext) canvasFactory.destroy(canvasAndContext);
      }
    }
  } finally {
    try {
      await document.destroy();
    } catch {}
  }
}

export async function renderPdfToBuffers(request: PdfRasterRequest): Promise<RasterizedPdfPage[]> {
  const pages: RasterizedPdfPage[] = [];
  for await (const page of iteratePdfRasterPages(request)) pages.push(page);
  return pages;
}
