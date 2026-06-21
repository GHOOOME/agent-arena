import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { createChatCompletion, buildChatMessages } from './aliyun';
import { ProjectFileEntry, ProjectContextSelection, ProjectContextSummary } from '@/types';
import { DEFAULT_PROJECT_AGENT_PERMISSION, PROJECT_AGENT_PERMISSION_COPY } from '@/lib/agentPermissions';

export const WORKSPACE_ROOT = '/Users/mac/Documents';
export const USER_HOME = process.env.HOME || path.dirname(WORKSPACE_ROOT);
const MAX_SCAN_FILES = 500;
export const MAX_FILE_BYTES = 120_000;
const MAX_AGENT_SELECTED_FILES = 18;
const MAX_AGENT_CANDIDATE_FILES = 120;
const MAX_AGENT_READ_BYTES = 360_000;

export const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.vercel',
  '.expo',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'DerivedData',
]);

export const IGNORED_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.tsbuildinfo',
]);

export const BLOCKED_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
  '.der',
  '.sqlite',
  '.db',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mov',
  '.mp4',
  '.mp3',
  '.wav',
  '.pdf',
  '.glb',
  '.wasm',
]);

export const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.scss',
  '.html',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.sql',
  '.prisma',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.txt',
  '.xml',
]);

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'where',
  'when',
  'why',
  'how',
  'into',
  'your',
  'about',
  '请',
  '帮我',
  '分析',
  '项目',
  '代码',
  '功能',
  '问题',
  '哪里',
  '怎么',
  '为什么',
  '一下',
  '这个',
  '那个',
  '实现',
  '看看',
]);

function isSameOrInside(childPath: string, parentPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const BLOCKED_EXACT_PROJECT_ROOTS = [
  USER_HOME,
  path.join(USER_HOME, 'Desktop'),
  path.join(USER_HOME, 'Documents'),
  path.join(USER_HOME, 'Downloads'),
].map((entry) => path.resolve(entry));

const BLOCKED_SENSITIVE_PROJECT_ROOTS = [
  path.join(USER_HOME, 'Library'),
  path.join(USER_HOME, 'Applications'),
  path.join(USER_HOME, '.Trash'),
  path.join(USER_HOME, '.ssh'),
  path.join(USER_HOME, '.gnupg'),
  path.join(USER_HOME, '.codex'),
].map((entry) => path.resolve(entry));

function validateLocalProjectPath(absolutePath: string) {
  if (!isSameOrInside(absolutePath, USER_HOME)) {
    throw new Error(`项目路径必须位于当前用户目录下：${USER_HOME}`);
  }

  if (BLOCKED_EXACT_PROJECT_ROOTS.includes(absolutePath)) {
    throw new Error('请选择一个具体项目文件夹，不要选择桌面、文档、下载或用户目录本身。');
  }

  if (BLOCKED_SENSITIVE_PROJECT_ROOTS.some((blockedRoot) => isSameOrInside(absolutePath, blockedRoot))) {
    throw new Error('不能把系统、应用或私密配置目录作为项目文件夹。');
  }

  if (absolutePath.includes(`${path.sep}..${path.sep}`)) {
    throw new Error('项目路径包含无效片段。');
  }
}

export function normalizeProjectPath(projectPath: string) {
  const trimmed = projectPath.trim();
  if (!trimmed) {
    throw new Error('请选择项目文件夹。');
  }

  const absolute = path.resolve(
    path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(WORKSPACE_ROOT, trimmed.replace(/^\/+/, ''))
  );

  if (!path.isAbsolute(trimmed) && !isSameOrInside(absolute, WORKSPACE_ROOT)) {
    throw new Error(`相对项目路径必须位于 ${WORKSPACE_ROOT} 下。`);
  }

  validateLocalProjectPath(absolute);
  return absolute;
}

export function toRelativeProjectPath(absoluteProjectPath: string) {
  const absolute = path.resolve(absoluteProjectPath);
  if (isSameOrInside(absolute, WORKSPACE_ROOT)) {
    return path.relative(WORKSPACE_ROOT, absolute).replace(/\\/g, '/');
  }
  return absolute;
}

export function shouldIgnoreFile(relativePath: string, size: number) {
  const basename = path.basename(relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  if (size > MAX_FILE_BYTES) return true;
  if (IGNORED_FILENAMES.has(basename)) return true;
  if (basename.startsWith('.env')) return true;
  if (/(secret|token|credential|password|private|apikey|api_key)/i.test(basename)) return true;
  if (BLOCKED_EXTENSIONS.has(ext)) return true;
  if (!ALLOWED_EXTENSIONS.has(ext)) return true;
  return false;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function basenameWithoutExtension(filePath: string) {
  return path.basename(filePath, path.extname(filePath));
}

function extractSearchTerms(prompt: string) {
  const terms = prompt
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu);
  if (!terms) return [];
  return unique(
    terms
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term))
      .slice(0, 24)
  );
}

