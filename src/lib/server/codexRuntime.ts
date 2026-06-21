import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from './db';
import { getTokenPlanBaseUrlAsync, requireApiKey } from './config';
import { WorkWindowPermission } from '@/types';

const CODEX_RUNTIME_HOME = path.join(process.cwd(), '.codex-runtime');
const CODEX_PROVIDER_ID = 'aliyun_token_plan';
const CODEX_TIMEOUT_MS = 285_000;
const MAX_CAPTURE_BYTES = 160_000;

type CodexRuntimeCallbacks = {
  onStatus?: (event: { status: string; message: string }) => void;
  onContent?: (delta: string) => void;
};

function captureAppend(previous: string, chunk: string) {
  const next = previous + chunk;
  if (Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES) return next;
  return next.slice(Math.max(0, next.length - MAX_CAPTURE_BYTES));
}

function codexSandboxForPermission(permissionMode: string) {
  return permissionMode === 'read_only' || permissionMode === 'propose_patch'
    ? 'read-only'
    : 'workspace-write';
}

function compactHistory(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'tool';
      const content = message.content.length > 4000 ? `${message.content.slice(-4000)}\n[truncated]` : message.content;
      return `### ${role}\n${content}`;
    })
    .join('\n\n');
}

function buildPrompt(params: {
  workTitle: string;
  workGoal?: string | null;
  windowName: string;
  windowId: string;
  permissionMode: WorkWindowPermission;
  history: Array<{ role: string; content: string }>;
  prompt: string;
}) {
  const history = compactHistory(params.history);
  return [
    'You are running inside Token Plan Arena as a Codex CLI runtime window.',
    'This window is an independent local development branch. Work only inside the current working directory.',
    'Do not assume changes in other Arena windows unless the user explicitly provides them.',
    `Work: ${params.workTitle}`,
    params.workGoal ? `Work goal: ${params.workGoal}` : '',
    `Window: ${params.windowName} (${params.windowId})`,
    `Permission mode from Arena: ${params.permissionMode}.`,
    params.permissionMode === 'read_only'
      ? 'Read and explain only. Do not modify files.'
      : params.permissionMode === 'propose_patch'
        ? 'Prefer proposing a patch and explaining affected files. The sandbox is read-only for this run.'
        : 'You may modify files in this window worktree when needed. Keep changes focused and explain verification.',
    history ? `Previous window conversation:\n\n${history}` : '',
    `Current user request:\n\n${params.prompt}`,
  ].filter(Boolean).join('\n\n');
}

async function safeConfigArgs(modelSlug: string) {
  const baseUrl = await getTokenPlanBaseUrlAsync();
  return [
    '-c',
    `model_provider="${CODEX_PROVIDER_ID}"`,
    '-c',
    `model="${modelSlug}"`,
    '-c',
    `model_providers.${CODEX_PROVIDER_ID}.name="Aliyun Token Plan"`,
    '-c',
    `model_providers.${CODEX_PROVIDER_ID}.base_url="${baseUrl}"`,
    '-c',
    `model_providers.${CODEX_PROVIDER_ID}.env_key="ALIYUN_TOKEN_PLAN_API_KEY"`,
    '-c',
    `model_providers.${CODEX_PROVIDER_ID}.wire_api="responses"`,
    '-c',
    `model_providers.${CODEX_PROVIDER_ID}.requires_openai_auth=false`,
  ];
}

