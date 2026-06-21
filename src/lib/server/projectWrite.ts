import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { normalizeCodePatchProposal } from '@/lib/codePatch';
import {
  CodePatchProposal,
  ProjectPatchEditResult,
  ProjectPatchResult,
  ProposedFileEdit,
} from '@/types';
import {
  MAX_FILE_BYTES,
  isIgnoredDir,
  normalizeProjectPath,
  shouldIgnoreFile,
  toRelativeProjectPath,
} from './projectContext';

type PreparedEdit = {
  edit: ProposedFileEdit;
  absoluteFile: string;
  nextContent: string;
  bytes: number;
};

function normalizeRelativeFilePath(absoluteProjectPath: string, filePath: string) {
  const absoluteFile = path.resolve(absoluteProjectPath, filePath);
  if (absoluteFile === absoluteProjectPath || !absoluteFile.startsWith(`${absoluteProjectPath}${path.sep}`)) {
    throw new Error(`文件路径不在当前项目内：${filePath}`);
  }

  const relativeFile = path.relative(absoluteProjectPath, absoluteFile).replace(/\\/g, '/');
  const parts = relativeFile.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`文件路径无效：${filePath}`);
  }
  if (parts.slice(0, -1).some((part) => isIgnoredDir(part))) {
    throw new Error(`不能修改隐藏目录、依赖目录或构建目录中的文件：${relativeFile}`);
  }

  return { absoluteFile, relativeFile };
}

function countOccurrences(text: string, search: string) {
  if (!search) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const next = text.indexOf(search, index);
    if (next === -1) return count;
    count += 1;
    index = next + search.length;
  }
}

async function prepareCreate(absoluteProjectPath: string, edit: ProposedFileEdit): Promise<PreparedEdit> {
  const { absoluteFile, relativeFile } = normalizeRelativeFilePath(absoluteProjectPath, edit.path);
  const bytes = Buffer.byteLength(edit.newText);

  if (shouldIgnoreFile(relativeFile, bytes)) {
    throw new Error(`出于安全规则，不能创建这个文件：${relativeFile}`);
  }
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(`文件过大，不能创建：${relativeFile}`);
  }

  const existing = await stat(absoluteFile).catch(() => null);
  if (existing) {
    throw new Error(`文件已存在，不能用 create 覆盖：${relativeFile}`);
  }

  return {
    edit: { ...edit, path: relativeFile },
    absoluteFile,
    nextContent: edit.newText,
    bytes,
  };
}

async function prepareUpdate(absoluteProjectPath: string, edit: ProposedFileEdit): Promise<PreparedEdit> {
  const { absoluteFile, relativeFile } = normalizeRelativeFilePath(absoluteProjectPath, edit.path);
  const fileStats = await stat(absoluteFile).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    throw new Error(`找不到要更新的文件：${relativeFile}`);
  }
  if (shouldIgnoreFile(relativeFile, fileStats.size)) {
    throw new Error(`出于安全规则，不能修改这个文件：${relativeFile}`);
  }
  if (!edit.oldText) {
    throw new Error(`更新文件必须提供 oldText：${relativeFile}`);
  }

  const current = await readFile(absoluteFile, 'utf8');
  const matches = countOccurrences(current, edit.oldText);
  if (matches !== 1) {
    throw new Error(`oldText 必须在文件中精确匹配一次，当前匹配 ${matches} 次：${relativeFile}`);
  }

  const nextContent = current.replace(edit.oldText, edit.newText);
  const bytes = Buffer.byteLength(nextContent);
  if (shouldIgnoreFile(relativeFile, bytes) || bytes > MAX_FILE_BYTES) {
    throw new Error(`修改后的文件过大或不符合安全规则：${relativeFile}`);
  }

  return {
    edit: { ...edit, path: relativeFile },
    absoluteFile,
    nextContent,
    bytes,
  };
}

async function prepareEdit(absoluteProjectPath: string, edit: ProposedFileEdit) {
  return edit.operation === 'create'
    ? prepareCreate(absoluteProjectPath, edit)
    : prepareUpdate(absoluteProjectPath, edit);
}

export async function applyProjectPatch(params: {
  projectPath: string;
  proposal: unknown;
  dryRun?: boolean;
}): Promise<ProjectPatchResult> {
  const proposal = normalizeCodePatchProposal(params.proposal);
  if (!proposal) {
    throw new Error('没有收到有效的代码修改提案。');
  }

  const absoluteProjectPath = normalizeProjectPath(params.projectPath);
  const projectStats = await stat(absoluteProjectPath).catch(() => null);
  if (!projectStats?.isDirectory()) {
    throw new Error('项目路径不是目录。');
  }

  const seen = new Set<string>();
  const prepared: PreparedEdit[] = [];

  for (const edit of proposal.edits) {
    const normalized = normalizeRelativeFilePath(absoluteProjectPath, edit.path);
    if (seen.has(normalized.relativeFile)) {
      throw new Error(`一次提案中同一个文件只能出现一次：${normalized.relativeFile}`);
    }
    seen.add(normalized.relativeFile);
    prepared.push(await prepareEdit(absoluteProjectPath, edit));
  }

  if (!params.dryRun) {
    for (const item of prepared) {
      await mkdir(path.dirname(item.absoluteFile), { recursive: true });
      await writeFile(item.absoluteFile, item.nextContent, 'utf8');
    }
  }

  const edits: ProjectPatchEditResult[] = prepared.map((item) => ({
    operation: item.edit.operation,
    path: item.edit.path,
    status: params.dryRun ? 'ready' : 'applied',
    bytes: item.bytes,
  }));

  return {
    projectPath: toRelativeProjectPath(absoluteProjectPath),
    summary: (proposal as CodePatchProposal).summary,
    edits,
  };
}
