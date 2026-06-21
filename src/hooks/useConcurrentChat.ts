import { useCallback } from 'react';
import { useArenaStore } from '@/stores/useArenaStore';
import { useStreamChat } from './useStreamChat';
import { ProjectContextSelection, PromptAttachment } from '@/types';

async function createRun(prompt: string) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  const data = await response.json();
  return data.run.id as string;
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

export function useConcurrentChat() {
  const {
    selectedModelSlugs,
    models,
    config,
    activeConversationIds,
    toolsEnabled,
    startStreaming,
    stopStreaming,
    setCurrentPrompt,
    updateResponse,
    setConversations,
  } = useArenaStore();
  const { start, abortAll } = useStreamChat();

  const canUseAutoTools = useCallback((projectContext?: ProjectContextSelection | null) => {
    return projectContext?.permissionMode !== 'request_approval';
  }, []);

  const refreshConversations = useCallback(async () => {
    const response = await fetch('/api/conversations');
    if (response.ok) {
      const data = await response.json();
      setConversations(data.conversations || []);
    }
  }, [setConversations]);

  const send = useCallback(async (
    prompt: string,
    attachments: PromptAttachment[] = [],
    projectContext?: ProjectContextSelection | null
  ) => {
    if (!prompt.trim() || selectedModelSlugs.length === 0) return;
    setCurrentPrompt(prompt);
    startStreaming(false);

    try {
      const textModels = selectedModelSlugs
        .map((slug) => models.find((model) => model.slug === slug))
        .filter((model) => model && !model.capabilities.includes('image'));
      const runnableModels = attachments.length > 0
        ? textModels.filter((model) => model!.capabilities.includes('vision'))
        : textModels;
      const skippedModels = textModels.filter((model) => !runnableModels.includes(model));

      if (runnableModels.length === 0) {
        updateResponse('system', {
          modelSlug: 'system',
          content: '',
          error: attachments.length > 0 ? '已上传图片，但当前没有选中支持视觉理解的模型。' : '没有可运行的文本模型。',
          done: true,
          startTime: Date.now(),
          endTime: Date.now(),
          status: 'failed',
        });
        return;
      }

      skippedModels.forEach((model) => {
        if (!model) return;
        updateResponse(model.slug, {
          modelSlug: model.slug,
          content: '',
          error: '该模型不支持当前输入类型，已跳过。',
          done: true,
          startTime: Date.now(),
          endTime: Date.now(),
          status: 'skipped',
        });
      });

      const runId = await createRun(prompt);
      await runWithLimit(runnableModels, config?.maxParallelRequests || 4, async (model) => {
        if (!model) return;
        await start({
          modelSlug: model.slug,
          prompt,
          runId,
          conversationId: activeConversationIds[model.slug],
          toolsEnabled: toolsEnabled && model.tools.length > 0 && canUseAutoTools(projectContext),
          attachments,
          projectContext,
        });
      });
      await refreshConversations();
    } catch (error) {
      updateResponse('system', {
        modelSlug: 'system',
        content: '',
        error: error instanceof Error ? error.message : String(error),
        done: true,
        startTime: Date.now(),
        endTime: Date.now(),
        status: 'failed',
      });
    } finally {
      stopStreaming();
    }
  }, [
    activeConversationIds,
    config?.maxParallelRequests,
    models,
    refreshConversations,
    selectedModelSlugs,
    setCurrentPrompt,
    start,
    startStreaming,
    stopStreaming,
    toolsEnabled,
    updateResponse,
    canUseAutoTools,
  ]);

  const sendToModel = useCallback(async (
    modelSlug: string,
    prompt: string,
    projectContext?: ProjectContextSelection | null
  ) => {
    if (!prompt.trim()) return;
    const model = models.find((item) => item.slug === modelSlug);
    if (!model || model.capabilities.includes('image')) {
      updateResponse(modelSlug, {
        modelSlug,
        content: '',
        error: '该模型不支持文本对话。',
        done: true,
        startTime: Date.now(),
        endTime: Date.now(),
        status: 'failed',
      });
      return;
    }

    setCurrentPrompt(prompt);
    startStreaming(false);
    try {
      const runId = await createRun(prompt);
      await start({
        modelSlug,
        prompt,
        runId,
        conversationId: activeConversationIds[modelSlug],
        toolsEnabled: toolsEnabled && model.tools.length > 0 && canUseAutoTools(projectContext),
        attachments: [],
        projectContext,
      });
      await refreshConversations();
    } catch (error) {
      updateResponse(modelSlug, {
        modelSlug,
        content: '',
        error: error instanceof Error ? error.message : String(error),
        done: true,
        startTime: Date.now(),
        endTime: Date.now(),
        status: 'failed',
      });
    } finally {
      stopStreaming();
    }
  }, [
    activeConversationIds,
    models,
    refreshConversations,
    setCurrentPrompt,
    start,
    startStreaming,
    stopStreaming,
    toolsEnabled,
    updateResponse,
    canUseAutoTools,
  ]);

  return { send, sendToModel, abortAll, refreshConversations };
}