function extractTextDelta(event: unknown) {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  const type = String(record.type || record.event || record.kind || '');
  const candidates = [
    record.delta,
    record.text,
    record.content,
    record.message,
    (record.msg as Record<string, unknown> | undefined)?.delta,
    (record.msg as Record<string, unknown> | undefined)?.text,
  ];

  if (!/delta|message|assistant|output/i.test(type)) return '';
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function summarizeEvent(event: unknown) {
  if (!event || typeof event !== 'object') return null;
  const record = event as Record<string, unknown>;
  const type = String(record.type || record.event || record.kind || '').replace(/_/g, ' ');
  if (!type) return null;

  const command =
    typeof record.command === 'string' ? record.command :
    typeof record.cmd === 'string' ? record.cmd :
    typeof (record.msg as Record<string, unknown> | undefined)?.command === 'string'
      ? String((record.msg as Record<string, unknown>).command)
      : '';

  if (command) return `Codex CLI running: ${command}`;
  if (/tool|exec|command|patch|file|turn|task/i.test(type)) return `Codex CLI: ${type}`;
  return null;
}

async function ensureRuntimeHome() {
  await mkdir(CODEX_RUNTIME_HOME, { recursive: true });
  await writeFile(
    path.join(CODEX_RUNTIME_HOME, 'README.md'),
    [
      '# Token Plan Arena Codex Runtime',
      '',
      'This directory is generated by llm-arena.',
      'It isolates Codex CLI runtime state from the user-level ~/.codex directory.',
      'API keys are not written here; they are passed through process environment variables.',
      '',
    ].join('\n'),
    'utf8'
  ).catch(() => undefined);
}

export async function runCodexRuntimeWindow(params: {
  workWindowId: string;
  modelSlug: string;
  permissionMode: WorkWindowPermission;
  workTitle: string;
  workGoal?: string | null;
  windowName: string;
  windowId: string;
  worktreePath: string;
  history: Array<{ role: string; content: string }>;
  prompt: string;
  callbacks?: CodexRuntimeCallbacks;
}) {
  const [apiKey, configArgs] = await Promise.all([
    requireApiKey(),
    safeConfigArgs(params.modelSlug),
  ]);
  await ensureRuntimeHome();

  const startedAt = Date.now();
  const outputFile = path.join(CODEX_RUNTIME_HOME, `last-message-${params.workWindowId}-${startedAt}.md`);
  const prompt = buildPrompt(params);
  const sandbox = codexSandboxForPermission(params.permissionMode);
  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--cd',
    params.worktreePath,
    '--sandbox',
    sandbox,
    '--output-last-message',
    outputFile,
    ...configArgs,
    prompt,
  ];

  const toolRun = await prisma.toolRun.create({
    data: {
      workWindowId: params.workWindowId,
      toolName: 'codex_cli_exec',
      status: 'running',
      input: {
        modelSlug: params.modelSlug,
        sandbox,
        worktreePath: params.worktreePath,
        runtimeHome: CODEX_RUNTIME_HOME,
        provider: CODEX_PROVIDER_ID,
      },
    },
  });

  params.callbacks?.onStatus?.({
    status: 'codex_running',
    message: `Codex CLI is running ${params.modelSlug} in ${path.basename(params.worktreePath)}.`,
  });

  return new Promise<{ content: string; stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd: params.worktreePath,
      env: {
        ...process.env,
        CODEX_HOME: CODEX_RUNTIME_HOME,
        ALIYUN_TOKEN_PLAN_API_KEY: apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let streamedContent = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, CODEX_TIMEOUT_MS);

    function settle(error?: Error, exitCode: number | null = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      void (async () => {
        const finalContent = (await readFile(outputFile, 'utf8').catch(() => '')).trim() || streamedContent.trim();
        if (error || exitCode !== 0) {
          const message = error?.message || `Codex CLI exited with code ${exitCode ?? 'unknown'}.`;
          await prisma.toolRun.update({
            where: { id: toolRun.id },
            data: {
              status: 'failed',
              output: stdout || undefined,
              error: [message, stderr].filter(Boolean).join('\n\n').slice(0, MAX_CAPTURE_BYTES),
              completedAt: new Date(),
              durationMs: Date.now() - startedAt,
            },
          }).catch(() => undefined);
          reject(new Error([message, stderr].filter(Boolean).join('\n\n')));
          return;
        }

        await prisma.toolRun.update({
          where: { id: toolRun.id },
          data: {
            status: 'completed',
            output: JSON.stringify({
              exitCode,
              stdoutTail: stdout.slice(-8000),
              finalContent: finalContent.slice(0, 40_000),
            }, null, 2),
            completedAt: new Date(),
            durationMs: Date.now() - startedAt,
          },
        }).catch(() => undefined);

        resolve({ content: finalContent, stdout, stderr, exitCode });
      })();
    }

    function handleJsonLine(rawLine: string) {
      const line = rawLine.trim();
      if (!line) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      const summary = summarizeEvent(parsed);
      if (summary) {
        params.callbacks?.onStatus?.({ status: 'codex_running', message: summary });
      }

      const delta = extractTextDelta(parsed);
      if (delta) {
        streamedContent += delta;
        params.callbacks?.onContent?.(delta);
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = captureAppend(stdout, text);
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) handleJsonLine(line);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = captureAppend(stderr, text);
      const compact = text.replace(/\s+/g, ' ').trim();
      if (compact) {
        params.callbacks?.onStatus?.({
          status: 'codex_running',
          message: `Codex CLI: ${compact.slice(0, 180)}`,
        });
      }
    });

    child.on('error', (error) => settle(error));
    child.on('close', (code) => {
      if (lineBuffer.trim()) handleJsonLine(lineBuffer);
      settle(undefined, code);
    });
  });
}
