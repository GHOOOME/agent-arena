import { execFile, spawn, ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import net from 'net';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import { prisma } from './db';
import { getWork } from './works';
import { applyProjectPatch } from './projectWrite';
import {
  isIgnoredDir,
  normalizeProjectPath,
  scanProject,
  shouldIgnoreFile,
  toRelativeProjectPath,
} from './projectContext';
import { WorkWindowPermission } from '@/types';

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT_CHARS = 18_000;
const MAX_COMMAND_MS = 120_000;
const MAX_INSTALL_MS = 300_000;
const MAX_APPROVED_COMMAND_MS = 180_000;

type PreviewProcess = {
  process: ChildProcess;
  port: number;
  logPath: string;
};

declare global {
  var __arenaPreviewProcesses: Map<string, PreviewProcess> | undefined;
}

const previewProcesses = globalThis.__arenaPreviewProcesses || new Map<string, PreviewProcess>();
globalThis.__arenaPreviewProcesses = previewProcesses;

type ApprovalRequiredResult = {
  approvalRequired: true;
  command: string;
  message: string;
  reason: string;
};

function isApprovalRequiredResult(result: unknown): result is ApprovalRequiredResult {
  return Boolean(
    result &&
    typeof result === 'object' &&
    'approvalRequired' in result &&
    (result as { approvalRequired?: unknown }).approvalRequired === true
  );
}

const permissionRank: Record<WorkWindowPermission, number> = {
  read_only: 0,
  propose_patch: 1,
  apply_files: 2,
  run_safe_commands: 3,
  run_dev_server: 4,
  full_local_agent: 5,
};

function hasPermission(current: string, required: WorkWindowPermission) {
  return (permissionRank[current as WorkWindowPermission] ?? 0) >= permissionRank[required];
}

function trimOutput(text: string) {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n\n[output truncated: ${text.length - MAX_TOOL_OUTPUT_CHARS} chars omitted]`;
}

async function isPortReachable(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 900 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function assertSafeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!normalized || parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`文件路径无效：${relativePath}`);
  }
  if (parts.slice(0, -1).some((part) => isIgnoredDir(part))) {
    throw new Error(`不能访问隐藏目录、依赖目录或构建目录：${relativePath}`);
  }
  return normalized;
}

function resolveProjectFile(absoluteProjectPath: string, relativePath: string) {
  const safePath = assertSafeRelativePath(relativePath);
  const absoluteFile = path.resolve(absoluteProjectPath, safePath);
  if (!absoluteFile.startsWith(`${absoluteProjectPath}${path.sep}`)) {
    throw new Error(`文件路径不在窗口工作区内：${relativePath}`);
  }
  return { absoluteFile, relativePath: safePath };
}

async function getWindowWorkspace(workWindowId: string) {
  const window = await prisma.workWindow.findUnique({
    where: { id: workWindowId },
    include: {
      work: true,
      workspaceBranch: true,
    },
  });
  if (!window || window.archived) throw new Error('找不到指定窗口。');
  const effectiveProjectPath =
    (window.workspaceBranch?.status === 'ready' || window.workspaceBranch?.status === 'copy_ready') && window.workspaceBranch.worktreePath
      ? window.workspaceBranch.worktreePath
      : window.work.projectPath;
  if (!effectiveProjectPath) throw new Error('当前窗口没有绑定项目工作区。');
  const absoluteProjectPath = normalizeProjectPath(effectiveProjectPath);
  return {
    window,
    absoluteProjectPath,
    projectPath: toRelativeProjectPath(absoluteProjectPath),
  };
}

async function recordToolRun(params: {
  workWindowId: string;
  toolName: string;
  input: unknown;
  run: () => Promise<unknown>;
}) {
  const startedAt = Date.now();
  const toolRun = await prisma.toolRun.create({
    data: {
      workWindowId: params.workWindowId,
      toolName: params.toolName,
      status: 'running',
      input: JSON.parse(JSON.stringify(params.input ?? {})),
    },
  });

  try {
    const result = await params.run();
    if (isApprovalRequiredResult(result)) {
      await prisma.toolRun.update({
        where: { id: toolRun.id },
        data: {
          status: 'pending_approval',
          input: {
            ...(params.input && typeof params.input === 'object' && !Array.isArray(params.input) ? params.input : {}),
            command: result.command,
            requiresApproval: true,
            reason: result.reason,
          },
          output: result.message,
        },
      });
      return {
        ...result,
        toolRunId: toolRun.id,
      };
    }
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'completed',
        output: trimOutput(typeof result === 'string' ? result : JSON.stringify(result, null, 2)),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'failed',
        error: trimOutput(message),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined);
    throw error;
  }
}

const listFilesInput = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const readFileInput = z.object({
  path: z.string().min(1),
});

const searchInput = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).optional(),
});

const patchInput = z.object({
  proposal: z.unknown(),
  dryRun: z.boolean().optional(),
});

const commandInput = z.object({
  command: z.string().min(1).max(300),
});

function normalizeCommand(command: string) {
  return command.trim().replace(/\s+/g, ' ');
}

function parseAllowedCommand(command: string): { cmd: string; args: string[] } {
  const normalized = normalizeCommand(command);
  if (/[;&|`$<>]/.test(normalized)) {
    throw new Error('命令包含不允许的 shell 字符。');
  }

  const exact: Record<string, { cmd: string; args: string[] }> = {
    pwd: { cmd: 'pwd', args: [] },
    ls: { cmd: 'ls', args: [] },
    'ls -la': { cmd: 'ls', args: ['-la'] },
    'npm test': { cmd: 'npm', args: ['test'] },
    'npm run test': { cmd: 'npm', args: ['run', 'test'] },
    'npm run lint': { cmd: 'npm', args: ['run', 'lint'] },
    'npm run build': { cmd: 'npm', args: ['run', 'build'] },
    'npx tsc --noEmit': { cmd: 'npx', args: ['tsc', '--noEmit'] },
  };

  if (exact[normalized]) return exact[normalized];
  if (normalized.startsWith('rg ')) {
    const query = normalized.slice(3).trim();
    if (!query || query.length > 160) throw new Error('rg 查询不能为空或过长。');
    return { cmd: 'rg', args: ['--line-number', '--no-heading', '--color', 'never', query] };
  }

  throw new Error(`命令不在安全白名单中：${normalized}`);
}

