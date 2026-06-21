import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { createChatCompletionStream, buildChatMessages, pumpTokenPlanSse } from '@/lib/server/aliyun';
import { jsonError } from '@/lib/server/http';
import { ensureModel } from '@/lib/server/models';
import { buildAgentProjectContext } from '@/lib/server/projectContext';
import { PromptAttachment, ProjectContextSelection, WorkWindowPermission } from '@/types';
import { WORK_WINDOW_PERMISSION_COPY } from '@/lib/workPermissions';
import { runWindowAgentToolLoop } from '@/lib/server/agentToolLoop';
import { runCodexRuntimeWindow } from '@/lib/server/codexRuntime';
import { buildWindowMemoryContext, maybeRefreshWindowMemory } from '@/lib/server/windowMemory';
import { extractCodePatchProposal } from '@/lib/codePatch';
import { executeWindowTool } from '@/lib/server/windowTools';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_WINDOW_HISTORY = 36;
const MAX_WINDOW_MESSAGE_CONTEXT = 20;
const HTML_PREVIEW_GUIDANCE = [
  '你正在 Token Plan Arena 的 Work Window 中回答。',
  '这个窗口是一条独立时间线。不要引用其他窗口的回答，除非用户显式贴出或说明。',
  '当用户要求生成 HTML、网页、页面、UI、组件 Demo、可预览原型或一次性 HTML 时，请把可运行结果放在单独的 fenced `html` 代码块中。',
  '这个 `html` 代码块应尽量是完整文档，包含 <!DOCTYPE html>、viewport、必要的内联 CSS/JS；不要依赖本地文件、构建工具或未说明的资源。',
].join('\n');

function sse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

