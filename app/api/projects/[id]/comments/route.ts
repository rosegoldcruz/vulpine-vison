export const runtime = 'nodejs';

import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { createProjectComment, listProjectComments } from '@/lib/autobidder/services/project-comment-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request); requirePermission(principal, 'project:read');
    const { id } = await context.params;
    return ok({ comments: listProjectComments(id, principal) });
  } catch (error) { const typed = asApiServiceError(error); return fail({ code: typed.code, message: typed.message }, typed.status); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request); requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    return ok({ comment: createProjectComment(id, await request.json(), principal) }, 201);
  } catch (error) { const typed = asApiServiceError(error); return fail({ code: typed.code, message: typed.message }, typed.status); }
}
