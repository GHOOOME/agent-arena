import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { applyWindowMerge, getWindowMergePreview } from '@/lib/server/windowMerge';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    return Response.json(await getWindowMergePreview(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const paths = Array.isArray(body.paths) ? body.paths.map((item: unknown) => String(item)).filter(Boolean) : undefined;
    return Response.json(await applyWindowMerge({ workWindowId: id, paths }));
  } catch (error) {
    return jsonError(error);
  }
}