async function openUpstreamWithRetry(params: {
  modelSlug: string;
  messages: ReturnType<typeof buildChatMessages>;
  controller: ReadableStreamDefaultController<Uint8Array>;
}) {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    response = await createChatCompletionStream(params.modelSlug, params.messages);
    if (response.status !== 429) return response;

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

function buildPermissionGuidance(permissionMode: string, branchSummary: string) {
  const copy = WORK_WINDOW_PERMISSION_COPY[permissionMode as WorkWindowPermission];
  return [
    `当前窗口权限：${copy?.title || permissionMode}。`,
    copy?.description || '遵守本地工具权限。',
    branchSummary,
    '如果用户要求修改本地代码，优先说明计划和受影响文件。',
    '本地工具由服务端按权限执行。不要声称已经执行命令或写入文件，除非工具结果明确说明已完成。',
  ].join('\n');
}

async function emitTextAsSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  text: string,
  onChunk: (chunk: string) => void
) {
  const chunks = text.match(/[\s\S]{1,520}/g) || [];
  for (const chunk of chunks) {
    onChunk(chunk);
    sse(controller, 'content', { delta: chunk });
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
}

async function finalizeRaceParticipant(params: {
  raceParticipantId?: string;
  content?: string;
  reasoning?: string;
  usage?: unknown;
  status: 'completed' | 'failed';
  error?: string;
  startedAt: number;
}) {
  if (!params.raceParticipantId) return;

  await prisma.raceParticipant.update({
    where: { id: params.raceParticipantId },
    data: {
      status: params.status,
      content: params.status === 'completed' ? params.content || '' : undefined,
      reasoning: params.status === 'completed' && params.reasoning ? params.reasoning : undefined,
      usage: params.status === 'completed' && params.usage ? JSON.parse(JSON.stringify(params.usage)) : undefined,
      error: params.status === 'failed' ? params.error : undefined,
      latencyMs: Date.now() - params.startedAt,
      completedAt: new Date(),
    },
  }).catch(() => undefined);

  const participant = await prisma.raceParticipant.findUnique({
    where: { id: params.raceParticipantId },
    include: { race: { include: { participants: true } } },
  });
  if (participant?.race.participants.every((item) => item.status === 'completed' || item.status === 'failed')) {
    await prisma.race.update({
      where: { id: participant.raceId },
      data: {
        status: participant.race.participants.some((item) => item.status === 'failed') ? 'completed_with_errors' : 'completed',
        completedAt: new Date(),
      },
    }).catch(() => undefined);
  }
}

async function maybeApplyFinalCodePatch(params: {
  workWindowId: string;
  permissionMode: string;
  content: string;
  enabled: boolean;
}) {
  if (!params.enabled || params.permissionMode === 'read_only') return null;
  const proposal = extractCodePatchProposal(params.content);
  if (!proposal) return null;

  try {
    const executed = await executeWindowTool({
      workWindowId: params.workWindowId,
      toolName: 'apply_code_patch',
      input: {
        proposal,
        dryRun: false,
      },
    });
    return {
      name: 'apply_code_patch',
      ok: true,
      source: 'final_code_patch',
      result: executed.result,
    };
  } catch (error) {
    return {
      name: 'apply_code_patch',
      ok: false,
      source: 'final_code_patch',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const prompt = String(body.prompt || '').trim();
    const raceParticipantId = body.raceParticipantId ? String(body.raceParticipantId) : undefined;
    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as PromptAttachment[]).filter((attachment) => attachment.dataUrl)
      : [];

    if (!prompt) {
      return jsonError('缺少 prompt。', 400);
    }

    const window = await prisma.workWindow.findUnique({
      where: { id },
      include: {
        work: true,
        workspaceBranch: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: MAX_WINDOW_HISTORY,
        },
        toolRuns: {
          orderBy: { startedAt: 'desc' },
          take: 8,
        },
      },
    });
    if (!window || window.archived) {
      return jsonError('找不到指定工作窗口。', 404);
    }

    const model = await ensureModel(window.modelSlug);
    if (model.capabilities.includes('image')) {
      return jsonError('图片生成模型不能用于工作窗口对话。', 400);
    }
    if (attachments.length > 0 && !model.capabilities.includes('vision')) {
      return jsonError(`${model.name} 不支持视觉理解，请换一个窗口模型。`, 400);
    }

    const raceParticipant = raceParticipantId
      ? await prisma.raceParticipant.findUnique({ where: { id: raceParticipantId } })
      : null;
    if (raceParticipantId && (!raceParticipant || raceParticipant.workWindowId !== window.id)) {
      return jsonError('竞态参与记录不属于当前窗口。', 400);
    }

    const userMessage = await prisma.windowMessage.create({
      data: {
        workWindowId: window.id,
        raceParticipantId,
        role: 'user',
        content: prompt,
        attachments: attachments.length > 0 ? JSON.parse(JSON.stringify(attachments)) : undefined,
      },
    });

    if (raceParticipantId) {
      await prisma.raceParticipant.update({
        where: { id: raceParticipantId },
        data: {
          status: 'running',
          startedAt: new Date(),
        },
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = Date.now();
        let content = '';
        let reasoning = '';
        let usage: unknown;
        let assistantMessageId: string | undefined;

        const refreshMemoryAfterTurn = async (currentTurn: {
          userPrompt: string;
          assistantContent: string;
          assistantReasoning?: string | null;
          toolResults?: unknown;
          projectContext?: unknown;
        }) => {
          const memory = await maybeRefreshWindowMemory({
            workWindowId: window.id,
            windowName: window.name,
            systemPrompt: window.systemPrompt,
            previousSummary: window.memorySummary,
            memoryUpdatedAt: window.memoryUpdatedAt,
            currentPrompt: prompt,
            currentTurn,
          }).catch(() => null);

          if (memory?.summarized) {
            sse(controller, 'memory', {
              summary: memory.summary,
              memoryUpdatedAt: memory.memoryUpdatedAt?.toISOString?.() || new Date().toISOString(),
            });
          }
        };

        try {
          sse(controller, 'meta', {
            workId: window.workId,
            workWindowId: window.id,
            modelSlug: window.modelSlug,
            raceParticipantId,
            userMessageId: userMessage.id,
          });

          const branch = window.workspaceBranch;
          const branchSummary = branch
            ? `窗口分支状态：${branch.status}${branch.branchName ? `，分支 ${branch.branchName}` : ''}${branch.worktreePath ? `，工作区 ${branch.worktreePath}` : ''}。`
            : '窗口还没有创建独立代码分支。';

          if (window.runtimeKind === 'codex_cli') {
            const worktreePath =
              (branch?.status === 'ready' || branch?.status === 'copy_ready') && branch.worktreePath
                ? branch.worktreePath
                : null;
            if (!worktreePath) {
              throw new Error('Codex CLI 窗口需要先绑定项目并创建独立工作区。');
            }

            sse(controller, 'agent', {
              status: 'codex_running',
              message: `Codex CLI 正在 ${window.name} 的独立工作区运行...`,
            });

            const previousMessages = [...window.messages]
              .reverse()
              .filter((message) => message.id !== userMessage.id)
              .map((message) => ({
                role: message.role,
                content: message.content,
              }));

            const memoryContext = buildWindowMemoryContext({
              window: {
                name: window.name,
                systemPrompt: window.systemPrompt,
                memorySummary: window.memorySummary,
                memoryUpdatedAt: window.memoryUpdatedAt,
              },
              messages: [...window.messages]
                .filter((message) => message.id !== userMessage.id)
                .slice(0, MAX_WINDOW_MESSAGE_CONTEXT),
              recentToolRuns: window.toolRuns || [],
            });

            await runCodexRuntimeWindow({
              workWindowId: window.id,
              modelSlug: window.modelSlug,
              permissionMode: window.permissionMode as WorkWindowPermission,
              workTitle: window.work.title,
              workGoal: window.work.goal,
              windowName: window.name,
              windowId: window.id,
              worktreePath,
              history: previousMessages,
              prompt: memoryContext ? `${memoryContext}\n\n--- USER QUESTION ---\n${prompt}` : prompt,
              callbacks: {
                onStatus: (event) => sse(controller, 'agent', event),
                onContent: (delta) => {
                  content += delta;
                  sse(controller, 'content', { delta });
                },
              },
            }).then((result) => {
              if (!content.trim() && result.content.trim()) {
                content = result.content.trim();
              }
            });

            const assistantMessage = await prisma.windowMessage.create({
              data: {
                workWindowId: window.id,
                raceParticipantId,
                role: 'assistant',
                content,
                metadata: {
                  runtimeKind: 'codex_cli',
                  worktreePath,
                },
              },
            });
            assistantMessageId = assistantMessage.id;

            await prisma.workWindow.update({
              where: { id: window.id },
              data: { updatedAt: new Date() },
            });
            await prisma.work.update({
              where: { id: window.workId },
              data: { updatedAt: new Date() },
            });

            await finalizeRaceParticipant({
              raceParticipantId,
              content,
              status: 'completed',
              startedAt,
            });

            sse(controller, 'done', {
              content,
              reasoning,
              latencyMs: Date.now() - startedAt,
              assistantMessageId,
              runtimeKind: 'codex_cli',
            });

            await refreshMemoryAfterTurn({
              userPrompt: prompt,
              assistantContent: content,
            });
            return;
          }

          let projectContext: Awaited<ReturnType<typeof buildAgentProjectContext>> = {
            context: '',
            summary: null,
          };
          const effectiveProjectPath =
            (window.workspaceBranch?.status === 'ready' || window.workspaceBranch?.status === 'copy_ready') && window.workspaceBranch.worktreePath
              ? window.workspaceBranch.worktreePath
              : window.work.projectPath;
          const projectSelection: ProjectContextSelection | undefined = effectiveProjectPath
            ? {
                projectPath: effectiveProjectPath,
                files: [],
                mode: 'agent',
                writeEnabled: window.permissionMode !== 'read_only',
                permissionMode: window.permissionMode === 'read_only' ? 'request_approval' : 'auto_approve_safe',
              }
            : undefined;

          if (projectSelection) {
            const contextToolStartedAt = Date.now();
            const contextToolRun = await prisma.toolRun.create({
              data: {
                workWindowId: window.id,
                toolName: 'project_context_read',
                status: 'running',
                input: {
                  projectPath: projectSelection.projectPath,
                  prompt,
                },
              },
            });
            sse(controller, 'agent', {
              status: 'reading',
              message: `窗口 ${window.name} 正在读取项目上下文...`,
            });
            try {
              projectContext = await buildAgentProjectContext({
                selection: projectSelection,
                modelSlug: window.modelSlug,
                prompt,
              });
              await prisma.toolRun.update({
                where: { id: contextToolRun.id },
                data: {
                  status: 'completed',
                  output: projectContext.summary
                    ? `Read ${projectContext.summary.fileCount} files (${projectContext.summary.totalBytes} bytes).`
                    : 'No matching files were included.',
                  completedAt: new Date(),
                  durationMs: Date.now() - contextToolStartedAt,
                },
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await prisma.toolRun.update({
                where: { id: contextToolRun.id },
                data: {
                  status: 'failed',
                  error: message,
                  completedAt: new Date(),
                  durationMs: Date.now() - contextToolStartedAt,
                },
              }).catch(() => undefined);
              throw error;
            }
            sse(controller, 'agent', {
              status: projectContext.summary ? 'ready' : 'empty',
              summary: projectContext.summary,
              message: projectContext.summary
                ? `已读取 ${projectContext.summary.fileCount} 个相关文件。`
                : '没有找到可发送的相关文件，将只使用窗口历史。',
            });
          }

          const previousMessages = [...window.messages]
            .reverse()
            .filter((message) => message.id !== userMessage.id)
            .map((message) => ({
              role: message.role === 'tool' ? 'system' : message.role,
              content: message.content,
              attachments: message.attachments,
            }));

          const memoryContext = buildWindowMemoryContext({
            window: {
              name: window.name,
              systemPrompt: window.systemPrompt,
              memorySummary: window.memorySummary,
              memoryUpdatedAt: window.memoryUpdatedAt,
            },
            messages: [...window.messages]
              .filter((message) => message.id !== userMessage.id)
              .slice(0, MAX_WINDOW_MESSAGE_CONTEXT),
            recentToolRuns: window.toolRuns || [],
          });

          const promptForModel = [
            memoryContext,
            projectContext.context,
            '--- USER QUESTION ---',
            prompt,
          ].filter(Boolean).join('\n\n');

          const messageInputs: Array<{ role: string; content: string; attachments?: unknown }> = [
            {
              role: 'system',
              content: [
                HTML_PREVIEW_GUIDANCE,
                `工作：${window.work.title}`,
                window.work.goal ? `工作目标：${window.work.goal}` : '',
                `窗口身份：${window.name} (${window.id})`,
                buildPermissionGuidance(window.permissionMode, branchSummary),
              ].filter(Boolean).join('\n\n'),
            },
            ...previousMessages,
            {
              role: 'user',
              content: promptForModel,
              attachments,
            },
          ];

          let finalMessageInputs = messageInputs;
          let toolResults: unknown[] = [];
          const toolLoop = await runWindowAgentToolLoop({
            workWindowId: window.id,
            modelSlug: window.modelSlug,
            messages: messageInputs,
            enabled: Boolean(projectSelection && window.permissionMode !== 'read_only'),
            onStatus: (event) => {
              sse(controller, 'agent', event);
            },
          });
          finalMessageInputs = toolLoop.messages;
          toolResults = toolLoop.toolResults;

          if (toolLoop.finalText) {
            await emitTextAsSse(controller, toolLoop.finalText, (chunk) => {
              content += chunk;
            });
          } else {
            const upstream = await openUpstreamWithRetry({
              modelSlug: window.modelSlug,
              messages: buildChatMessages(finalMessageInputs),
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
          }

          const finalPatchResult = await maybeApplyFinalCodePatch({
            workWindowId: window.id,
            permissionMode: window.permissionMode,
            content,
            enabled: Boolean(projectSelection),
          });
          if (finalPatchResult) {
            toolResults.push(finalPatchResult);
            sse(controller, 'agent', {
              status: finalPatchResult.ok ? 'tool_result' : 'tool_failed',
              message: finalPatchResult.ok
                ? '已自动应用最终回答中的代码补丁。'
                : `最终回答中的代码补丁应用失败：${finalPatchResult.error}`,
              results: [finalPatchResult],
            });
          }

          const assistantMessage = await prisma.windowMessage.create({
            data: {
              workWindowId: window.id,
              raceParticipantId,
              role: 'assistant',
              content,
              reasoning: reasoning || undefined,
              usage: usage ? JSON.parse(JSON.stringify(usage)) : undefined,
              metadata: {
                ...(projectContext.summary ? { projectContext: JSON.parse(JSON.stringify(projectContext.summary)) } : {}),
                ...(toolResults.length > 0 ? { toolResults: JSON.parse(JSON.stringify(toolResults)) } : {}),
              },
            },
          });
          assistantMessageId = assistantMessage.id;

          await prisma.workWindow.update({
            where: { id: window.id },
            data: { updatedAt: new Date() },
          });
          await prisma.work.update({
            where: { id: window.workId },
            data: { updatedAt: new Date() },
          });

          if (raceParticipantId) {
            await finalizeRaceParticipant({
              raceParticipantId,
              content,
              reasoning,
              usage,
              status: 'completed',
              startedAt,
            });
          }

          sse(controller, 'done', {
            content,
            reasoning,
            usage,
            latencyMs: Date.now() - startedAt,
            projectContext: projectContext.summary,
            assistantMessageId,
          });

          await refreshMemoryAfterTurn({
            userPrompt: prompt,
            assistantContent: content,
            assistantReasoning: reasoning,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
            projectContext: projectContext.summary,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.windowMessage.create({
            data: {
              workWindowId: window.id,
              raceParticipantId,
              role: 'assistant',
              content: '',
              metadata: { error: message },
            },
          }).catch(() => undefined);

          if (raceParticipantId) {
            await finalizeRaceParticipant({
              raceParticipantId,
              status: 'failed',
              error: message,
              startedAt,
            });
          }
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
