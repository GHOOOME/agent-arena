import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { getServerConfig } from './config';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function publicUrlFromRelativePath(relativePath: string) {
  return `/${relativePath.replace(/^public\//, '').replace(/\\/g, '/')}`;
}

async function ensureDirectory(relativeDir: string) {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  return absoluteDir;
}

export async function saveDataUrlAsset(dataUrl: string, originalName: string, folder = 'public/uploads') {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('上传图片不是有效的 data URL。');
  }

  const mimeType = match[1];
  const ext = IMAGE_EXTENSIONS[mimeType] || 'bin';
  const filename = `${Date.now()}-${crypto.randomUUID()}-${cleanSegment(originalName || 'upload')}.${ext}`;
  const absoluteDir = await ensureDirectory(folder);
  const absolutePath = path.join(absoluteDir, filename);
  const relativePath = path.join(folder, filename).replace(/\\/g, '/');

  await writeFile(absolutePath, Buffer.from(match[2], 'base64'));

  return {
    localPath: relativePath,
    publicUrl: publicUrlFromRelativePath(relativePath),
    metadata: { mimeType, originalName },
  };
}

export async function downloadRemoteAsset(remoteUrl: string, folder = getServerConfig().assetDir) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`下载生成图片失败：HTTP ${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  const extFromMime = IMAGE_EXTENSIONS[mimeType];
  const extFromUrl = new URL(remoteUrl).pathname.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '');
  const ext = extFromMime || extFromUrl || 'png';
  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const absoluteDir = await ensureDirectory(folder);
  const absolutePath = path.join(absoluteDir, filename);
  const relativePath = path.join(folder, filename).replace(/\\/g, '/');

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(absolutePath, bytes);

  return {
    localPath: relativePath,
    publicUrl: publicUrlFromRelativePath(relativePath),
    metadata: { mimeType, bytes: bytes.length },
  };
}

export function findImageUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//.test(node) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(node)) {
        urls.add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return [...urls];
}
