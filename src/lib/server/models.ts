import { prisma } from './db';
import { TOKEN_PLAN_MODELS } from '@/lib/models';
import { ModelConfig } from '@/types';

export async function syncModelCatalog() {
  await Promise.all(
    TOKEN_PLAN_MODELS.map((model) =>
      prisma.model.upsert({
        where: { slug: model.slug },
        update: {
          name: model.name,
          provider: model.provider,
          family: model.family,
          color: model.color,
          description: model.description,
          bestFor: model.bestFor,
          capabilities: model.capabilities,
          tools: model.tools,
          isActive: model.isActive,
        },
        create: {
          slug: model.slug,
          name: model.name,
          provider: model.provider,
          family: model.family,
          color: model.color,
          description: model.description,
          bestFor: model.bestFor,
          capabilities: model.capabilities,
          tools: model.tools,
          isActive: model.isActive,
        },
      })
    )
  );
}

export async function getModels(): Promise<ModelConfig[]> {
  await syncModelCatalog();
  const models = await prisma.model.findMany({
    where: { isActive: true },
    orderBy: [{ provider: 'asc' }, { slug: 'asc' }],
  });

  return models.map((model) => ({
    id: model.slug,
    slug: model.slug,
    name: model.name,
    provider: model.provider,
    family: model.family,
    color: model.color,
    description: model.description,
    bestFor: model.bestFor,
    capabilities: model.capabilities as ModelConfig['capabilities'],
    tools: model.tools as ModelConfig['tools'],
    isActive: model.isActive,
  }));
}

export async function ensureModel(slug: string) {
  await syncModelCatalog();
  const model = await prisma.model.findUnique({ where: { slug } });
  if (!model) {
    throw new Error(`Token Plan 模型 ${slug} 不在当前 allowlist 中。`);
  }
  return model;
}
