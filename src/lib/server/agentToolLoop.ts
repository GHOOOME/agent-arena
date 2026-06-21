import { z } from 'zod';
import { buildChatMessages, createChatCompletion } from './aliyun';
import { executeWindowTool, WindowToolName } from './windowTools';

type MessageInput = {
  role: string;
  content: string;
  attachments?: unknown;
};

const MAX_TOOL_STEPS = 3;
const MAX_TOOL_CALLS_PER_STEP = 4;

const toolCallSchema = z.object({
  name: z.enum([
    'list_files',
    'read_file',
    'search',
    'apply_code_patch',
    'run_command',
    'start_dev_server',
    'stop_dev_server',
    'read_dev_server_log',
  ]),
  input: z.unknown().optional(),
});

const toolCallArraySchema = z.array(toolCallSchema).min(1).max(MAX_TOOL_CALLS_PER_STEP);

export const AGENT_TOOL_PROTOCOL = [
  '--- LOCAL AGENT TOOL PROTOCOL ---',
  '你可以请求本地窗口工具，但只能使用下列协议。',
  '需要工具时，只输出一个 fenced 代码块，不要附加解释：',
  '```TOOL_CALLS',
  '[{"name":"list_files","input":{"limit":80}}]',
  '```',
  '可用工具：',
  '- list_files: input {"limit": number}，列出当前窗口工作区可读文件。',
  '- read_file: input {"path": "relative/path"}，读取一个安全文件。',
  '- search: input {"query": "text", "limit": number}，在当前窗口工作区搜索。',
  '- apply_code_patch: input {"proposal": CODE_PATCH_JSON, "dryRun": boolean}，按窗口权限预检或应用补丁。',
  '- run_command: input {"command": "npm run lint"}，只支持安全白名单命令。',
  '- start_dev_server: input {}，按窗口权限启动独立预览服务。',
  '- stop_dev_server: input {}，停止该窗口预览服务。',
  '- read_dev_server_log: input {}，读取该窗口预览日志。',
  '如果不需要工具，直接给用户最终回答，不要输出 TOOL_CALLS。',
].join('\n');

function parseToolCalls(text: string) {
  const fenced = text.match(/```TOOL_CALLS\s*([\s\S]*?)```/i)?.[1];
  if (!fenced) return null;
  const parsed = JSON.parse(fenced);
  return toolCallArraySchema.parse(parsed);
}

function extractAssistantText(json: unknown) {
  const data = json as {
    choices?: Array<{ message?: { content?: unknown } }>;
    output_text?: unknown;
  };
  const content = data.choices?.[0]?.message?.content ?? data.output_text ?? '';
  return typeof content === 'string' ? content.trim() : '';
}

export async function runWindowAgentToolLoop(params: {
  workWindowId: string;
  modelSlug: string;
  messages: MessageInput[];
  enabled: boolean;
  onStatus?: (event: { status: string; message: string; results?: unknown }) => void;
}) {
  if (!params.enabled) {
    return {
      messages: params.messages,
      finalText: null as string | null,
      toolResults: [] as unknown[],
    };
  }

  const messages: MessageInput[] = [
    ...params.messages,
    {
      role: 'system',
      content: AGENT_TOOL_PROTOCOL,
    },
  ];
  const toolResults: unknown[] = [];

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    params.onStatus?.({
      status: 'tool_planning',
      message: `Agent 正在判断是否需要本地工具 (${step + 1}/${MAX_TOOL_STEPS})...`,
    });

    const response = await createChatCompletion({
      model: params.modelSlug,
      messages: buildChatMessages(messages),
      temperature: 0,
      maxTokens: 2200,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Agent 工具规划失败：HTTP ${response.status}: ${errorText}`);
    }

    const text = extractAssistantText(await response.json());
    let calls: Array<{ name: WindowToolName; input?: unknown }> | null = null;
    try {
      calls = parseToolCalls(text);
    } catch (error) {
      return {
        messages,
        finalText: [
          text,
          '',
          `工具请求格式无效：${error instanceof Error ? error.message : String(error)}`,
        ].filter(Boolean).join('\n'),
        toolResults,
      };
    }

    if (!calls) {
      return {
        messages,
        finalText: text || null,
        toolResults,
      };
    }

    messages.push({ role: 'assistant', content: text });

    const stepResults = [];
    for (const call of calls) {
      params.onStatus?.({
        status: 'tool_running',
        message: `正在执行工具：${call.name}`,
      });
      try {
        const executed = await executeWindowTool({
          workWindowId: params.workWindowId,
          toolName: call.name,
          input: call.input,
        });
        stepResults.push({
          name: call.name,
          ok: true,
          result: executed.result,
        });
      } catch (error) {
        stepResults.push({
          name: call.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    toolResults.push(...stepResults);
    params.onStatus?.({
      status: 'tool_result',
      message: `本轮工具完成：${stepResults.map((item) => item.name).join(', ')}`,
      results: stepResults,
    });
    messages.push({
      role: 'system',
      content: [
        `--- TOOL RESULTS STEP ${step + 1} ---`,
        JSON.stringify(stepResults, null, 2),
        '',
        '请基于工具结果继续。如果仍需要工具，继续输出 TOOL_CALLS；如果已足够，请直接给最终回答。',
      ].join('\n'),
    });
  }

  messages.push({
    role: 'system',
    content: '工具循环已达到步数上限。请基于已有工具结果给用户最终回答，不要再输出 TOOL_CALLS。',
  });

  return {
    messages,
    finalText: null as string | null,
    toolResults,
  };
}
