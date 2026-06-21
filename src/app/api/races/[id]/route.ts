import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { getRace } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    return Response.json({ race: await getRace(id) });
  } catch (error) {
    return jsonError(error);
  }
}
