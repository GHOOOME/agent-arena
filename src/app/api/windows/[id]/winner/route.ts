import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { markWindowWinner } from '@/lib/server/windowMerge';

export const runtime = 'nodejs';

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    return Response.json({ work: await markWindowWinner(id) });
  } catch (error) {
    return jsonError(error);
  }
}
