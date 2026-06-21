import { execFile } from 'child_process';
import { stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { jsonError } from '@/lib/server/http';
import { normalizeProjectPath, toRelativeProjectPath, USER_HOME } from '@/lib/server/projectContext';

export const runtime = 'nodejs';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

function isCancelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /user canceled|用户已取消|cancel/i.test(message);
}

export async function POST() {
  try {
    if (process.platform !== 'darwin') {
      return jsonError('当前自动选择文件夹功能只支持 macOS。本机网页仍可使用项目列表里的路径。', 400);
    }

    const script = [
      'set selectedFolder to choose folder with prompt "选择要交给 Token Plan Arena 的项目文件夹"',
      'POSIX path of selectedFolder',
    ].join('\n');

    let stdout = '';
    try {
      const result = await execFileAsync('osascript', ['-e', script], {
        cwd: USER_HOME,
        timeout: 300_000,
        maxBuffer: 1024 * 64,
      });
      stdout = result.stdout;
    } catch (error) {
      if (isCancelError(error)) {
        return Response.json({ cancelled: true });
      }
      throw error;
    }

    const pickedPath = stdout.trim().replace(/\/+$/, '');
    const absoluteProjectPath = normalizeProjectPath(pickedPath);
    const rootStats = await stat(absoluteProjectPath);
    if (!rootStats.isDirectory()) {
      return jsonError('请选择一个项目文件夹。', 400);
    }

    return Response.json({
      cancelled: false,
      projectPath: toRelativeProjectPath(absoluteProjectPath),
      absoluteProjectPath,
      name: path.basename(absoluteProjectPath),
    });
  } catch (error) {
    return jsonError(error);
  }
}
