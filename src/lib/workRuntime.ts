import { WorkWindowRuntimeKind } from '@/types';

export const DEFAULT_WORK_WINDOW_RUNTIME: WorkWindowRuntimeKind = 'codex_cli';
export const FALLBACK_WORK_WINDOW_RUNTIME: WorkWindowRuntimeKind = 'token_plan';

export function defaultRuntimeForProject(projectPath?: string | null): WorkWindowRuntimeKind {
  return projectPath?.trim() ? DEFAULT_WORK_WINDOW_RUNTIME : FALLBACK_WORK_WINDOW_RUNTIME;
}

export function normalizeWorkWindowRuntime(value: unknown, projectPath?: string | null): WorkWindowRuntimeKind {
  const hasProject = Boolean(projectPath?.trim());
  if (value === 'token_plan') return 'token_plan';
  if (value === 'codex_cli') return hasProject ? 'codex_cli' : FALLBACK_WORK_WINDOW_RUNTIME;
  return defaultRuntimeForProject(projectPath);
}