function compactFileList(files: ProjectFileEntry[], limit = MAX_AGENT_CANDIDATE_FILES) {
  return files.slice(0, limit).map((file) => `${file.path} (${file.size} B)`).join('\n');
}

function tryParseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(candidate) as { files?: unknown; queries?: unknown; reason?: unknown };
  } catch {
    return null;
  }
}

function filePriority(file: ProjectFileEntry) {
  const name = file.name.toLowerCase();
  const pathName = file.path.toLowerCase();
  let score = 0;
  if (['package.json', 'pyproject.toml', 'go.mod', 'cargo.toml', 'readme.md'].includes(name)) score += 8;
  if (pathName.includes('/app/') || pathName.includes('/pages/') || pathName.includes('/api/')) score += 5;
  if (pathName.includes('/components/') || pathName.includes('/hooks/') || pathName.includes('/lib/')) score += 4;
  if (pathName.includes('/stores/') || pathName.includes('/server/')) score += 3;
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.prisma'].includes(file.extension)) score += 3;
  if (file.size < 30_000) score += 2;
  return score;
}

async function readSafeFile(absoluteProjectPath: string, relativeFile: string) {
  const absoluteFile = path.resolve(absoluteProjectPath, relativeFile);
  if (!absoluteFile.startsWith(`${absoluteProjectPath}${path.sep}`)) return null;
  const fileStats = await stat(absoluteFile).catch(() => null);
  if (!fileStats || !fileStats.isFile() || shouldIgnoreFile(relativeFile, fileStats.size)) return null;
  const content = await readFile(absoluteFile, 'utf8').catch(() => '');
  if (!content) return null;
  return {
    content,
    bytes: Buffer.byteLength(content),
  };
}

async function scoreFilesByPrompt(projectPath: string, prompt: string, files: ProjectFileEntry[]) {
  const absoluteProjectPath = normalizeProjectPath(projectPath);
  const terms = extractSearchTerms(prompt);
  const scored = new Map<string, number>();

  for (const file of files) {
    let score = filePriority(file);
    const haystack = `${file.path} ${basenameWithoutExtension(file.path)}`.toLowerCase();
    for (const term of terms) {
      if (haystack.includes(term)) score += 10;
    }
    if (score > 0) scored.set(file.path, score);
  }

  const contentCandidates = files
    .filter((file) => file.size <= 60_000)
    .sort((a, b) => filePriority(b) - filePriority(a))
    .slice(0, 180);

  await Promise.all(
    contentCandidates.map(async (file) => {
      const read = await readSafeFile(absoluteProjectPath, file.path);
      if (!read) return;
      const content = read.content.toLowerCase();
      let score = scored.get(file.path) || 0;
      for (const term of terms) {
        const first = content.indexOf(term);
        if (first >= 0) {
          score += 6;
          const second = content.indexOf(term, first + term.length);
          if (second >= 0) score += 3;
        }
      }
      if (score > 0) scored.set(file.path, score);
    })
  );

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([file]) => file);
}

