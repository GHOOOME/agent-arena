import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { createWorkWindow } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const work = await createWorkWindow({
      workId: id,
      name: body.name ? String(body.name) : undefined,
      modelSlug: body.modelSlug ? String(body.modelSlug) : undefined,
      runtimeKind: body.runtimeKind,
      permissionMode: body.permissionMode,
    });
    return Response.json({ work });
  } catch (error) {
    return jsonError(error);
  }
}
