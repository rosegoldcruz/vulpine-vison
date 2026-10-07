import 'server-only';
import { ApiServiceError } from './errors';

export async function readLimitedJson(request: Request, maxBytes = 128 * 1024): Promise<unknown> {
  if (!request.body) throw new ApiServiceError('VALIDATION_ERROR', 'JSON body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ApiServiceError('PAYLOAD_TOO_LARGE', 'JSON body exceeds the request limit.', 413);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ApiServiceError('VALIDATION_ERROR', 'Invalid JSON body.', 400);
    }
  } finally {
    reader.releaseLock();
  }
}
