import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { AppConfig } from '@/types';

export const DEFAULT_TOKEN_PLAN_BASE_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const LOCAL_CONFIG_DIR = path.join(process.cwd(), '.arena-local');
const LOCAL_CONFIG_PATH = path.join(LOCAL_CONFIG_DIR, 'config.json');

type LocalConfig = {
  aliyunTokenPlanApiKey?: string;
  aliyunTokenPlanBaseUrl?: string;
};

function readPositiveInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

let cachedLocalConfig: LocalConfig | null | undefined;

async function readLocalConfigFromDisk() {
  const raw = await readFile(LOCAL_CONFIG_PATH, 'utf8').catch(() => '');
  if (!raw) return {};
  const parsed = JSON.parse(raw) as LocalConfig;
  return {
    aliyunTokenPlanApiKey: typeof parsed.aliyunTokenPlanApiKey === 'string' ? parsed.aliyunTokenPlanApiKey : undefined,
    aliyunTokenPlanBaseUrl: typeof parsed.aliyunTokenPlanBaseUrl === 'string' ? parsed.aliyunTokenPlanBaseUrl : undefined,
  };
}

function readLocalConfigSyncFallback() {
  return cachedLocalConfig || {};
}

export async function getLocalConfig() {
  if (cachedLocalConfig !== undefined) return cachedLocalConfig || {};
  cachedLocalConfig = await readLocalConfigFromDisk();
  return cachedLocalConfig;
}

async function writeLocalConfig(nextConfig: LocalConfig) {
  const cleaned: LocalConfig = {};
  if (nextConfig.aliyunTokenPlanApiKey?.trim()) {
    cleaned.aliyunTokenPlanApiKey = nextConfig.aliyunTokenPlanApiKey.trim();
  }
  if (nextConfig.aliyunTokenPlanBaseUrl?.trim()) {
    cleaned.aliyunTokenPlanBaseUrl = nextConfig.aliyunTokenPlanBaseUrl.trim().replace(/\/$/, '');
  }

  cachedLocalConfig = cleaned;
  await mkdir(LOCAL_CONFIG_DIR, { recursive: true });
  await writeFile(LOCAL_CONFIG_PATH, `${JSON.stringify(cleaned, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function updateLocalTokenPlanConfig(params: {
  apiKey?: string;
  baseUrl?: string;
  clearApiKey?: boolean;
}) {
  const current = await getLocalConfig();
  const next: LocalConfig = { ...current };

  if (params.clearApiKey) {
    delete next.aliyunTokenPlanApiKey;
  } else if (typeof params.apiKey === 'string') {
    const trimmed = params.apiKey.trim();
    if (trimmed) next.aliyunTokenPlanApiKey = trimmed;
  }

  if (typeof params.baseUrl === 'string') {
    const trimmed = params.baseUrl.trim();
    next.aliyunTokenPlanBaseUrl = trimmed || DEFAULT_TOKEN_PLAN_BASE_URL;
  }

  await writeLocalConfig(next);
}

export async function clearLocalTokenPlanConfig() {
  cachedLocalConfig = {};
  await rm(LOCAL_CONFIG_PATH, { force: true }).catch(() => undefined);
}

export function getServerConfig(localConfig: LocalConfig = readLocalConfigSyncFallback()): AppConfig {
  const requestedParallel = readPositiveInt('MAX_PARALLEL_REQUESTS', 4);
  const hasLocalApiKey = Boolean(localConfig.aliyunTokenPlanApiKey);
  const hasEnvApiKey = Boolean(process.env.ALIYUN_TOKEN_PLAN_API_KEY);
  const baseUrl =
    localConfig.aliyunTokenPlanBaseUrl ||
    process.env.ALIYUN_TOKEN_PLAN_BASE_URL ||
    DEFAULT_TOKEN_PLAN_BASE_URL;

  return {
    hasApiKey: hasEnvApiKey || hasLocalApiKey,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    baseUrl,
    apiKeySource: hasLocalApiKey ? 'local' : hasEnvApiKey ? 'env' : 'missing',
    configPath: LOCAL_CONFIG_PATH,
    maxParallelRequests: Math.max(4, requestedParallel),
    maxSelectedModels: readPositiveInt('MAX_SELECTED_MODELS', 6),
    assetDir: process.env.ASSET_DIR || 'public/generated',
  };
}

export async function getServerConfigAsync(): Promise<AppConfig> {
  return getServerConfig(await getLocalConfig());
}

export async function requireApiKey() {
  const localConfig = await getLocalConfig();
  const apiKey = localConfig.aliyunTokenPlanApiKey || process.env.ALIYUN_TOKEN_PLAN_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 Token Plan API Key，请在页面左侧“本机配置”里填写，或在 .env.local 中配置 ALIYUN_TOKEN_PLAN_API_KEY。');
  }
  return apiKey;
}

export function getTokenPlanBaseUrl() {
  const localConfig = readLocalConfigSyncFallback();
  return (localConfig.aliyunTokenPlanBaseUrl || process.env.ALIYUN_TOKEN_PLAN_BASE_URL || DEFAULT_TOKEN_PLAN_BASE_URL).replace(/\/$/, '');
}

export async function getTokenPlanBaseUrlAsync() {
  const localConfig = await getLocalConfig();
  return (localConfig.aliyunTokenPlanBaseUrl || process.env.ALIYUN_TOKEN_PLAN_BASE_URL || DEFAULT_TOKEN_PLAN_BASE_URL).replace(/\/$/, '');
}

export function assertDatabaseConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error('缺少 DATABASE_URL，请先配置 PostgreSQL 连接字符串。');
  }
}
