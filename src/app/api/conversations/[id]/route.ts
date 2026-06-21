import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { serializeConversation } from '@/lib/server/serializers';

export const runtime = 'nodejs';

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: Request, context: Context) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        assets: { orderBy: { createdAt: 'desc' } },
        _count: { select: { messages: true } },
      },
    });

    if (!conversation) {
      return jsonError('找不到会话。', 404);
    }

    return Response.json({ conversation: serializeConversation(conversation) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_req: Request, context: Context) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    await prisma.conversation.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
