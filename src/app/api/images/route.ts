import { prisma } from '@/lib/server/db';
import { assertDatabaseConfigured } from '@/lib/server/config';
import { createImageGeneration } from '@/lib/server/aliyun';
import { downloadRemoteAsset, findImageUrls } from '@/lib/server/assets';
import { appendAssistantMessage, appendUserMessage, ensureConversation } from '@/lib/server/conversations';
import { jsonError } from '@/lib/server/http';
import { ensureModel } from '@/lib/server/models';
import { serializeAsset } from '@/lib/server/serializers';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 2;

async function requestImageWithRetry(params: {
  modelSlug: string;
  prompt: string;
  negativePrompt?: string;
  size: string;
  count: number;
  promptExtend: boolean;
  watermark: boolean;
}) {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    response = await createImageGeneration({
      model: params.modelSlug,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      size: params.size,
      count: params.count,
      promptExtend: params.promptExtend,
      watermark: params.watermark,
    });

    if (response.status !== 429) {
      return response;
    }

    if (attempt < MAX_RATE_LIMIT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    }
  }

  return response;
}

export async function POST(req: Request) {
  try {
    assertDatabaseConfigured();
    const body = await req.json();
    const modelSlug = String(body.modelSlug || '');
    const prompt = String(body.prompt || '').trim();
    const negativePrompt = body.negativePrompt ? String(body.negativePrompt) : '';
    const size = String(body.size || '2048*2048');
    const count = Math.min(Math.max(Number.parseInt(String(body.count || '1'), 10), 1), 4);
    const promptExtend = body.promptExtend !== false;
    const watermark = Boolean(body.watermark);
    const conversationId = body.conversationId ? String(body.conversationId) : undefined;

    if (!modelSlug || !prompt) {
      return jsonError('缺少 modelSlug 或 prompt。', 400);
    }

    const model = await ensureModel(modelSlug);
    if (!model.capabilities.includes('image')) {
      return jsonError(`${model.name} 不是图片生成模型。`, 400);
    }

    const conversation = await ensureConversation(modelSlug, conversationId, prompt);
    await appendUserMessage(conversation.id, prompt, null);
    const run = await prisma.run.create({ data: { prompt } });
    const runResult = await prisma.runResult.create({
      data: {
        runId: run.id,
        conversationId: conversation.id,
        modelSlug,
        status: 'running',
      },
    });
    const startedAt = Date.now();

    const response = await requestImageWithRetry({
      modelSlug,
      prompt,
      negativePrompt,
      size,
      count,
      promptExtend,
      watermark,
    });

    if (!response || !response.ok) {
      const errorText = await response?.text().catch(() => '') || 'Token Plan 图片接口没有返回响应。';
      throw new Error(`HTTP ${response?.status || 'unknown'}: ${errorText}`);
    }

    const raw = await response.json();
    const imageUrls = findImageUrls(raw).slice(0, count);

    if (imageUrls.length === 0) {
      throw new Error('图片接口返回成功，但没有解析到图片 URL。');
    }

    const assets = await Promise.all(
      imageUrls.map(async (remoteUrl) => {
        const saved = await downloadRemoteAsset(remoteUrl);
        return prisma.asset.create({
          data: {
            type: 'generated',
            modelSlug,
            conversationId: conversation.id,
            runResultId: runResult.id,
            remoteUrl,
            localPath: saved.localPath,
            publicUrl: saved.publicUrl,
            prompt,
            metadata: {
              ...saved.metadata,
              size,
              count,
              promptExtend,
              watermark,
              negativePrompt,
              raw,
            },
          },
        });
      })
    );

    const content = `已生成 ${assets.length} 张图片。`;
    await appendAssistantMessage(conversation.id, content, undefined, raw.usage);
    await prisma.runResult.update({
      where: { id: runResult.id },
      data: {
        status: 'completed',
        content,
        usage: raw.usage || undefined,
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return Response.json({
      conversationId: conversation.id,
      runId: run.id,
      runResultId: runResult.id,
      assets: assets.map(serializeAsset),
      raw,
    });
  } catch (error) {
    return jsonError(error);
  }
}
