import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { prisma } from './db';
import { getWork } from './works';
import { normalizeProjectPath, scanProject, shouldIgnoreFile, toRelativeProjectPath } from './projectContext';

const execFileAsync = promisify(execFile);

export type MergeFileChange = {
  path: string;
  status: 'create' | 'update' | 'delete';
  bytes: number;
  additions: number;
  deletions: number;
  preview: string;
  diffRows: Array<{
    type: 'same' | 'add' | 'delete' | 'change';
    oldLine?: string;
    newLine?: string;
  }>;
  selectable: boolean;
  recommended: boolean;
  conflict: boolean;
  reason?: string;
};

const MAX_DIFF_PREVIEW_LINES = 80;
const MAX_LCS_CELLS = 160_000;

function splitLines(text: string | null) {
  return text ? text.replace(/\r\n/g, '\n').split('\n') : [];
}

function buildLineDiff(before: string | null, after: string | null) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const rows = oldLines.length;
  const cols = newLines.length;

  if (rows * cols > MAX_LCS_CELLS) {
    const previewLines = [
      ...oldLines.slice(0, Math.floor(MAX_DIFF_PREVIEW_LINES / 2)).map((line) => `- ${line}`),
      ...newLines.slice(0, Math.floor(MAX_DIFF_PREVIEW_LINES / 2)).map((line) => `+ ${line}`),
      '... large diff preview truncated ...',
    ];
    const diffRows = [
      ...oldLines.slice(0, Math.floor(MAX_DIFF_PREVIEW_LINES / 2)).map((line) => ({ type: 'delete' as const, oldLine: line })),
      ...newLines.slice(0, Math.floor(MAX_DIFF_PREVIEW_LINES / 2)).map((line) => ({ type: 'add' as const, newLine: line })),
    ];
    return {
      additions: newLines.length,
      deletions: oldLines.length,
      preview: previewLines.join('\n'),
      diffRows,
    };
  }

  const table = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let oldIndex = rows - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = cols - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const previewLines: string[] = [];
  const diffRows: Array<{ type: 'same' | 'add' | 'delete' | 'change'; oldLine?: string; newLine?: string }> = [];
  let additions = 0;
  let deletions = 0;
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < rows || newIndex < cols) {
    if (oldIndex < rows && newIndex < cols && oldLines[oldIndex] === newLines[newIndex]) {
      if (previewLines.length < MAX_DIFF_PREVIEW_LINES) previewLines.push(`  ${oldLines[oldIndex]}`);
      if (diffRows.length < MAX_DIFF_PREVIEW_LINES) {
        diffRows.push({ type: 'same', oldLine: oldLines[oldIndex], newLine: newLines[newIndex] });
      }
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (
      oldIndex < rows &&
      newIndex < cols &&
      oldLines[oldIndex] !== newLines[newIndex] &&
      table[oldIndex + 1][newIndex + 1] >= table[oldIndex + 1][newIndex] &&
      table[oldIndex + 1][newIndex + 1] >= table[oldIndex][newIndex + 1]
    ) {
      additions += 1;
      deletions += 1;
      if (previewLines.length < MAX_DIFF_PREVIEW_LINES) {
        previewLines.push(`- ${oldLines[oldIndex]}`);
        previewLines.push(`+ ${newLines[newIndex]}`);
      }
      if (diffRows.length < MAX_DIFF_PREVIEW_LINES) {
        diffRows.push({ type: 'change', oldLine: oldLines[oldIndex], newLine: newLines[newIndex] });
      }
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (newIndex < cols && (oldIndex === rows || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
      additions += 1;
      if (previewLines.length < MAX_DIFF_PREVIEW_LINES) previewLines.push(`+ ${newLines[newIndex]}`);
      if (diffRows.length < MAX_DIFF_PREVIEW_LINES) {
        diffRows.push({ type: 'add', newLine: newLines[newIndex] });
      }
      newIndex += 1;
      continue;
    }

    if (oldIndex < rows) {
      deletions += 1;
      if (previewLines.length < MAX_DIFF_PREVIEW_LINES) previewLines.push(`- ${oldLines[oldIndex]}`);
      if (diffRows.length < MAX_DIFF_PREVIEW_LINES) {
        diffRows.push({ type: 'delete', oldLine: oldLines[oldIndex] });
      }
      oldIndex += 1;
    }
  }

  if (previewLines.length >= MAX_DIFF_PREVIEW_LINES) {
    previewLines.push('... diff preview truncated ...');
  }

  return {
    additions,
    deletions,
    preview: previewLines.join('\n'),
    diffRows,
  };
}

async function getMergeWorkspace(workWindowId: string) {
  const window = await prisma.workWindow.findUnique({
    where: { id: workWindowId },
    include: {
      work: true,
      workspaceBranch: true,
    },
  });
  if (!window || window.archived) throw new Error('找不到指定窗口。');
  if (!window.work.projectPath) throw new Error('当前工作没有绑定原项目。');
  if (!window.workspaceBranch?.worktreePath) throw new Error('当前窗口没有可合并的独立工作区。');

  const sourcePath = normalizeProjectPath(window.workspaceBranch.worktreePath);
  const targetPath = normalizeProjectPath(window.work.projectPath);
  if (sourcePath === targetPath) throw new Error('窗口工作区和原项目相同，拒绝合并。');

  return {
    window,
    sourcePath,
    targetPath,
  };
}

async function getTrackedPatchPaths(workWindowId: string) {
  const runs = await prisma.toolRun.findMany({
    where: {
      workWindowId,
      toolName: 'apply_code_patch',
      status: 'completed',
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  const paths = new Set<string>();
  for (const run of runs) {
    if (!run.output) continue;
    try {
      const parsed = JSON.parse(run.output) as { edits?: Array<{ path?: unknown }> };
      for (const edit of parsed.edits || []) {
        if (typeof edit.path === 'string' && edit.path) paths.add(edit.path);
      }
    } catch {
      // Ignore old or truncated tool output.
    }
  }
  return [...paths];
}

async function readOptionalFile(root: string, relativePath: string) {
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  const fileStats = await stat(absolute).catch(() => null);
  if (!fileStats?.isFile()) return null;
  if (shouldIgnoreFile(relativePath, fileStats.size)) return null;
  return readFile(absolute, 'utf8').catch(() => null);
}

async function readGitFileAtCommit(projectPath: string, commit: string | null | undefined, relativePath: string) {
  if (!commit) return null;
  try {
    const result = await execFileAsync('git', ['show', `${commit}:${relativePath}`], {
      cwd: projectPath,
      timeout: 10_000,
      maxBuffer: 1024 * 1024 * 2,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

export async function getWindowMergePreview(workWindowId: string) {
  const workspace = await getMergeWorkspace(workWindowId);
  const trackedPatchPaths = await getTrackedPatchPaths(workWindowId);
  const trackedPatchPathSet = new Set(trackedPatchPaths);
  const isCopyFallback = workspace.window.workspaceBranch?.status === 'copy_ready';
  const recommendationForPath = (relativePath: string) => {
    if (!isCopyFallback) return { recommended: true, reason: undefined };
    if (trackedPatchPathSet.has(relativePath)) return { recommended: true, reason: undefined };
    return {
      recommended: false,
      reason: 'copy fallback 工作区中的未追踪差异默认不建议合并，避免把旧副本覆盖回原项目。',
    };
  };
  const conflictForPath = async (relativePath: string, sourceContent: string | null, targetContent: string | null) => {
    if (isCopyFallback || !workspace.window.workspaceBranch?.baseCommit) {
      return { conflict: false, conflictReason: undefined };
    }
    const baseContent = await readGitFileAtCommit(
      workspace.targetPath,
      workspace.window.workspaceBranch.baseCommit,
      relativePath
    );
    if (baseContent === null) return { conflict: false, conflictReason: undefined };
    const branchChanged = sourceContent !== baseContent;
    const targetChanged = targetContent !== baseContent;
    if (branchChanged && targetChanged && sourceContent !== targetContent) {
      return {
        conflict: true,
        conflictReason: '原项目和窗口分支都在 base commit 之后修改了此文件，需要先人工处理冲突。',
      };
    }
    return { conflict: false, conflictReason: undefined };
  };
  const [sourceScan, targetScan] = await Promise.all([
    scanProject(workspace.sourcePath),
    scanProject(workspace.targetPath),
  ]);
  const sourceFiles = new Map(sourceScan.files.map((file) => [file.path, file]));
  const targetFiles = new Map(targetScan.files.map((file) => [file.path, file]));
  const changes: MergeFileChange[] = [];

  for (const [relativePath, sourceFile] of sourceFiles) {
    const sourceContent = await readOptionalFile(workspace.sourcePath, relativePath);
    if (sourceContent === null) continue;
    const targetContent = await readOptionalFile(workspace.targetPath, relativePath);
    if (targetContent === null) {
      const diff = buildLineDiff(null, sourceContent);
      const recommendation = recommendationForPath(relativePath);
      const conflict = await conflictForPath(relativePath, sourceContent, targetContent);
      changes.push({
        path: relativePath,
        status: 'create',
        bytes: sourceFile.size,
        additions: diff.additions,
        deletions: diff.deletions,
        preview: diff.preview,
        diffRows: diff.diffRows,
        selectable: !conflict.conflict,
        ...recommendation,
        recommended: recommendation.recommended && !conflict.conflict,
        conflict: conflict.conflict,
        reason: conflict.conflictReason || recommendation.reason,
      });
      continue;
    }
    if (sourceContent !== targetContent) {
      const diff = buildLineDiff(targetContent, sourceContent);
      const recommendation = recommendationForPath(relativePath);
      const conflict = await conflictForPath(relativePath, sourceContent, targetContent);
      changes.push({
        path: relativePath,
        status: 'update',
        bytes: sourceFile.size,
        additions: diff.additions,
        deletions: diff.deletions,
        preview: diff.preview,
        diffRows: diff.diffRows,
        selectable: !conflict.conflict,
        ...recommendation,
        recommended: recommendation.recommended && !conflict.conflict,
        conflict: conflict.conflict,
        reason: conflict.conflictReason || recommendation.reason,
      });
    }
  }

  for (const relativePath of targetFiles.keys()) {
    if (!sourceFiles.has(relativePath)) {
      const targetContent = await readOptionalFile(workspace.targetPath, relativePath);
      const diff = buildLineDiff(targetContent, null);
      changes.push({
        path: relativePath,
        status: 'delete',
        bytes: 0,
        additions: diff.additions,
        deletions: diff.deletions,
        preview: diff.preview,
        diffRows: diff.diffRows,
        selectable: false,
        recommended: false,
        conflict: false,
        reason: '删除文件只做预览，不会自动合并。',
      });
    }
  }

  return {
    workId: workspace.window.workId,
    workWindowId,
    sourcePath: toRelativeProjectPath(workspace.sourcePath),
    targetPath: toRelativeProjectPath(workspace.targetPath),
    copyFallback: isCopyFallback,
    trackedPatchPaths,
    changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function applyWindowMerge(params: {
  workWindowId: string;
  paths?: string[];
}) {
  const preview = await getWindowMergePreview(params.workWindowId);
  const workspace = await getMergeWorkspace(params.workWindowId);
  const trackedPatchPaths = await getTrackedPatchPaths(params.workWindowId);
  const defaultPaths = workspace.window.workspaceBranch?.status === 'copy_ready'
    ? trackedPatchPaths
    : preview.changes.map((change) => change.path);
  const allowed = new Set(params.paths && params.paths.length > 0 ? params.paths : defaultPaths);
  if (workspace.window.workspaceBranch?.status === 'copy_ready' && allowed.size === 0) {
    throw new Error('copy fallback 工作区需要先通过 Agent 补丁工具产生可追踪改动，或显式选择要合并的文件。');
  }
  const applied: MergeFileChange[] = [];
  const skipped: MergeFileChange[] = [];
  const startedAt = Date.now();
  const toolRun = await prisma.toolRun.create({
    data: {
      workWindowId: params.workWindowId,
      toolName: 'merge_to_project',
      status: 'running',
      input: { paths: [...allowed] },
    },
  });

  try {
    for (const change of preview.changes) {
      if (!allowed.has(change.path)) continue;
      if (change.status === 'delete') {
        skipped.push(change);
        continue;
      }

      const sourceFile = path.resolve(workspace.sourcePath, change.path);
      const targetFile = path.resolve(workspace.targetPath, change.path);
      if (!sourceFile.startsWith(`${workspace.sourcePath}${path.sep}`) || !targetFile.startsWith(`${workspace.targetPath}${path.sep}`)) {
        throw new Error(`合并路径越界：${change.path}`);
      }
      const sourceStats = await stat(sourceFile);
      if (!sourceStats.isFile() || shouldIgnoreFile(change.path, sourceStats.size)) {
        throw new Error(`出于安全规则不能合并：${change.path}`);
      }
      const content = await readFile(sourceFile, 'utf8');
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(targetFile, content, 'utf8');
      applied.push(change);
    }

    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'completed',
        output: JSON.stringify({ applied, skipped }, null, 2),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    await prisma.work.update({
      where: { id: workspace.window.workId },
      data: { updatedAt: new Date() },
    });

    return {
      preview,
      applied,
      skipped,
      work: await getWork(workspace.window.workId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.toolRun.update({
      where: { id: toolRun.id },
      data: {
        status: 'failed',
        error: message,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined);
    throw error;
  }
}

export async function markWindowWinner(workWindowId: string) {
  const window = await prisma.workWindow.findUnique({ where: { id: workWindowId } });
  if (!window) throw new Error('找不到指定窗口。');
  await prisma.$transaction([
    prisma.workWindow.updateMany({
      where: { workId: window.workId },
      data: { isWinner: false },
    }),
    prisma.workWindow.update({
      where: { id: workWindowId },
      data: { isWinner: true },
    }),
  ]);
  return getWork(window.workId);
}
