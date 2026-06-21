import { prisma } from './db';
import { ensureModel } from './models';
import { PromptAttachment } from '@/types';

function makeTitle(prompt: string) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, 48) : '新对话';
}

export async function ensureConversation(modelSlug: string, conversationId?: string, prompt = '') {
  await ensureModel(modelSlug);

  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new Error('找不到指定会话。');
    }
    if (conversation.modelSlug !== modelSlug) {
      throw new Error('该会话不属于当前模型，不能混用模型记忆。');
    }
    return conversation;
  }

  return prisma.conversation.create({
    data: {
      modelSlug,
      title: makeTitle(prompt),
    },
  });
}

export async function appendUserMessage(
  conversationId: string,
  content: string,
  attachments: PromptAttachment[] | null
) {
  return prisma.message.create({
    data: {
      conversationId,
      role: 'user',
      content,
      attachments: attachments ? JSON.parse(JSON.stringify(attachments)) : undefined,
    },
  });
}

export async function appendAssistantMessage(
  conversationId: string,
  content: string,
  reasoning?: string,
  usage?: unknown
) {
  return prisma.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content,
      reasoning: reasoning || undefined,
      usage: usage ? JSON.parse(JSON.stringify(usage)) : undefined,
    },
  });
}

export async function getConversationMessages(conversationId: string, take = 24) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return messages.reverse();
}
