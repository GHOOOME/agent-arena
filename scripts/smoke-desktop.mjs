import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import electronPath from 'electron';

const root = process.cwd();
const child = spawn(electronPath, ['electron/main.cjs'], {
  cwd: root,
  env: {
    ...process.env,
    ARENA_DESKTOP_PORT: '3867',
    ARENA_DESKTOP_SMOKE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let settled = false;

function append(chunk) {
  output += chunk.toString();
  if (output.length > 120_000) output = output.slice(-120_000);
}

child.stdout.on('data', append);
child.stderr.on('data', append);

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  console.error(output);
  console.error('Desktop smoke timed out.');
  process.exit(1);
}, 120_000);

const [code, signal] = await once(child, 'exit');
if (!settled) {
  settled = true;
  clearTimeout(timeout);
}

if (code !== 0) {
  console.error(output);
  console.error(`Desktop smoke failed: code ${code}, signal ${signal || 'none'}.`);
  process.exit(code || 1);
}

const loaded = output.includes('[arena-desktop-smoke] loaded');
if (!loaded) {
  console.error(output);
  console.error('Desktop smoke did not report a loaded window.');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  main: path.join(root, 'electron/main.cjs'),
}, null, 2));
