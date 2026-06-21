import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { ensureConversation } from '@/lib/server/conversations';
import { syncModelCatalog } from '@/lib/server/models';
import { jsonError } from '@/lib/server/http';
import { serializeConversationSummary } from '@/lib/server/serializers';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    assertDatabaseConfigured();
    await syncModelCatalog();
    const { searchParams } = new URL(req.url);
    const modelSlug = searchParams.get('modelSlug') || undefined;

    const conversations = await prisma.conversation.findMany({
      where: modelSlug ? { modelSlug } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    });

    return Response.json({ conversations: conversations.map(serializeConversationSummary) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    assertDatabaseConfigured();
    const { modelSlug, title } = await req.json();
    if (!modelSlug) {
      return jsonError('缺少 modelSlug。', 400);
    }

    const conversation = await ensureConversation(modelSlug, undefined, title || '');
    if (title) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title },
      });
    }

    return Response.json({ conversation: { ...conversation, createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() } });
  } catch (error) {
    return jsonError(error);
  }
}
