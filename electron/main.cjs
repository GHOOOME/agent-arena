const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number.parseInt(process.env.ARENA_DESKTOP_PORT || '3857', 10);
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 90_000;
const SMOKE_MODE = process.env.ARENA_DESKTOP_SMOKE === '1';
const EXPLICIT_DESKTOP_URL = process.env.ARENA_DESKTOP_URL || '';
const REUSE_EXISTING_SERVER = process.env.ARENA_DESKTOP_REUSE !== '0';

let serverProcess = null;
let mainWindow = null;

function isPackagedRun() {
  return app.isPackaged || process.env.ARENA_DESKTOP_MODE === 'production';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port, timeout: 500 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const server = net.createServer();
      server.unref();
      server.on('error', () => tryPort(port + 1));
      server.listen(port, HOST, () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : port));
      });
    }

    if (!Number.isFinite(startPort) || startPort <= 0) {
      reject(new Error('Invalid desktop port.'));
      return;
    }

    tryPort(startPort);
  });
}

async function waitForServer(url, port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await canConnect(port)) {
      const response = await fetch(`${url}/api/config`).catch(() => null);
      if (response?.ok) return;
    }
    await wait(500);
  }
  throw new Error(`Token Plan Arena did not start within ${Math.round(START_TIMEOUT_MS / 1000)} seconds.`);
}

async function canUseExistingServer(url, port) {
  if (!(await canConnect(port))) return false;
  const response = await fetch(`${url}/api/config`).catch(() => null);
  return Boolean(response?.ok);
}

async function findExistingArenaServer() {
  if (EXPLICIT_DESKTOP_URL) {
    const parsed = new URL(EXPLICIT_DESKTOP_URL);
    const port = Number.parseInt(parsed.port || '80', 10);
    if (await canUseExistingServer(EXPLICIT_DESKTOP_URL.replace(/\/$/, ''), port)) {
      return EXPLICIT_DESKTOP_URL.replace(/\/$/, '');
    }
  }

  const candidates = [DEFAULT_PORT, 3000, 3001, 3002]
    .filter((port, index, list) => Number.isFinite(port) && port > 0 && list.indexOf(port) === index);
  for (const port of candidates) {
    const url = `http://${HOST}:${port}`;
    if (await canUseExistingServer(url, port)) return url;
  }
  return null;
}

function startNextServer(port) {
  const production = isPackagedRun();
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = production
    ? ['run', 'start', '--', '--hostname', HOST, '--port', String(port)]
    : ['run', 'dev', '--', '--hostname', HOST, '--port', String(port)];

  serverProcess = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: HOST,
      BROWSER: 'none',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[arena-next] ${chunk}`);
  });
  serverProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[arena-next] ${chunk}`);
  });
  serverProcess.on('exit', (code, signal) => {
    if (code || signal) {
      process.stderr.write(`[arena-next] exited with code ${code ?? 'null'} signal ${signal ?? 'null'}\n`);
    }
    serverProcess = null;
  });

  return `http://${HOST}:${port}`;
}

function stopNextServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 1500).unref();
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#050506',
    title: 'Token Plan Arena',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    shell.openExternal(nextUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (SMOKE_MODE) {
      process.stdout.write('[arena-desktop-smoke] loaded\n');
      setTimeout(() => app.quit(), 300);
    }
  });

  await mainWindow.loadURL(url);
}

function installMenu() {
  const template = [
    {
      label: 'Token Plan Arena',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  installMenu();
  let url = !isPackagedRun() && REUSE_EXISTING_SERVER ? await findExistingArenaServer() : null;
  if (!url) {
    const port = await findFreePort(DEFAULT_PORT);
    url = `http://${HOST}:${port}`;
    startNextServer(port);
    await waitForServer(url, port);
  }
  await createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(url);
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopNextServer();
});