async function planFilesWithModel(params: {
  modelSlug: string;
  projectPath: string;
  prompt: string;
  files: ProjectFileEntry[];
  signal?: AbortSignal;
}) {
  const candidates = params.files
    .sort((a, b) => filePriority(b) - filePriority(a) || a.path.localeCompare(b.path))
    .slice(0, MAX_AGENT_CANDIDATE_FILES);
  const messages = buildChatMessages([
    {
      role: 'system',
      content: [
        '你是本地只读代码项目 Agent 的文件选择器。',
        '你不能运行命令，不能读取未列出的文件，只能从用户给你的文件清单中选择最可能相关的文件。',
        `最多选择 ${MAX_AGENT_SELECTED_FILES} 个文件。`,
        '只返回 JSON，不要 markdown，不要解释。',
        'JSON 格式：{"queries":["关键词"],"files":["path/from/list"],"reason":"一句话说明"}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `项目：${params.projectPath}`,
        `用户问题：${params.prompt}`,
        '',
        '安全文件清单：',
        compactFileList(candidates),
      ].join('\n'),
    },
  ]);

  const response = await createChatCompletion({
    model: params.modelSlug,
    messages,
    signal: params.signal,
    temperature: 0,
    maxTokens: 1000,
  });

  if (!response.ok) {
    throw new Error(`计划读取文件失败：HTTP ${response.status}`);
  }

  const json = await response.json();
  const text = String(json.choices?.[0]?.message?.content || '');
  const parsed = tryParseJsonObject(text);
  if (!parsed) {
    throw new Error('计划读取文件失败：模型没有返回可解析 JSON。');
  }

  const allowed = new Set(params.files.map((file) => file.path));
  const files = Array.isArray(parsed.files)
    ? parsed.files
      .map((item) => String(item))
      .filter((file) => allowed.has(file))
      .slice(0, MAX_AGENT_SELECTED_FILES)
    : [];
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries.map((item) => String(item)).filter(Boolean).slice(0, 8)
    : [];

  if (files.length === 0) {
    throw new Error('计划读取文件失败：模型没有选择可读文件。');
  }

  return { files, queries, fallback: false };
}

async function fallbackPlanFiles(projectPath: string, prompt: string, files: ProjectFileEntry[]) {
  const scored = await scoreFilesByPrompt(projectPath, prompt, files);
  const selected = scored.length > 0
    ? scored.slice(0, MAX_AGENT_SELECTED_FILES)
    : files
      .sort((a, b) => filePriority(b) - filePriority(a) || a.path.localeCompare(b.path))
      .slice(0, Math.min(10, MAX_AGENT_SELECTED_FILES))
      .map((file) => file.path);

  return {
    files: selected,
    queries: extractSearchTerms(prompt).slice(0, 8),
    fallback: true,
  };
}

export function isIgnoredDir(dirname: string) {
  return IGNORED_DIRS.has(dirname) || dirname.startsWith('.');
}

export async function listProjects() {
  const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
  const projects: Array<{ name: string; path: string; hasProjectMarker: boolean }> = [];

  async function addProject(absolutePath: string, relativePath: string, displayName: string) {
    const children = await readdir(absolutePath).catch(() => []);
    const hasProjectMarker = children.some((name) =>
      ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'docker-compose.yml', 'compose.yml', 'prisma'].includes(name)
    );
    projects.push({
      name: displayName,
      path: relativePath,
      hasProjectMarker,
    });
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredDir(entry.name)) continue;
    const absolutePath = path.join(WORKSPACE_ROOT, entry.name);
    await addProject(absolutePath, entry.name, entry.name);

    if (entry.name === 'arena-projects') {
      const children = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (!child.isDirectory() || isIgnoredDir(child.name)) continue;
        await addProject(
          path.join(absolutePath, child.name),
          `arena-projects/${child.name}`,
          `arena-projects / ${child.name}`
        );
      }
    }
  }

  return projects.sort((a, b) => Number(b.hasProjectMarker) - Number(a.hasProjectMarker) || a.name.localeCompare(b.name));
}

