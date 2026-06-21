import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    assertDatabaseConfigured();
    const { prompt } = await req.json();
    if (!prompt?.trim()) {
      return jsonError('缺少 prompt。', 400);
    }

    const run = await prisma.run.create({ data: { prompt: prompt.trim() } });
    return Response.json({
      run: {
        id: run.id,
        prompt: run.prompt,
        createdAt: run.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
