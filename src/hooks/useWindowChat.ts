import { useCallback, useRef } from 'react';
import { PromptAttachment } from '@/types';
import { useWorkbenchStore } from '@/stores/useWorkbenchStore';

type SendWindowOptions = {
  workWindowId: string;
  prompt: string;
  attachments?: PromptAttachment[];
  raceParticipantId?: string;
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

async function runWithLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const effectiveLimit = Math.max(4, limit || 4);
  const workers = Array.from({ length: Math.min(effectiveLimit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.allSettled(workers);
}

export function useWindowChat() {
  const controllersRef = useRef<Record<string, AbortController>>({});
  const {
    appendDraftUserMessage,
    appendDraftAssistantMessage,
    updateDraftAssistantMessage,
    removeDraftMessage,
    updateWindowMemory,
    startWindowStream,
    updateWindowStream,
    stopWindowStream,
    addRace,
  } = useWorkbenchStore();

  const sendToWindow = useCallback(async ({ workWindowId, prompt, attachments = [], raceParticipantId }: SendWindowOptions) => {
    if (!prompt.trim()) return;

    const controller = new AbortController();
    controllersRef.current[workWindowId] = controller;
    const startTime = Date.now();
    appendDraftUserMessage(workWindowId, prompt, attachments, raceParticipantId);
    const assistantMessageId = appendDraftAssistantMessage(workWindowId, raceParticipantId);
    startWindowStream(workWindowId, {
      raceParticipantId,
      startTime,
      status: 'queued',
    });

    try {
      const response = await fetch(`/api/windows/${workWindowId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          attachments,
          raceParticipantId,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text || 'No response'}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let reasoning = '';

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
              updateWindowStream(workWindowId, {
                raceParticipantId: json.raceParticipantId,
                status: 'running',
              });
            }
            if (event === 'status') {
              updateWindowStream(workWindowId, {
                status: json.status || 'running',
                reasoning: json.message || reasoning,
              });
            }
            if (event === 'agent') {
              updateWindowStream(workWindowId, {
                status: json.status === 'reading' ? 'reading_project' : json.status || 'running',
                projectContext: json.summary,
                agentMessage: json.message || json.status,
              });
            }
            if (event === 'reasoning') {
              reasoning += json.delta || '';
              updateDraftAssistantMessage(workWindowId, assistantMessageId, { reasoning });
              updateWindowStream(workWindowId, { reasoning, status: 'running' });
            }
            if (event === 'content') {
              content += json.delta || '';
              const elapsed = (Date.now() - startTime) / 1000;
              updateDraftAssistantMessage(workWindowId, assistantMessageId, { content, reasoning });
              updateWindowStream(workWindowId, {
                content,
                reasoning,
                status: 'running',
                tokensPerSecond: content.length / 4 / Math.max(elapsed, 0.1),
              });
            }
            if (event === 'done') {
              updateDraftAssistantMessage(workWindowId, assistantMessageId, {
                id: json.assistantMessageId || assistantMessageId,
                content: json.content ?? content,
                reasoning: json.reasoning ?? reasoning,
                usage: json.usage,
                metadata: json.projectContext ? { projectContext: json.projectContext } : undefined,
              });
              updateWindowStream(workWindowId, {
                content: json.content ?? content,
                reasoning: json.reasoning ?? reasoning,
                projectContext: json.projectContext,
                done: true,
                endTime: Date.now(),
                status: 'completed',
              });
            }
            if (event === 'memory') {
              updateWindowMemory(workWindowId, {
                summary: json.summary,
                memoryUpdatedAt: json.memoryUpdatedAt,
              });
            }
            if (event === 'error') {
              if (!content.trim()) removeDraftMessage(workWindowId, assistantMessageId);
              updateWindowStream(workWindowId, {
                error: json.error || '请求失败',
                done: true,
                endTime: Date.now(),
                status: 'failed',
              });
            }
          } catch {}
        }
      }

      const latest = useWorkbenchStore.getState().streams[workWindowId];
      if (!latest?.done) {
        updateDraftAssistantMessage(workWindowId, assistantMessageId, { content, reasoning });
        updateWindowStream(workWindowId, {
          content,
          reasoning,
          done: true,
          endTime: Date.now(),
          status: 'completed',
        });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : String(error);
        removeDraftMessage(workWindowId, assistantMessageId);
        updateWindowStream(workWindowId, {
          error: message,
          done: true,
          endTime: Date.now(),
          status: 'failed',
        });
      }
    } finally {
      stopWindowStream(workWindowId);
    }
  }, [
    appendDraftAssistantMessage,
    appendDraftUserMessage,
    removeDraftMessage,
    startWindowStream,
    stopWindowStream,
    updateDraftAssistantMessage,
    updateWindowMemory,
    updateWindowStream,
  ]);

  const sendRace = useCallback(async (params: {
    workId: string;
    prompt: string;
    windowIds: string[];
    maxParallelRequests: number;
  }) => {
    if (!params.prompt.trim() || params.windowIds.length === 0) return;

    const response = await fetch(`/api/works/${params.workId}/races`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        windowIds: params.windowIds,
        maxParallelRequests: params.maxParallelRequests,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '创建竞态失败');
    }
    addRace(data.race);

    await runWithLimit(data.race.participants, params.maxParallelRequests, async (participant: { workWindowId: string; id: string }) => {
      await sendToWindow({
        workWindowId: participant.workWindowId,
        prompt: params.prompt,
        raceParticipantId: participant.id,
      });
    });
  }, [addRace, sendToWindow]);

  const abortWindow = useCallback((workWindowId: string) => {
    controllersRef.current[workWindowId]?.abort();
    stopWindowStream(workWindowId);
  }, [stopWindowStream]);

  const abortAll = useCallback(() => {
    Object.values(controllersRef.current).forEach((controller) => controller.abort());
    controllersRef.current = {};
  }, []);

  return {
    sendToWindow,
    sendRace,
    abortWindow,
    abortAll,
  };
}
