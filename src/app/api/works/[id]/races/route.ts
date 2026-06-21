import { assertDatabaseConfigured, getServerConfigAsync } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { createRace } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const windowIds = Array.isArray(body.windowIds)
      ? body.windowIds.map((item: unknown) => String(item)).filter(Boolean)
      : [];
    const config = await getServerConfigAsync();
    const race = await createRace({
      workId: id,
      prompt: String(body.prompt || ''),
      windowIds,
      maxParallelRequests: Number(body.maxParallelRequests || config.maxParallelRequests || 4),
    });
    return Response.json({ race });
  } catch (error) {
    return jsonError(error);
  }
}
