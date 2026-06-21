import { prisma } from './db';
import { ensureModel, syncModelCatalog } from './models';
import { serializeRace, serializeWork, serializeWorkSummary } from './serializers';
import { DEFAULT_WORK_WINDOW_PERMISSION, isWorkWindowPermission } from '@/lib/workPermissions';
import { defaultRuntimeForProject, normalizeWorkWindowRuntime } from '@/lib/workRuntime';
import { DEFAULT_SELECTED_MODEL_SLUGS, TOKEN_PLAN_MODELS } from '@/lib/models';
import { WorkWindowPermission } from '@/types';
import { ensureWorkspaceBranch } from './workspaceBranches';

function compactTitle(value?: string | null) {
  const compact = (value || '').replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, 64) : '新的工作';
}

export function normalizeNullableText(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text || text === 'null' || text === 'undefined') return null;
  return text;
}

function defaultModelSlug() {
  return DEFAULT_SELECTED_MODEL_SLUGS.find((slug) =>
    TOKEN_PLAN_MODELS.some((model) => model.slug === slug && !model.capabilities.includes('image'))
  ) || 'qwen3.7-max';
}

export async function listWorks() {
  await syncModelCatalog();
  const works = await prisma.work.findMany({
    where: { status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    include: {
      windows: {
        where: { archived: false },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      _count: { select: { windows: true } },
    },
  });
  return works.map(serializeWorkSummary);
}

export async function getWork(id: string) {
  const work = await prisma.work.findUnique({
    where: { id },
    include: {
      windows: {
        where: { archived: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 80,
          },
          workspaceBranch: true,
          toolRuns: {
            orderBy: { startedAt: 'desc' },
            take: 8,
          },
        },
      },
    },
  });
  if (!work) throw new Error('找不到指定工作。');
  return serializeWork(work);
}

export async function createWork(params: {
  title?: string;
  goal?: string;
  projectPath?: string | null;
}) {
  await syncModelCatalog();
  const modelSlug = defaultModelSlug();
  await ensureModel(modelSlug);
  const projectPath = normalizeNullableText(params.projectPath) ?? null;
  const work = await prisma.work.create({
    data: {
      title: compactTitle(params.title || params.goal),
      goal: params.goal?.trim() || null,
      projectPath,
      windows: {
        create: {
          name: '窗口 A',
          modelSlug,
          runtimeKind: defaultRuntimeForProject(projectPath),
          permissionMode: DEFAULT_WORK_WINDOW_PERMISSION,
          sortOrder: 0,
        },
      },
    },
    include: {
      windows: {
        include: {
          messages: true,
          workspaceBranch: true,
          toolRuns: true,
        },
      },
    },
  });

  const window = work.windows[0];
  if (window) {
    await ensureWorkspaceBranch({
      workId: work.id,
      workWindowId: window.id,
      projectPath: work.projectPath,
    });
  }

  return getWork(work.id);
}

export async function updateWork(params: {
  id: string;
  title?: string;
  goal?: string | null;
  projectPath?: string | null;
  status?: string;
}) {
  const previous = await prisma.work.findUnique({
    where: { id: params.id },
    include: { windows: true },
  });
  if (!previous) throw new Error('找不到指定工作。');

  await prisma.work.update({
    where: { id: params.id },
    data: {
      ...(params.title !== undefined ? { title: compactTitle(params.title) } : {}),
      ...(params.goal !== undefined ? { goal: normalizeNullableText(params.goal) ?? null } : {}),
      ...(params.projectPath !== undefined ? { projectPath: normalizeNullableText(params.projectPath) ?? null } : {}),
      ...(params.status ? { status: params.status, archivedAt: params.status === 'archived' ? new Date() : null } : {}),
    },
  });

  const nextProjectPath = normalizeNullableText(params.projectPath) ?? null;
  if (params.projectPath !== undefined && nextProjectPath !== previous.projectPath) {
    if (nextProjectPath) {
      await prisma.workWindow.updateMany({
        where: {
          workId: params.id,
          archived: false,
          runtimeKind: 'token_plan',
        },
        data: { runtimeKind: defaultRuntimeForProject(nextProjectPath) },
      });
    } else {
      await prisma.workWindow.updateMany({
        where: {
          workId: params.id,
          archived: false,
          runtimeKind: 'codex_cli',
        },
        data: { runtimeKind: defaultRuntimeForProject(null) },
      });
    }

    await Promise.all(
      previous.windows.map((window) =>
        ensureWorkspaceBranch({
          workId: params.id,
          workWindowId: window.id,
          projectPath: nextProjectPath,
        })
      )
    );
  }

  return getWork(params.id);
}

export async function createWorkWindow(params: {
  workId: string;
  name?: string;
  modelSlug?: string;
  runtimeKind?: unknown;
  permissionMode?: unknown;
}) {
  const work = await prisma.work.findUnique({
    where: { id: params.workId },
    include: { _count: { select: { windows: true } } },
  });
  if (!work) throw new Error('找不到指定工作。');

  const modelSlug = params.modelSlug || defaultModelSlug();
  const model = await ensureModel(modelSlug);
  if (model.capabilities.includes('image')) {
    throw new Error('图片模型不能作为工作窗口对话模型。');
  }

  const permissionMode: WorkWindowPermission = isWorkWindowPermission(params.permissionMode)
    ? params.permissionMode
    : DEFAULT_WORK_WINDOW_PERMISSION;
  const runtimeKind = normalizeWorkWindowRuntime(params.runtimeKind, work.projectPath);
  const sortOrder = work._count.windows;
  const window = await prisma.workWindow.create({
    data: {
      workId: params.workId,
      modelSlug,
      runtimeKind,
      name: params.name?.trim() || `窗口 ${String.fromCharCode(65 + Math.min(sortOrder, 25))}`,
      permissionMode,
      sortOrder,
    },
  });

  await ensureWorkspaceBranch({
    workId: params.workId,
    workWindowId: window.id,
    projectPath: work.projectPath,
  });

  return getWork(params.workId);
}

export async function updateWorkWindow(params: {
  id: string;
  name?: string;
  modelSlug?: string;
  runtimeKind?: unknown;
  systemPrompt?: string | null;
  clearMemory?: boolean;
  permissionMode?: unknown;
  archived?: boolean;
}) {
  const window = await prisma.workWindow.findUnique({
    where: { id: params.id },
    include: { work: true },
  });
  if (!window) throw new Error('找不到指定窗口。');

  if (params.modelSlug) {
    const model = await ensureModel(params.modelSlug);
    if (model.capabilities.includes('image')) {
      throw new Error('图片模型不能作为工作窗口对话模型。');
    }
  }

  await prisma.workWindow.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() || window.name } : {}),
      ...(params.modelSlug ? { modelSlug: params.modelSlug } : {}),
      ...(params.runtimeKind !== undefined
        ? { runtimeKind: normalizeWorkWindowRuntime(params.runtimeKind, window.work.projectPath) }
        : {}),
      ...(params.systemPrompt !== undefined ? { systemPrompt: normalizeNullableText(params.systemPrompt) ?? null } : {}),
      ...(params.clearMemory ? { memorySummary: null, memoryUpdatedAt: null } : {}),
      ...(params.permissionMode !== undefined && isWorkWindowPermission(params.permissionMode)
        ? { permissionMode: params.permissionMode }
        : {}),
      ...(params.archived !== undefined ? { archived: params.archived } : {}),
    },
  });

  return getWork(window.workId);
}

export async function createRace(params: {
  workId: string;
  prompt: string;
  windowIds: string[];
  maxParallelRequests: number;
}) {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error('缺少 prompt。');
  const windows = await prisma.workWindow.findMany({
    where: {
      workId: params.workId,
      id: { in: params.windowIds },
      archived: false,
    },
  });
  if (windows.length === 0) throw new Error('没有可参与竞态的窗口。');

  const race = await prisma.race.create({
    data: {
      workId: params.workId,
      prompt,
      status: 'running',
      maxParallelRequests: Math.max(4, params.maxParallelRequests || 4),
      participants: {
        create: windows.map((window) => ({
          workWindowId: window.id,
          modelSlug: window.modelSlug,
          status: 'queued',
        })),
      },
    },
    include: {
      participants: true,
    },
  });

  return serializeRace(race);
}

export async function getRace(id: string) {
  const race = await prisma.race.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!race) throw new Error('找不到指定竞态。');
  return serializeRace(race);
}
