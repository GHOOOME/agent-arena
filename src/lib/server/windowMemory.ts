import { prisma } from './db';
import { createChatCompletion } from './aliyun';

const MAX_HISTORY_MESSAGES_FOR_CONTEXT = 24;
const MAX_MEMORY_SUMMARY_CHARS = 2200;
const MAX_JSON_CONTEXT_CHARS = 3200;

type MemoryMessage = {
  role: string;
  content: string;
  reasoning?: string | null;
  metadata?: unknown;
  createdAt: Date;
};

function compactText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function compactJson(value: unknown, limit = MAX_JSON_CONTEXT_CHARS) {
  if (value === undefined || value === null) return '';
  try {
    return compactText(JSON.stringify(value, null, 2), limit);
  } catch {
    return compactText(String(value), limit);
  }
}

function sortRecentMessages(messages: MemoryMessage[]) {
  return [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function buildWindowMemoryContext(params: {
  window: {
    name: string;
    systemPrompt?: string | null;
    memorySummary?: string | null;
    memoryUpdatedAt?: Date | null;
  };
  messages: MemoryMessage[];
  recentToolRuns: Array<{
    toolName: string;
    status: string;
    output?: string | null;
    error?: string | null;
    startedAt: Date;
  }>;
}) {
  const parts: string[] = [];

  if (params.window.systemPrompt?.trim()) {
    parts.push([
      '--- WINDOW SYSTEM PROMPT ---',
      params.window.systemPrompt.trim(),
    ].join('\n'));
  }

  if (params.window.memorySummary?.trim()) {
    parts.push([
      '--- LONG-TERM WINDOW MEMORY ---',
      params.window.memorySummary.trim(),
      params.window.memoryUpdatedAt ? `Last updated: ${params.window.memoryUpdatedAt.toISOString()}` : '',
    ].filter(Boolean).join('\n'));
  }

  const recentToolSummary = params.recentToolRuns
    .slice(0, 6)
    .map((tool) => {
      const detail = tool.status === 'failed'
        ? tool.error || 'failed'
        : tool.output || 'completed';
      return `- ${tool.toolName}: ${compactText(detail, 240)}`;
    });
  if (recentToolSummary.length > 0) {
    parts.push([
      '--- RECENT TOOL RESULTS ---',
      ...recentToolSummary,
    ].join('\n'));
  }

  const recentMessages = sortRecentMessages(params.messages)
    .slice(0, MAX_HISTORY_MESSAGES_FOR_CONTEXT)
    .reverse()
    .map((message) => {
      const label = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : message.role;
      const extra = message.reasoning?.trim() ? `\n[reasoning]\n${message.reasoning.trim()}` : '';
      return `### ${label}\n${message.content}${extra}`;
    });

  if (recentMessages.length > 0) {
    parts.push([
      '--- RECENT WINDOW HISTORY ---',
      ...recentMessages,
    ].join('\n\n'));
  }

  return parts.join('\n\n').trim();
}

export async function summarizeWindowMemory(params: {
  workWindowId: string;
  windowName: string;
  systemPrompt?: string | null;
  previousSummary?: string | null;
  currentTurn?: {
    userPrompt: string;
    assistantContent: string;
    assistantReasoning?: string | null;
    toolResults?: unknown;
    projectContext?: unknown;
  };
  messages: Array<{
    role: string;
    content: string;
    reasoning?: string | null;
    metadata?: unknown;
    createdAt: Date;
  }>;
  recentToolRuns: Array<{
    toolName: string;
    status: string;
    output?: string | null;
    error?: string | null;
    startedAt: Date;
  }>;
  currentPrompt: string;
}) {
  const recentConversation = sortRecentMessages(params.messages)
    .slice(0, 36)
    .reverse()
    .map((message) => {
      const base = `${message.role}: ${message.content}`;
      return message.reasoning?.trim() ? `${base}\nreasoning: ${compactText(message.reasoning, 500)}` : base;
    })
    .join('\n\n');

  const recentTools = params.recentToolRuns
    .slice(0, 8)
    .map((tool) => {
      const detail = tool.status === 'failed' ? tool.error || 'failed' : tool.output || 'completed';
      return `${tool.toolName}: ${compactText(detail, 500)}`;
    })
    .join('\n');

  const currentTurn = params.currentTurn
    ? [
        `user:\n${params.currentTurn.userPrompt}`,
        `assistant:\n${params.currentTurn.assistantContent || '[empty assistant content]'}`,
        params.currentTurn.assistantReasoning?.trim()
          ? `assistant reasoning:\n${compactText(params.currentTurn.assistantReasoning, 900)}`
          : '',
        params.currentTurn.toolResults
          ? `tool results:\n${compactJson(params.currentTurn.toolResults)}`
          : '',
        params.currentTurn.projectContext
          ? `project context summary:\n${compactJson(params.currentTurn.projectContext, 1800)}`
          : '',
      ].filter(Boolean).join('\n\n')
    : '';

  const summaryPrompt = [
    '你是本地窗口记忆压缩器。',
    '请把窗口的长期记忆整理成简洁、可持续使用的摘要。',
    '摘要必须保留：窗口当前任务、关键技术决策、用户偏好、已完成的重要操作、下一步待办、最近工具结果对后续工作的影响。',
    '如果本轮涉及代码修改、命令运行、预览、错误或用户明确偏好，必须写入摘要。',
    '不要写流水账，不要重复原文，不要超过 900 个中文字符或等量英文字符。',
    '如果已有旧摘要，请在保留有用信息的前提下更新，不要把旧摘要完全丢掉。',
    '',
    `窗口：${params.windowName}`,
    params.systemPrompt?.trim() ? `窗口 system prompt:\n${params.systemPrompt.trim()}` : '',
    params.previousSummary?.trim() ? `旧摘要:\n${params.previousSummary.trim()}` : '',
    `当前用户问题:\n${params.currentPrompt}`,
    currentTurn ? `当前完整轮次:\n${currentTurn}` : '',
    recentConversation ? `最近消息:\n${recentConversation}` : '',
    recentTools ? `最近工具:\n${recentTools}` : '',
  ].filter(Boolean).join('\n\n');

  return summaryPrompt;
}

export async function maybeRefreshWindowMemory(params: {
  workWindowId: string;
  windowName: string;
  systemPrompt?: string | null;
  previousSummary?: string | null;
  memoryUpdatedAt?: Date | null;
  currentPrompt: string;
  currentTurn?: {
    userPrompt: string;
    assistantContent: string;
    assistantReasoning?: string | null;
    toolResults?: unknown;
    projectContext?: unknown;
  };
}) {
  const recentMessages = await prisma.windowMessage.findMany({
    where: { workWindowId: params.workWindowId },
    orderBy: { createdAt: 'desc' },
    take: 48,
  });

  const recentToolRuns = await prisma.toolRun.findMany({
    where: { workWindowId: params.workWindowId },
    orderBy: { startedAt: 'desc' },
    take: 10,
  });

  const contextBudget = [...recentMessages].reduce((total, message) => total + message.content.length + (message.reasoning?.length || 0), 0);
  const currentTurnBudget = (params.currentTurn?.assistantContent.length || 0)
    + (params.currentTurn?.assistantReasoning?.length || 0)
    + compactJson(params.currentTurn?.toolResults).length
    + compactJson(params.currentTurn?.projectContext).length;
  const hasCurrentTurnSignal = Boolean(
    params.currentTurn?.toolResults
    || params.currentTurn?.projectContext
    || currentTurnBudget > 1800
  );
  const recentSinceSummary = params.memoryUpdatedAt
    ? recentMessages.filter((message) => message.createdAt > params.memoryUpdatedAt!).length
    : recentMessages.length;
  const shouldSummarize = hasCurrentTurnSignal || (!params.previousSummary
    ? contextBudget > 8000 || recentMessages.length >= 12
    : recentSinceSummary >= 8 || contextBudget > 14000);
  if (!shouldSummarize) {
    return {
      summarized: false,
      summary: params.previousSummary || null,
      memoryUpdatedAt: params.memoryUpdatedAt || null,
    };
  }

  const summaryPrompt = await summarizeWindowMemory({
    workWindowId: params.workWindowId,
    windowName: params.windowName,
    systemPrompt: params.systemPrompt,
    previousSummary: params.previousSummary,
    currentTurn: params.currentTurn || {
      userPrompt: params.currentPrompt,
      assistantContent: '',
    },
    messages: recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      metadata: message.metadata,
      createdAt: message.createdAt,
    })),
    recentToolRuns: recentToolRuns.map((tool) => ({
      toolName: tool.toolName,
      status: tool.status,
      output: tool.output,
      error: tool.error,
      startedAt: tool.startedAt,
    })),
    currentPrompt: params.currentPrompt,
  });

  const response = await createChatCompletion({
    model: 'qwen3.7-max',
    messages: [
      { role: 'system', content: summaryPrompt },
      {
        role: 'user',
        content: '请输出窗口长期记忆摘要。',
      },
    ],
    temperature: 0,
    maxTokens: 1200,
  }).catch(() => null);

  if (!response || !response.ok) {
    return {
      summarized: false,
      summary: params.previousSummary || null,
      memoryUpdatedAt: params.memoryUpdatedAt || null,
    };
  }

  const json = await response.json().catch(() => null);
  const content = String(json?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    return {
      summarized: false,
      summary: params.previousSummary || null,
      memoryUpdatedAt: params.memoryUpdatedAt || null,
    };
  }

  const memoryUpdatedAt = new Date();
  const summaryResponse = await prisma.workWindow.update({
    where: { id: params.workWindowId },
    data: {
      memorySummary: compactText(content, MAX_MEMORY_SUMMARY_CHARS),
      memoryUpdatedAt,
    },
  });

  return {
    summarized: Boolean(summaryResponse),
    summary: summaryResponse?.memorySummary || params.previousSummary || null,
    memoryUpdatedAt,
  };
}
