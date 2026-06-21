import { execFile } from 'child_process';
import { cp, mkdir, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { prisma } from './db';
import { isIgnoredDir, normalizeProjectPath, shouldIgnoreFile, WORKSPACE_ROOT } from './projectContext';

const execFileAsync = promisify(execFile);
const WORKTREE_ROOT = path.join(WORKSPACE_ROOT, '.llm-arena-worktrees');
const COPY_ALLOWED_LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
]);

function shortId(id: string) {
  return id.slice(-8).replace(/[^a-zA-Z0-9_-]/g, '');
}

async function runGit(projectPath: string, args: string[]) {
  return execFileAsync('git', args, {
    cwd: projectPath,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

async function copyProjectFallback(sourcePath: string, targetPath: string) {
  const existing = await stat(targetPath).catch(() => null);
  if (existing?.isDirectory()) return 'reused';

  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: async (absolutePath) => {
      const relativePath = path.relative(sourcePath, absolutePath).replace(/\\/g, '/');
      if (!relativePath) return true;

      const name = path.basename(absolutePath);
      const fileStats = await stat(absolutePath).catch(() => null);
      if (!fileStats) return false;
      if (fileStats.isDirectory()) {
        return !isIgnoredDir(name);
      }
      if (!fileStats.isFile()) return false;
      if (COPY_ALLOWED_LOCKFILES.has(name)) return true;
      return !shouldIgnoreFile(relativePath, fileStats.size);
    },
  });

  return 'created';
}

export async function ensureWorkspaceBranch(params: {
  workId: string;
  workWindowId: string;
  projectPath?: string | null;
}) {
  if (!params.projectPath) {
    await prisma.workWindow.update({
      where: { id: params.workWindowId },
      data: { branchStatus: 'no_project' },
    }).catch(() => undefined);
    return prisma.workspaceBranch.upsert({
      where: { workWindowId: params.workWindowId },
      update: { status: 'no_project' },
      create: {
        workWindowId: params.workWindowId,
        status: 'no_project',
      },
    });
  }

  const absoluteProjectPath = normalizeProjectPath(params.projectPath);
  const branchName = `arena/work-${shortId(params.workId)}/window-${shortId(params.workWindowId)}`;
  const worktreePath = path.join(WORKTREE_ROOT, `work-${shortId(params.workId)}`, `window-${shortId(params.workWindowId)}`);

  const startedAt = Date.now();
  const toolRun = await prisma.toolRun.create({
    data: {
      workWindowId: params.workWindowId,
      toolName: 'git_worktree_prepare',
      status: 'running',
      input: {
        projectPath: params.projectPath,
        branchName,
        worktreePath,
      },
    },
  });

  try {
    await runGit(absoluteProjectPath, ['rev-parse', '--is-inside-work-tree']);
    const baseCommit = (await runGit(absoluteProjectPath, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(path.dirname(worktreePath), { recursive: true });

    const existingWorktrees = (await runGit(absoluteProjectPath, ['worktree', 'list', '--porcelain'])).stdout;
    if (!existingWorktrees.includes(worktreePath)) {
      const branches = (await runGit(absoluteProjectPath, ['branch', '--list', branchName])).stdout.trim();
      if (branches) {
        await runGit(absoluteProjectPath, ['worktree', 'add', worktreePath, branchName]);
      } else {
        await runGit(absoluteProjectPath, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
      }
    }

    const currentCommit = (await runGit(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'completed',
        output: `Created or reused worktree ${worktreePath}`,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });

    await prisma.workWindow.update({
      where: { id: params.workWindowId },
      data: { branchStatus: 'ready' },
    }).catch(() => undefined);

    return prisma.workspaceBranch.upsert({
      where: { workWindowId: params.workWindowId },
      update: {
        projectPath: params.projectPath,
        branchName,
        worktreePath,
        baseCommit,
        currentCommit,
        status: 'ready',
      },
      create: {
        workWindowId: params.workWindowId,
        projectPath: params.projectPath,
        branchName,
        worktreePath,
        baseCommit,
        currentCommit,
        status: 'ready',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const copyStatus = await copyProjectFallback(absoluteProjectPath, worktreePath);
      await prisma.toolRun.update({
        where: { id: toolRun.id },
        data: {
          status: 'completed',
          output: `Git worktree unavailable; ${copyStatus} filtered copy fallback at ${worktreePath}.`,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      }).catch(() => undefined);

      await prisma.workWindow.update({
        where: { id: params.workWindowId },
        data: { branchStatus: 'copy_ready' },
      }).catch(() => undefined);

      return prisma.workspaceBranch.upsert({
        where: { workWindowId: params.workWindowId },
        update: {
          projectPath: params.projectPath,
          branchName: `copy/work-${shortId(params.workId)}/window-${shortId(params.workWindowId)}`,
          worktreePath,
          status: 'copy_ready',
          lastDiffSummary: `Git worktree unavailable. Created filtered copy fallback. Original error: ${message}`,
        },
        create: {
          workWindowId: params.workWindowId,
          projectPath: params.projectPath,
          branchName: `copy/work-${shortId(params.workId)}/window-${shortId(params.workWindowId)}`,
          worktreePath,
          status: 'copy_ready',
          lastDiffSummary: `Git worktree unavailable. Created filtered copy fallback. Original error: ${message}`,
        },
      });
    } catch (copyError) {
      const copyMessage = copyError instanceof Error ? copyError.message : String(copyError);
      const combinedMessage = `${message}\n\nCopy fallback failed: ${copyMessage}`;
      await prisma.toolRun.update({
        where: { id: toolRun.id },
        data: {
          status: 'failed',
          error: combinedMessage,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      }).catch(() => undefined);

      await prisma.workWindow.update({
        where: { id: params.workWindowId },
        data: { branchStatus: 'needs_git' },
      }).catch(() => undefined);

      return prisma.workspaceBranch.upsert({
        where: { workWindowId: params.workWindowId },
        update: {
          projectPath: params.projectPath,
          branchName,
          worktreePath,
          status: 'needs_git',
          lastDiffSummary: combinedMessage,
        },
        create: {
          workWindowId: params.workWindowId,
          projectPath: params.projectPath,
          branchName,
          worktreePath,
          status: 'needs_git',
          lastDiffSummary: combinedMessage,
        },
      });
    }
  }
}
