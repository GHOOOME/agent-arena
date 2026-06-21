import { useCallback, useRef } from 'react';
import { useArenaStore } from '@/stores/useArenaStore';
import { MessageRecord, ProjectContextSelection, PromptAttachment } from '@/types';

type StartChatOptions = {
  modelSlug: string;
  prompt: string;
  runId: string;
  conversationId?: string;
  toolsEnabled: boolean;
  attachments: PromptAttachment[];
  projectContext?: ProjectContextSelection | null;
};

function parseSseBlock(block: string) {
  let event = 'message';
  let data = '';

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    }
    if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }

  return { event, data };
}

function createLocalMessage(params: {
  id: string;
  conversationId?: string;
  role: MessageRecord['role'];
  content: string;
  reasoning?: string;
  attachments?: PromptAttachment[];
  createdAt: number;
}): MessageRecord {
  return {
    id: params.id,
    conversationId: params.conversationId || 'pending',
    role: params.role,
    content: params.content,
    reasoning: params.reasoning,
    attachments: params.attachments && params.attachments.length > 0 ? params.attachments : null,
    createdAt: new Date(params.createdAt).toISOString(),
  };
}

function normalizeConversationId(messages: MessageRecord[], conversationId: string) {
  return messages.map((message) => ({ ...message, conversationId }));
}

export function useStreamChat() {
  const updateResponse = useArenaStore((s) => s.updateResponse);
  const setActiveConversation = useArenaStore((s) => s.setActiveConversation);
  const abortRef = useRef<Record<string, AbortController>>({});

  const start = useCallback(async (options: StartChatOptions) => {
    const { modelSlug, prompt, runId, toolsEnabled, attachments, projectContext } = options;
    const controller = new AbortController();
    abortRef.current[modelSlug] = controller;
    const startTime = Date.now();
    const previous = useArenaStore.getState().responses[modelSlug];
    const baseConversationId = options.conversationId || previous?.conversationId;
    const baseMessages = previous?.messages
      ? previous.messages
      : previous?.content
        ? [
            createLocalMessage({
              id: `local-legacy-assistant-${modelSlug}-${startTime}`,
              conversationId: baseConversationId,
              role: 'assistant',
              content: previous.content,
              reasoning: previous.reasoning,
              createdAt: previous.startTime,
            }),
          ]
        : [];
    const userMessageId = `local-user-${runId}-${modelSlug}-${startTime}`;
    const assistantMessageId = `local-assistant-${runId}-${modelSlug}-${startTime}`;
    const draftMessages = [
      ...baseMessages,
      createLocalMessage({
        id: userMessageId,
        conversationId: baseConversationId,
        role: 'user',
        content: prompt,
        attachments,
        createdAt: startTime,
      }),
      createLocalMessage({
        id: assistantMessageId,
        conversationId: baseConversationId,
        role: 'assistant',
        content: '',
        createdAt: startTime + 1,
      }),
    ];

    updateResponse(modelSlug, {
      modelSlug,
      conversationId: baseConversationId,
      content: '',
      reasoning: '',
      messages: draftMessages,
      done: false,
      startTime,
      status: 'queued',
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSlug,
          prompt,
          runId,
          conversationId: baseConversationId,
          toolsEnabled,
          attachments,
          projectContext,
        }),
        signal: controller.signal,
      });

      if (!res || !res.ok || !res.body) {
        const errorText = await res?.text().catch(() => '') || 'No response';
        updateResponse(modelSlug, { error: `HTTP ${res?.status}: ${errorText}`, done: true, endTime: Date.now(), status: 'failed' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = '';
      let reasoning = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const { event, data } = parseSseBlock(block);
          if (!data) continue;

          try {
            const json = JSON.parse(data);
            if (event === 'meta') {
              if (json.conversationId) {
                setActiveConversation(modelSlug, json.conversationId);
              }
              const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
              updateResponse(modelSlug, {
                conversationId: json.conversationId,
                runResultId: json.runResultId,
                messages: json.conversationId ? normalizeConversationId(currentMessages, json.conversationId) : currentMessages,
                status: 'running',
              });
            }
            if (event === 'status') {
              updateResponse(modelSlug, {
                status: json.status || 'running',
                reasoning: json.message || reasoning,
                done: false,
              });
            }
            if (event === 'agent') {
              updateResponse(modelSlug, {
                agentStatus: json.message || json.status,
                projectContext: json.summary,
                done: false,
                status: json.status === 'reading' ? 'reading_project' : 'running',
              });
            }
            if (event === 'reasoning') {
              reasoning += json.delta || '';
              const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
              const nextMessages = currentMessages.map((message) =>
                message.id === assistantMessageId ? { ...message, reasoning } : message
              );
              updateResponse(modelSlug, { reasoning, messages: nextMessages, done: false, status: 'running' });
            }
            if (event === 'content') {
              content += json.delta || '';
              const elapsed = (Date.now() - startTime) / 1000;
              const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
              const nextMessages = currentMessages.map((message) =>
                message.id === assistantMessageId ? { ...message, content, reasoning } : message
              );
              updateResponse(modelSlug, {
                content,
                reasoning,
                messages: nextMessages,
                done: false,
                tokensPerSecond: content.length / 4 / elapsed,
                status: 'running',
              });
            }
            if (event === 'done') {
              const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
              const nextMessages = currentMessages.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: json.content ?? content, reasoning: json.reasoning ?? reasoning }
                  : message
              );
              updateResponse(modelSlug, {
                content: json.content ?? content,
                reasoning: json.reasoning ?? reasoning,
                usage: json.usage,
                messages: nextMessages,
                projectContext: json.projectContext,
                done: true,
                endTime: Date.now(),
                status: 'completed',
              });
            }
            if (event === 'error') {
              const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
              const nextMessages = currentMessages.filter((message) => message.id !== assistantMessageId || message.content.trim());
              updateResponse(modelSlug, {
                error: json.error || '请求失败',
                messages: nextMessages,
                done: true,
                endTime: Date.now(),
                status: 'failed',
              });
            }
          } catch {}
        }
      }

      const latest = useArenaStore.getState().responses[modelSlug];
      if (!latest?.done) {
        const currentMessages = latest?.messages || draftMessages;
        const nextMessages = currentMessages.map((message) =>
          message.id === assistantMessageId ? { ...message, content, reasoning } : message
        );
        updateResponse(modelSlug, { content, reasoning, messages: nextMessages, done: true, endTime: Date.now(), status: 'completed' });
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const message = err instanceof Error ? err.message : String(err);
        const currentMessages = useArenaStore.getState().responses[modelSlug]?.messages || draftMessages;
        const nextMessages = currentMessages.filter((item) => item.id !== assistantMessageId || item.content.trim());
        updateResponse(modelSlug, { error: message, messages: nextMessages, done: true, endTime: Date.now(), status: 'failed' });
      }
    }
  }, [setActiveConversation, updateResponse]);

  const abort = useCallback((modelSlug: string) => {
    abortRef.current[modelSlug]?.abort();
  }, []);

  const abortAll = useCallback(() => {
    Object.values(abortRef.current).forEach((c) => c.abort());
    abortRef.current = {};
  }, []);

  return { start, abort, abortAll };
}
