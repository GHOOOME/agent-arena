import { execFile } from 'child_process';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { normalizeProjectPath, toRelativeProjectPath, WORKSPACE_ROOT } from './projectContext';

const execFileAsync = promisify(execFile);
const ARENA_PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'arena-projects');
const GITIGNORE_LINES = [
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.sqlite',
  '*.db',
  '.DS_Store',
];

export type ProjectOnboardingResult = {
  projectPath: string | null;
  absoluteProjectPath?: string;
  mode: 'chat_only' | 'new_project' | 'existing_project' | 'remote_project';
  safety: {
    status: 'chat_only' | 'ready' | 'created_git' | 'created_initial_snapshot' | 'has_uncommitted_changes';
    title: string;
    message: string;
    details: string[];
  };
};

function slugifyProjectName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `arena-project-${new Date().toISOString().slice(0, 10)}`;
}

function repoNameFromUrl(remoteUrl: string) {
  const cleaned = remoteUrl.trim().replace(/[#?].*$/, '').replace(/\/+$/, '');
  const last = cleaned.split('/').pop() || '';
  return last.replace(/\.git$/i, '') || 'imported-project';
}

async function runGit(cwd: string, args: string[]) {
  return execFileAsync('git', args, {
    cwd,
    timeout: 60_000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

async function pathExists(absolutePath: string) {
  return stat(absolutePath).then(() => true).catch(() => false);
}

async function ensureGitignore(absoluteProjectPath: string) {
  const gitignorePath = path.join(absoluteProjectPath, '.gitignore');
  const existing = await readFile(gitignorePath, 'utf8').catch(() => '');
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = GITIGNORE_LINES.filter((line) => !existingLines.has(line));
  if (missing.length === 0 && existing) return false;
  const next = [
    existing.trim(),
    existing.trim() ? '' : '',
    '# Token Plan Arena safety defaults',
    ...missing,
  ].filter((line, index, list) => line || (index > 0 && list[index - 1])).join('\n');
  await writeFile(gitignorePath, `${next.trim()}\n`, 'utf8');
  return true;
}

async function hasGitRepository(absoluteProjectPath: string) {
  return runGit(absoluteProjectPath, ['rev-parse', '--is-inside-work-tree'])
    .then(() => true)
    .catch(() => false);
}

async function hasCommit(absoluteProjectPath: string) {
  return runGit(absoluteProjectPath, ['rev-parse', '--verify', 'HEAD'])
    .then(() => true)
    .catch(() => false);
}

async function isDirty(absoluteProjectPath: string) {
  const result = await runGit(absoluteProjectPath, ['status', '--porcelain']).catch(() => ({ stdout: '' }));
  return Boolean(result.stdout.trim());
}

async function createInitialSnapshot(absoluteProjectPath: string) {
  await runGit(absoluteProjectPath, ['add', '-A']);
  await runGit(absoluteProjectPath, [
    '-c',
    'user.name=Token Plan Arena',
    '-c',
    'user.email=arena@local',
    'commit',
    '-m',
    'Initial safety snapshot',
  ]);
}

async function ensureLocalVersionRecord(absoluteProjectPath: string) {
  const details: string[] = [];
  const gitExists = await hasGitRepository(absoluteProjectPath);
  if (!gitExists) {
    await runGit(absoluteProjectPath, ['init']);
    details.push('已创建本地版本记录。');
  }

  const ignored = await ensureGitignore(absoluteProjectPath);
  if (ignored) details.push('已写入安全忽略规则，密钥和依赖目录不会进入快照。');

  const committed = await hasCommit(absoluteProjectPath);
  if (!committed) {
    await createInitialSnapshot(absoluteProjectPath);
    details.push('已创建初始安全快照。');
    return {
      status: gitExists ? 'created_initial_snapshot' as const : 'created_git' as const,
      details,
    };
  }

  if (await isDirty(absoluteProjectPath)) {
    details.push('检测到已有未保存到版本记录的改动，系统不会自动提交它们。');
    return {
      status: 'has_uncommitted_changes' as const,
      details,
    };
  }

  details.push('项目已有可用的本地版本记录。');
  return {
    status: 'ready' as const,
    details,
  };
}

async function writeStarterProject(absoluteProjectPath: string, projectName: string) {
  await mkdir(path.join(absoluteProjectPath, 'app'), { recursive: true });
  await writeFile(
    path.join(absoluteProjectPath, 'package.json'),
    JSON.stringify({
      name: slugifyProjectName(projectName),
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '16.1.6',
        react: '19.2.3',
        'react-dom': '19.2.3',
      },
    }, null, 2) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(absoluteProjectPath, 'app', 'layout.js'),
    [
      'export const metadata = {',
      `  title: ${JSON.stringify(projectName)},`,
      '};',
      '',
      'export default function RootLayout({ children }) {',
      '  return (',
      '    <html lang="zh-CN">',
      '      <body>{children}</body>',
      '    </html>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(absoluteProjectPath, 'app', 'page.js'),
    [
      'export default function Home() {',
      '  return (',
      '    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif" }}>',
      '      <section style={{ maxWidth: 720, padding: 32 }}>',
      `        <h1>${projectName}</h1>`,
      '        <p>这是 Token Plan Arena 创建的新项目。你可以让不同窗口分别开发它。</p>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(absoluteProjectPath, 'README.md'),
    [
      `# ${projectName}`,
      '',
      'This project was created by Token Plan Arena.',
      '',
      'Run locally:',
      '',
      '```bash',
      'npm install',
      'npm run dev',
      '```',
      '',
    ].join('\n'),
    'utf8'
  );
}

export function chatOnlyProject(): ProjectOnboardingResult {
  return {
    projectPath: null,
    mode: 'chat_only',
    safety: {
      status: 'chat_only',
      title: '纯对话模式',
      message: '这个工作不会绑定项目。可以对话和对比模型，但不会读写本地代码。',
      details: ['本地 Agent、预览、合并和 Codex CLI Runtime 会保持不可用，直到绑定项目。'],
    },
  };
}

export async function createLocalProject(params: {
  projectName: string;
}) {
  const projectName = params.projectName.trim() || '新的项目';
  const slug = slugifyProjectName(projectName);
  const absoluteProjectPath = path.join(ARENA_PROJECTS_DIR, slug);
  if (await pathExists(absoluteProjectPath)) {
    throw new Error(`项目已存在：arena-projects/${slug}`);
  }
  await mkdir(absoluteProjectPath, { recursive: true });
  await writeStarterProject(absoluteProjectPath, projectName);
  const version = await ensureLocalVersionRecord(absoluteProjectPath);
  return buildResult({
    absoluteProjectPath,
    mode: 'new_project',
    title: '新项目已准备好',
    message: '系统已创建项目文件夹、本地版本记录和初始安全快照。',
    status: version.status,
    details: version.details,
  });
}

export async function prepareExistingProject(params: {
  projectPath: string;
}) {
  const absoluteProjectPath = normalizeProjectPath(params.projectPath);
  const rootStats = await stat(absoluteProjectPath);
  if (!rootStats.isDirectory()) throw new Error('请选择一个项目文件夹。');
  const version = await ensureLocalVersionRecord(absoluteProjectPath);
  const message = version.status === 'has_uncommitted_changes'
    ? '项目可以使用，但检测到已有未保存到版本记录的改动。窗口分支会从最近一次安全快照开始。'
    : '项目已具备安全工作区基础。';
  return buildResult({
    absoluteProjectPath,
    mode: 'existing_project',
    title: '项目已准备好',
    message,
    status: version.status,
    details: version.details,
  });
}

export async function importRemoteProject(params: {
  remoteUrl: string;
  projectName?: string;
}) {
  const remoteUrl = params.remoteUrl.trim();
  if (!/^https:\/\/[^\s]+$/i.test(remoteUrl)) {
    throw new Error('第一版只支持 https:// 开头的远程项目链接。');
  }
  const projectName = params.projectName?.trim() || repoNameFromUrl(remoteUrl);
  const slug = slugifyProjectName(projectName);
  const absoluteProjectPath = path.join(ARENA_PROJECTS_DIR, slug);
  if (await pathExists(absoluteProjectPath)) {
    throw new Error(`项目已存在：arena-projects/${slug}`);
  }
  await mkdir(ARENA_PROJECTS_DIR, { recursive: true });
  await execFileAsync('git', ['clone', remoteUrl, absoluteProjectPath], {
    cwd: ARENA_PROJECTS_DIR,
    timeout: 300_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  const version = await ensureLocalVersionRecord(absoluteProjectPath);
  return buildResult({
    absoluteProjectPath,
    mode: 'remote_project',
    title: '远程项目已导入',
    message: '系统已把远程项目下载到本地，并准备好安全工作区。',
    status: version.status,
    details: version.details,
  });
}

function buildResult(params: {
  absoluteProjectPath: string;
  mode: ProjectOnboardingResult['mode'];
  title: string;
  message: string;
  status: ProjectOnboardingResult['safety']['status'];
  details: string[];
}): ProjectOnboardingResult {
  return {
    projectPath: toRelativeProjectPath(params.absoluteProjectPath),
    absoluteProjectPath: params.absoluteProjectPath,
    mode: params.mode,
    safety: {
      status: params.status,
      title: params.title,
      message: params.message,
      details: params.details,
    },
  };
}
