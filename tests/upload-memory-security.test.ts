import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLimitedUploadFormData, reserveUpload } from '@/lib/autobidder/ingestion/upload-limits';

afterEach(() => vi.useRealTimers());
describe('upload request memory budget', () => {
  it('rejects declared and streamed oversized bodies before multipart parsing', async () => {
    const declared = new Request('https://vision.example.test/api/uploads', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': '11' }, body: 'short' });
    await expect(readLimitedUploadFormData(declared, 10)).rejects.toMatchObject({ status: 413 });
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); }, cancel() { cancelled = true; } });
    const streamed = new Request('https://vision.example.test/api/uploads', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body, duplex: 'half' } as RequestInit);
    await expect(readLimitedUploadFormData(streamed, 10)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it('accepts bounded real multipart files', async () => {
    const form = new FormData();
    form.append('files', new File(['%PDF-1.7 plan'], 'plan.pdf'));
    const request = new Request('https://vision.example.test/api/uploads', { method: 'POST', body: form });
    const parsed = await readLimitedUploadFormData(request, 1024);
    expect(parsed.getAll('files')).toHaveLength(1);
    expect((parsed.get('files') as File).name).toBe('plan.pdf');
  });

  it('times out a stalled body and cancels the reader', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const request = new Request('https://vision.example.test/api/uploads', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body, duplex: 'half' } as RequestInit);
    const result = readLimitedUploadFormData(request, 10);
    const rejected = expect(result).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(cancelled).toBe(true);
  });

  it('allows only one ingestion until its work settles and releases idempotently', () => {
    const release = reserveUpload();
    expect(() => reserveUpload()).toThrowError(expect.objectContaining({ status: 429 }));
    release();
    const next = reserveUpload();
    release();
    expect(() => reserveUpload()).toThrowError(expect.objectContaining({ status: 429 }));
    next();
  });
});
