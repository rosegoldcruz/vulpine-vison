export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { assertRunAccess } from '@/lib/autobidder/auth/resource-access';
import { getJobRun, listProgressEvents } from '@/lib/autobidder/services/job-control-service';

const TERMINAL = new Set(['completed', 'failed', 'canceled']);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastSequence = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = () => {
          try {
            const run = getJobRun(id);
            if (!run) {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: 'RUN_NOT_FOUND' })}\n\n`));
              controller.close();
              if (timer) clearInterval(timer);
              return;
            }
            const events = listProgressEvents(id).filter((event) => event.sequence > lastSequence);
            if (events.length) lastSequence = events.at(-1)!.sequence;
            controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({ run, events })}\n\n`));
            if (TERMINAL.has(run.status)) {
              controller.close();
              if (timer) clearInterval(timer);
            }
          } catch {
            controller.close();
            if (timer) clearInterval(timer);
          }
        };
        emit();
        timer = setInterval(emit, 500);
        request.signal.addEventListener('abort', () => { if (timer) clearInterval(timer); try { controller.close(); } catch {} }, { once: true });
      },
      cancel() { if (timer) clearInterval(timer); },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: { code: error.code || 'RUN_STREAM_FAILED', message: error.message || 'Failed to stream run.' } }, { status: error.status || 500 });
  }
}
