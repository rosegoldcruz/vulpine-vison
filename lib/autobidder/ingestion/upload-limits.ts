import 'server-only';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

// Policy budgets keep multipart copies and extracted files below the worker's
// memory limit. Larger plan sets must be divided into separate uploads.
export const VISION_UPLOAD_LIMITS = Object.freeze({
  maxBodyBytes: 128 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
  maxFiles: 100,
  maxEntries: 2_000,
});

const uploadStateKey = Symbol.for('vulpine.vision.upload-capacity');
const sharedState = globalThis as typeof globalThis & { [uploadStateKey]?: { active: boolean } };
const uploadState = sharedState[uploadStateKey] ??= { active: false };
export function reserveUpload(): () => void {
  if (uploadState.active) throw new ApiServiceError('UPLOAD_BUSY', 'An upload is already being ingested. Try again shortly.', 429);
  uploadState.active = true;
  let released = false;
  return () => { if (!released) { released = true; uploadState.active = false; } };
}

export async function readLimitedUploadFormData(request: Request, maxBytes = VISION_UPLOAD_LIMITS.maxBodyBytes): Promise<FormData> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new ApiServiceError('VALIDATION_ERROR', 'A multipart upload is required.', 400);
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ApiServiceError('UPLOAD_TOO_LARGE', 'Upload exceeds the request byte limit.', 413);
  if (!request.body) throw new ApiServiceError('UPLOAD_FILES_REQUIRED', 'Upload body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new ApiServiceError('UPLOAD_TIMEOUT', 'Upload body exceeded the intake time limit.', 408)), 60_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ApiServiceError('UPLOAD_TOO_LARGE', 'Upload exceeds the request byte limit.', 413);
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, size);
    chunks.length = 0;
    return await new Response(new Uint8Array(bytes), { headers: { 'content-type': contentType } }).formData();
  } finally {
    clearTimeout(timeout!);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
