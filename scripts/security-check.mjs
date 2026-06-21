import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  '.arena-local',
  '.codex-runtime',
  '.agents',
  '.claude',
  '.cursor',
  '.gemini',
  '.kiro',
  '.qoder',
  '.vscode',
  '.idea',
  'node_modules',
  'coverage',
  'out',
  'build',
  'dist',
  'public/generated',
  'public/uploads',
]);

const ignoredFiles = new Set(['package-lock.json']);

const binaryExtensions = new Set([
  '.ico',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.sqlite',
  '.db',
]);

const patterns = [
  {
    name: 'Token Plan key-like value',
    regex: /\bsk-(?:sp-)?[A-Za-z0-9._+/=-]{20,}\b/g,
  },
  {
    name: 'Non-empty ALIYUN_TOKEN_PLAN_API_KEY',
    regex: /^ALIYUN_TOKEN_PLAN_API_KEY=(?!\s*$).+/gm,
  },
  {
    name: 'Non-empty DASHSCOPE_API_KEY',
    regex: /^DASHSCOPE_API_KEY=(?!\s*$).+/gm,
  },
  {
    name: 'Non-empty OPENAI_API_KEY',
    regex: /^OPENAI_API_KEY=(?!\s*$).+/gm,
  },
  {
    name: 'Non-empty ANTHROPIC_API_KEY',
    regex: /^ANTHROPIC_API_KEY=(?!\s*$).+/gm,
  },
];

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function shouldIgnore(filePath) {
  const relative = normalize(path.relative(root, filePath));
  if (!relative || ignoredFiles.has(relative)) return true;
  if (binaryExtensions.has(path.extname(relative).toLowerCase())) return true;
  return [...ignoredDirs].some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    if (shouldIgnore(next)) continue;
    if (entry.isDirectory()) {
      await walk(next, files);
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

const files = await walk(root);
const findings = [];

for (const file of files) {
  const info = await stat(file);
  if (info.size > 2_000_000) continue;

  const text = await readFile(file, 'utf8').catch(() => '');
  if (!text) continue;

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text))) {
      findings.push({
        file: normalize(path.relative(root, file)),
        line: lineNumber(text, match.index),
        type: pattern.name,
      });
    }
  }
}

if (findings.length) {
  console.error('Potential secrets found. Values are intentionally hidden:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.type}`);
  }
  process.exit(1);
}

console.log(`Security check passed. Scanned ${files.length} files.`);
