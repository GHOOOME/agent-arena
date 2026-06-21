import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { updateWorkWindow } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const work = await updateWorkWindow({
      id,
      name: body.name !== undefined ? String(body.name) : undefined,
      modelSlug: body.modelSlug ? String(body.modelSlug) : undefined,
      runtimeKind: body.runtimeKind,
      systemPrompt: body.systemPrompt !== undefined ? String(body.systemPrompt) : undefined,
      clearMemory: body.clearMemory !== undefined ? Boolean(body.clearMemory) : undefined,
      permissionMode: body.permissionMode,
      archived: body.archived !== undefined ? Boolean(body.archived) : undefined,
    });
    return Response.json({ work });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const work = await updateWorkWindow({ id, archived: true });
    return Response.json({ work });
  } catch (error) {
    return jsonError(error);
  }
}
