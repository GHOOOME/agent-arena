import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { getWork, normalizeNullableText, updateWork } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    return Response.json({ work: await getWork(id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const work = await updateWork({
      id,
      title: body.title !== undefined ? normalizeNullableText(body.title) ?? undefined : undefined,
      goal: body.goal !== undefined ? normalizeNullableText(body.goal) ?? null : undefined,
      projectPath: body.projectPath !== undefined ? normalizeNullableText(body.projectPath) ?? null : undefined,
      status: body.status !== undefined ? normalizeNullableText(body.status) ?? undefined : undefined,
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
    const work = await updateWork({ id, status: 'archived' });
    return Response.json({ work });
  } catch (error) {
    return jsonError(error);
  }
}