export async function scanProject(projectPath: string): Promise<{ projectPath: string; files: ProjectFileEntry[] }> {
  const absoluteProjectPath = normalizeProjectPath(projectPath);
  const rootStats = await stat(absoluteProjectPath);
  if (!rootStats.isDirectory()) {
    throw new Error('项目路径不是目录。');
  }

  const files: ProjectFileEntry[] = [];

  async function walk(current: string) {
    if (files.length >= MAX_SCAN_FILES) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) return;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(absoluteProjectPath, absolute).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) {
          await walk(absolute);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const fileStats = await stat(absolute).catch(() => null);
      if (!fileStats || shouldIgnoreFile(relative, fileStats.size)) continue;

      files.push({
        path: relative,
        name: entry.name,
        size: fileStats.size,
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  }

  await walk(absoluteProjectPath);
  return {
    projectPath: toRelativeProjectPath(absoluteProjectPath),
    files,
  };
}

export async function buildProjectContext(selection?: ProjectContextSelection | null): Promise<{
  context: string;
  summary: ProjectContextSummary | null;
}> {
  void selection;
  return { context: '', summary: null };
}

export async function buildAgentProjectContext(params: {
  selection?: ProjectContextSelection | null;
  modelSlug: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<{
  context: string;
  summary: ProjectContextSummary | null;
}> {
  const selection = params.selection;
  if (!selection || !selection.projectPath || selection.mode !== 'agent') {
    return { context: '', summary: null };
  }

  const absoluteProjectPath = normalizeProjectPath(selection.projectPath);
  const scanned = await scanProject(selection.projectPath);
  if (scanned.files.length === 0) {
    return { context: '', summary: null };
  }

  let plan: { files: string[]; queries: string[]; fallback: boolean };
  try {
    plan = await planFilesWithModel({
      modelSlug: params.modelSlug,
      projectPath: scanned.projectPath,
      prompt: params.prompt,
      files: scanned.files,
      signal: params.signal,
    });
  } catch {
    plan = await fallbackPlanFiles(scanned.projectPath, params.prompt, scanned.files);
  }

  const allowed = new Set(scanned.files.map((file) => file.path));
  const requested = unique(plan.files.filter((file) => allowed.has(file))).slice(0, MAX_AGENT_SELECTED_FILES);
  let totalBytes = 0;
  const includedFiles: string[] = [];
  const blocks: string[] = [];

  for (const relativeFile of requested) {
    const read = await readSafeFile(absoluteProjectPath, relativeFile);
    if (!read || totalBytes + read.bytes > MAX_AGENT_READ_BYTES) continue;
    totalBytes += read.bytes;
    includedFiles.push(relativeFile);
    blocks.push(`--- FILE: ${relativeFile} ---\n${read.content}`);
  }

  if (blocks.length === 0) {
    return { context: '', summary: null };
  }

  const permissionMode = selection.permissionMode || DEFAULT_PROJECT_AGENT_PERMISSION;
  const permissionCopy = PROJECT_AGENT_PERMISSION_COPY[permissionMode];
  const writeGuidance = selection.writeEnabled
    ? [
        '',
        '--- WRITABLE AGENT PROPOSAL MODE ---',
        '用户已允许你提出本地代码修改提案，但你不能声称已经修改文件。',
        `当前 Agent 权限档位：${permissionCopy.title}，${permissionCopy.description}`,
        '如果用户要求改代码，请先解释你的方案，然后在回答末尾提供一个单独的 fenced 代码块。',
        '代码块语言标记必须是 CODE_PATCH，内容必须是严格 JSON：',
        '{"type":"code_patch","projectPath":"当前项目路径","summary":"一句话说明","edits":[{"operation":"update","path":"相对路径","oldText":"文件中必须精确匹配一次的原文片段","newText":"替换后的完整片段","note":"可选说明"}]}',
        '创建新文件时 operation 使用 create，必须提供 path 和 newText，不要提供 oldText。',
        '更新已有文件时 operation 使用 update，oldText 必须是你在上下文里真实看到的连续原文，且只包含一个可精确替换的片段。',
        '一次最多提出 8 个文件改动。不要输出 shell 命令，不要修改 .env、密钥、锁文件、依赖目录、构建目录或二进制文件。',
        '如果缺少必要文件上下文，请说明需要继续查看哪些文件，不要猜测生成 patch。',
      ]
    : [
        '',
        '当前项目 Agent 是只读模式。你可以分析代码和建议修改，但不要输出 CODE_PATCH，也不要声称已经修改本地文件。',
      ];

  return {
    context: [
      selection.writeEnabled
        ? '以下是本地项目 Agent 按用户问题自动选择并允许发送给模型分析的项目文件上下文；当前允许模型提出代码修改提案。'
        : '以下是本地只读项目 Agent 按用户问题自动选择并允许发送给模型分析的项目文件上下文。',
      `这些文件来自本机用户目录 ${USER_HOME} 下的安全扫描结果；密钥、隐藏目录、依赖目录、大文件和二进制文件已被过滤。`,
      '请优先基于这些文件回答。如果上下文不足，请明确指出还需要查看哪些文件。',
      `项目：${scanned.projectPath}`,
      `Agent 查询关键词：${plan.queries.length > 0 ? plan.queries.join(', ') : '未生成'}`,
      `选择方式：${plan.fallback ? '本地关键词兜底' : '模型计划读取'}`,
      ...writeGuidance,
      '',
      blocks.join('\n\n'),
    ].join('\n'),
    summary: {
      projectPath: scanned.projectPath,
      mode: 'agent',
      writeEnabled: Boolean(selection.writeEnabled),
      permissionMode,
      fileCount: includedFiles.length,
      totalBytes,
      scannedFileCount: scanned.files.length,
      files: includedFiles,
      queries: plan.queries,
      fallback: plan.fallback,
    },
  };
}
