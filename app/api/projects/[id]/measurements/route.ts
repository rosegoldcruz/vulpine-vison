export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import {
  createMeasurement,
  listMeasurements,
  type MeasurementKind,
} from '@/lib/autobidder/services/viewer-evidence-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const planSheetId = new URL(request.url).searchParams.get('planSheetId') || undefined;
    return ok({ measurements: listMeasurements(principal, id, planSheetId) });
  } catch (error: any) {
    return fail({ code: error.code || 'MEASUREMENTS_READ_FAILED', message: error.message || 'Failed to read measurements.', details: error.details }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    const body = (await request.json()) as {
      planSheetId?: string;
      kind?: MeasurementKind;
      geometry?: unknown;
      calibration?: unknown;
      printedDimensionOverride?: boolean;
    };
    if (!body.planSheetId || !body.kind) return fail({ code: 'VALIDATION_ERROR', message: 'planSheetId and kind are required.' }, 400);
    return ok(
      {
        measurement: createMeasurement(principal, {
          projectId: id,
          planSheetId: body.planSheetId,
          kind: body.kind,
          geometry: body.geometry,
          calibration: body.calibration,
          printedDimensionOverride: body.printedDimensionOverride,
        }),
      },
      201,
    );
  } catch (error: any) {
    return fail({ code: error.code || 'MEASUREMENT_CREATE_FAILED', message: error.message || 'Failed to save measurement.', details: error.details }, error.status || 500);
  }
}