const BLOCKED_APPROVAL_COMMANDS = new Set([
  'rm',
  'sudo',
  'su',
  'chmod',
  'chown',
  'kill',
  'pkill',
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  'dd',
  'mkfs',
  'diskutil',
  'brew',
  'docker',
]);

function parseApprovalCommand(command: string): { cmd: string; args: string[]; normalized: string } {
  const normalized = normalizeCommand(command);
  if (!normalized) throw new Error('命令不能为空。');
  if (/[;&|`$<>]/.test(normalized)) {
    throw new Error('高风险命令审批也不允许 shell 连接、管道、重定向或变量展开。');
  }
  const parts = normalized.split(' ').filter(Boolean);
  const cmd = parts[0];
  if (!cmd) throw new Error('命令不能为空。');
  if (cmd.startsWith('/') || cmd.includes('/')) {
    throw new Error('审批命令必须使用普通命令名，不能使用绝对路径或相对路径执行。');
  }
  if (BLOCKED_APPROVAL_COMMANDS.has(cmd)) {
    throw new Error(`该命令被安全策略阻止：${cmd}`);
  }
  return { cmd, args: parts.slice(1), normalized };
}

async function runCommand(cwd: string, command: string) {
  const parsed = parseAllowedCommand(command);
  try {
    const result = await execFileAsync(parsed.cmd, parsed.args, {
      cwd,
      timeout: MAX_COMMAND_MS,
      maxBuffer: 1024 * 1024 * 4,
    });
    return trimOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    if (parsed.cmd === 'rg' && err.code === 1) return 'No matches.';
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    throw new Error(trimOutput(output));
  }
}

async function runApprovedCommand(cwd: string, command: string) {
  const parsed = parseApprovalCommand(command);
  try {
    const result = await execFileAsync(parsed.cmd, parsed.args, {
      cwd,
      timeout: MAX_APPROVED_COMMAND_MS,
      maxBuffer: 1024 * 1024 * 4,
      env: {
        ...process.env,
        CI: process.env.CI || '1',
      },
    });
    return trimOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    throw new Error(trimOutput(output));
  }
}

async function createCommandApproval(params: {
  command: string;
}) {
  const parsed = parseApprovalCommand(params.command);
  return {
    approvalRequired: true,
    command: parsed.normalized,
    reason: '命令不在安全白名单中，需要用户确认后才会在该窗口工作区执行。',
    message: '命令已进入待审批队列，批准后才会执行。',
  } satisfies ApprovalRequiredResult;
}

async function findFreePort(startPort: number) {
  for (let port = startPort; port < startPort + 80; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
    if (available) return port;
  }
  throw new Error('找不到可用预览端口。');
}

async function startDevServer(workWindowId: string, cwd: string) {
  const existing = previewProcesses.get(workWindowId);
  if (existing && !existing.process.killed) {
    return {
      port: existing.port,
      url: `http://localhost:${existing.port}`,
      logPath: existing.logPath,
      reused: true,
    };
  }

  const seed = Number.parseInt(workWindowId.replace(/\D/g, '').slice(-2) || '0', 10);
  const port = await findFreePort(3100 + seed);
  const logPath = `/tmp/llm-arena-window-${workWindowId}-${port}.log`;
  await mkdir(path.dirname(logPath), { recursive: true });
  const hasPackageJson = await stat(path.join(cwd, 'package.json')).then((item) => item.isFile()).catch(() => false);
  const hasNodeModules = await stat(path.join(cwd, 'node_modules')).then((item) => item.isDirectory()).catch(() => false);
  if (hasPackageJson && !hasNodeModules) {
    await execFileAsync('npm', ['install'], {
      cwd,
      timeout: MAX_INSTALL_MS,
      maxBuffer: 1024 * 1024 * 4,
    });
  }
  const logStream = createWriteStream(logPath, { flags: 'a' });
  const child = spawn('npm', ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.unref();
  previewProcesses.set(workWindowId, { process: child, port, logPath });
  await prisma.workWindow.update({
    where: { id: workWindowId },
    data: { previewPort: port },
  });

  return {
    port,
    url: `http://localhost:${port}`,
    logPath,
    reused: false,
  };
}

async function checkPreviewServer(workWindowId: string) {
  const window = await prisma.workWindow.findUnique({ where: { id: workWindowId } });
  const tracked = previewProcesses.get(workWindowId);
  const port = tracked?.port || window?.previewPort || null;
  if (!port) {
    return {
      running: false,
      tracked: false,
      message: 'No preview port is stored for this window.',
    };
  }
  const reachable = await isPortReachable(port);
  if (!reachable && window?.previewPort) {
    await prisma.workWindow.update({
      where: { id: workWindowId },
      data: { previewPort: null },
    }).catch(() => undefined);
  }
  return {
    running: reachable,
    tracked: Boolean(tracked),
    port,
    url: `http://localhost:${port}`,
    message: reachable
      ? tracked
        ? 'Preview server is running and tracked by this process.'
        : 'Preview server is reachable, but not tracked by this process after restart.'
      : 'Preview server is not reachable; stored preview port was cleared.',
  };
}

async function recoverPreviewServer(workWindowId: string, cwd: string) {
  const window = await prisma.workWindow.findUnique({ where: { id: workWindowId } });
  const storedPort = window?.previewPort || null;
  if (storedPort) {
    const reachable = await isPortReachable(storedPort);
    if (reachable) {
      return {
        port: storedPort,
        url: `http://localhost:${storedPort}`,
        recovered: true,
        restarted: false,
        message: 'Preview server is already reachable; reused stored port.',
      };
    }
    await prisma.workWindow.update({
      where: { id: workWindowId },
      data: { previewPort: null },
    });
  }

  const started = await startDevServer(workWindowId, cwd);
  return {
    ...started,
    recovered: true,
    restarted: true,
    message: started.reused ? 'Preview server was already tracked.' : 'Preview server restarted for this window.',
  };
}

async function stopDevServer(workWindowId: string) {
  const existing = previewProcesses.get(workWindowId);
  if (existing && existing.process.pid && !existing.process.killed) {
    try {
      process.kill(-existing.process.pid, 'SIGTERM');
    } catch {
      existing.process.kill('SIGTERM');
    }
  }
  previewProcesses.delete(workWindowId);
  await prisma.workWindow.update({
    where: { id: workWindowId },
    data: { previewPort: null },
  });
  return 'Preview server stopped.';
}

async function readDevServerLog(workWindowId: string) {
  const existing = previewProcesses.get(workWindowId);
  if (!existing) return 'No live preview server log is attached to this process.';
  const content = await readFile(existing.logPath, 'utf8').catch(() => '');
  return trimOutput(content || 'Log is empty.');
}

export type WindowToolName =
  | 'list_files'
  | 'read_file'
  | 'search'
  | 'apply_code_patch'
  | 'run_command'
  | 'start_dev_server'
  | 'check_preview_server'
  | 'recover_preview_server'
  | 'stop_dev_server'
  | 'read_dev_server_log';

export async function executeWindowTool(params: {
  workWindowId: string;
  toolName: WindowToolName;
  input?: unknown;
}) {
  const workspace = await getWindowWorkspace(params.workWindowId);
  const permissionMode = workspace.window.permissionMode;

  const result = await recordToolRun({
    workWindowId: params.workWindowId,
    toolName: params.toolName,
    input: params.input,
    run: async () => {
      if (params.toolName === 'list_files') {
        const input = listFilesInput.parse(params.input ?? {});
        const scanned = await scanProject(workspace.absoluteProjectPath);
        return {
          projectPath: scanned.projectPath,
          files: scanned.files.slice(0, input.limit || 80),
          total: scanned.files.length,
        };
      }

      if (params.toolName === 'read_file') {
        const input = readFileInput.parse(params.input);
        const file = resolveProjectFile(workspace.absoluteProjectPath, input.path);
        const fileStats = await stat(file.absoluteFile);
        if (!fileStats.isFile() || shouldIgnoreFile(file.relativePath, fileStats.size)) {
          throw new Error(`出于安全规则不能读取：${file.relativePath}`);
        }
        return {
          path: file.relativePath,
          content: await readFile(file.absoluteFile, 'utf8'),
        };
      }

      if (params.toolName === 'search') {
        const input = searchInput.parse(params.input);
        const result = await runCommand(workspace.absoluteProjectPath, `rg ${input.query}`);
        return result.split('\n').slice(0, input.limit || 60).join('\n');
      }

      if (params.toolName === 'apply_code_patch') {
        const input = patchInput.parse(params.input);
        const dryRun = permissionMode === 'propose_patch' || !hasPermission(permissionMode, 'apply_files') || input.dryRun;
        if (!hasPermission(permissionMode, 'propose_patch')) {
          throw new Error('当前窗口权限不允许生成或应用代码补丁。');
        }
        return applyProjectPatch({
          projectPath: workspace.absoluteProjectPath,
          proposal: input.proposal,
          dryRun,
        });
      }

      if (params.toolName === 'run_command') {
        if (!hasPermission(permissionMode, 'run_safe_commands')) {
          throw new Error('当前窗口权限不允许运行命令。');
        }
        const input = commandInput.parse(params.input);
        try {
          return await runCommand(workspace.absoluteProjectPath, input.command);
        } catch (error) {
          if (permissionMode === 'full_local_agent') {
            return createCommandApproval({
              command: input.command,
            });
          }
          throw error;
        }
      }

      if (params.toolName === 'start_dev_server') {
        if (!hasPermission(permissionMode, 'run_dev_server')) {
          throw new Error('当前窗口权限不允许启动预览服务。');
        }
        return startDevServer(params.workWindowId, workspace.absoluteProjectPath);
      }

      if (params.toolName === 'check_preview_server') {
        if (!hasPermission(permissionMode, 'run_dev_server')) {
          throw new Error('当前窗口权限不允许检查预览服务。');
        }
        return checkPreviewServer(params.workWindowId);
      }

      if (params.toolName === 'recover_preview_server') {
        if (!hasPermission(permissionMode, 'run_dev_server')) {
          throw new Error('当前窗口权限不允许恢复预览服务。');
        }
        return recoverPreviewServer(params.workWindowId, workspace.absoluteProjectPath);
      }

      if (params.toolName === 'stop_dev_server') {
        if (!hasPermission(permissionMode, 'run_dev_server')) {
          throw new Error('当前窗口权限不允许停止预览服务。');
        }
        return stopDevServer(params.workWindowId);
      }

      if (params.toolName === 'read_dev_server_log') {
        if (!hasPermission(permissionMode, 'run_dev_server')) {
          throw new Error('当前窗口权限不允许读取预览日志。');
        }
        return readDevServerLog(params.workWindowId);
      }

      throw new Error(`未知工具：${params.toolName}`);
    },
  });

  return {
    result,
    work: await getWork(workspace.window.workId),
  };
}

export async function getWindowToolContext(workWindowId: string) {
  const workspace = await getWindowWorkspace(workWindowId);
  return {
    window: workspace.window,
    absoluteProjectPath: workspace.absoluteProjectPath,
    projectPath: workspace.projectPath,
  };
}

export async function approveWindowToolRun(params: {
  workWindowId: string;
  toolRunId: string;
  decision: 'approve' | 'reject';
}) {
  const workspace = await getWindowWorkspace(params.workWindowId);
  if (workspace.window.permissionMode !== 'full_local_agent') {
    throw new Error('只有“本地 Agent”权限可以审批高风险命令。');
  }

  const toolRun = await prisma.toolRun.findUnique({
    where: { id: params.toolRunId },
  });
  if (!toolRun || toolRun.workWindowId !== params.workWindowId || toolRun.toolName !== 'run_command') {
    throw new Error('找不到指定待审批命令。');
  }
  if (toolRun.status !== 'pending_approval') {
    throw new Error('该命令不处于待审批状态。');
  }

  const input = commandInput.parse(toolRun.input || {});
  if (params.decision === 'reject') {
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'rejected',
        error: '用户拒绝执行该命令。',
        completedAt: new Date(),
        durationMs: Date.now() - toolRun.startedAt.getTime(),
      },
    });
    return {
      result: 'Command rejected.',
      work: await getWork(workspace.window.workId),
    };
  }

  const startedAt = Date.now();
  await prisma.toolRun.update({
    where: { id: toolRun.id },
    data: { status: 'running' },
  });

  try {
    const output = await runApprovedCommand(workspace.absoluteProjectPath, input.command);
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'completed',
        output,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    return {
      result: output,
      work: await getWork(workspace.window.workId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'failed',
        error: trimOutput(message),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined);
    throw error;
  }
}
