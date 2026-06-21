import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { createChatCompletionStream, createResponsesStream, buildChatMessages, pumpTokenPlanSse } from '@/lib/server/aliyun';
import { saveDataUrlAsset } from '@/lib/server/assets';
import { appendAssistantMessage, appendUserMessage, ensureConversation, getConversationMessages } from '@/lib/server/conversations';
import { jsonError } from '@/lib/server/http';
import { ensureModel } from '@/lib/server/models';
import { buildAgentProjectContext, buildProjectContext } from '@/lib/server/projectContext';
import { ProjectContextSelection, PromptAttachment } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const HTML_PREVIEW_GUIDANCE = [
  '你正在 Token Plan Arena 中回答，用户会在模型卡片里直接预览 HTML 输出。',
  '当用户明确要求生成 HTML、网页、页面、UI、组件 Demo、可预览原型或一次性 HTML 时，请把可运行结果放在单独的 fenced `html` 代码块中。',
  '这个 `html` 代码块应尽量是完整文档，包含 <!DOCTYPE html>、viewport、必要的内联 CSS/JS；不要依赖本地文件、构建工具或未说明的资源。',
  '普通问答、代码修改提案和非 HTML 任务不需要强行输出 HTML。',
].join('\n');

function sse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

async function openUpstreamWithRetry(params: {
  modelSlug: string;
  messages: ReturnType<typeof buildChatMessages>;
  toolsEnabled: boolean;
  controller: ReadableStreamDefaultController<Uint8Array>;
}) {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    response = params.toolsEnabled
      ? await createResponsesStream(params.modelSlug, params.messages)
      : await createChatCompletionStream(params.modelSlug, params.messages);

    if (response.status !== 429) {
      return response;
    }

    if (attempt < MAX_RATE_LIMIT_RETRIES) {
      sse(params.controller, 'status', {
        status: 'rate_limited',
        message: `触发 Token Plan 速率限制，60 秒后重试 (${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})。`,
        retryAfterMs: RATE_LIMIT_WAIT_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    }
  }

  return response;
}

export async function POST(req: Request) {
  try {
    assertDatabaseConfigured();
    const body = await req.json();
    const modelSlug = String(body.modelSlug || '');
    const prompt = String(body.prompt || '').trim();
    const conversationId = body.conversationId ? String(body.conversationId) : undefined;
    const runId = body.runId ? String(body.runId) : undefined;
    const toolsEnabled = Boolean(body.toolsEnabled);
    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as PromptAttachment[]).filter((attachment) => attachment.dataUrl)
      : [];
    const projectContextSelection = body.projectContext as ProjectContextSelection | undefined;

    if (!modelSlug || !prompt) {
      return jsonError('缺少 modelSlug 或 prompt。', 400);
    }

    const model = await ensureModel(modelSlug);
    if (model.capabilities.includes('image')) {
      return jsonError('图片生成模型请使用 /api/images。', 400);
    }
    if (attachments.length > 0 && !model.capabilities.includes('vision')) {
      return jsonError(`${model.name} 不支持视觉理解，请选择带“视觉理解”的模型。`, 400);
    }

    const conversation = await ensureConversation(modelSlug, conversationId, prompt);
    const run = runId
      ? await prisma.run.findUnique({ where: { id: runId } })
      : await prisma.run.create({ data: { prompt } });

    if (!run) {
      return jsonError('找不到指定 Run。', 404);
    }

    const savedAttachments = await Promise.all(
      attachments.map(async (attachment) => {
        const saved = await saveDataUrlAsset(attachment.dataUrl!, attachment.name);
        await prisma.asset.create({
          data: {
            type: 'upload',
            modelSlug,
            conversationId: conversation.id,
            localPath: saved.localPath,
            publicUrl: saved.publicUrl,
            prompt,
            metadata: saved.metadata,
          },
        });
        return {
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          publicUrl: saved.publicUrl,
        };
      })
    );

    const previousMessages = await getConversationMessages(conversation.id);

    await appendUserMessage(conversation.id, prompt, savedAttachments.length > 0 ? (savedAttachments as unknown as PromptAttachment[]) : null);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const runResult = await prisma.runResult.create({
      data: {
        runId: run.id,
        conversationId: conversation.id,
        modelSlug,
        status: 'running',
      },
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = Date.now();
        let content = '';
        let reasoning = '';
        let usage: unknown;

        try {
          sse(controller, 'meta', {
            modelSlug,
            conversationId: conversation.id,
            runId: run.id,
            runResultId: runResult.id,
          });

          let projectContext = await buildProjectContext(projectContextSelection);
          if (projectContextSelection?.mode === 'agent') {
            sse(controller, 'agent', {
              status: 'reading',
              message: '项目 Agent 正在选择并读取相关文件...',
            });
            projectContext = await buildAgentProjectContext({
              selection: projectContextSelection,
              modelSlug,
              prompt,
            });
            if (projectContext.summary) {
              sse(controller, 'agent', {
                status: 'ready',
                summary: projectContext.summary,
                message: `项目 Agent 已读取 ${projectContext.summary.fileCount} 个文件。`,
              });
            } else {
              sse(controller, 'agent', {
                status: 'empty',
                message: '项目 Agent 没有找到可发送的相关文件，将只根据对话历史回答。',
              });
            }
          }

          const promptForModel = projectContext.context
            ? `${projectContext.context}\n\n--- USER QUESTION ---\n${prompt}`
            : prompt;
          const messages = buildChatMessages([
            {
              role: 'system',
              content: HTML_PREVIEW_GUIDANCE,
            },
            ...previousMessages,
            {
              role: 'user',
              content: promptForModel,
              attachments,
            },
          ]);

          const canUseTools = toolsEnabled && model.tools.length > 0;
          const upstream = await openUpstreamWithRetry({
            modelSlug,
            messages,
            toolsEnabled: canUseTools,
            controller,
          });

          if (!upstream || !upstream.ok || !upstream.body) {
            const errorText = await upstream?.text().catch(() => '') || 'Token Plan 没有返回响应。';
            throw new Error(`HTTP ${upstream?.status || 'unknown'}: ${errorText}`);
          }

          await pumpTokenPlanSse(upstream.body, (event) => {
            if (event.content) {
              content += event.content;
              sse(controller, 'content', { delta: event.content });
            }
            if (event.reasoning) {
              reasoning += event.reasoning;
              sse(controller, 'reasoning', { delta: event.reasoning });
            }
            if (event.usage) {
              usage = event.usage;
            }
          });

          await appendAssistantMessage(conversation.id, content, reasoning, usage);
          await prisma.runResult.update({
            where: { id: runResult.id },
            data: {
              status: 'completed',
              content,
              reasoning: reasoning || undefined,
              usage: usage ? JSON.parse(JSON.stringify(usage)) : undefined,
              latencyMs: Date.now() - startedAt,
              completedAt: new Date(),
            },
          });
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() },
          });

          sse(controller, 'done', {
            content,
            reasoning,
            usage,
            latencyMs: Date.now() - startedAt,
            projectContext: projectContext.summary,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.runResult.update({
            where: { id: runResult.id },
            data: {
              status: 'failed',
              error: message,
              latencyMs: Date.now() - startedAt,
              completedAt: new Date(),
            },
          }).catch(() => undefined);
          sse(controller, 'error', { error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
