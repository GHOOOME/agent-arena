'use client';
import { useEffect, useState } from 'react';
import { Bot, Code2, FolderOpen, Hand, Loader2, Power, RefreshCw, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useArenaStore } from '@/stores/useArenaStore';
import { DEFAULT_PROJECT_AGENT_PERMISSION, PROJECT_AGENT_PERMISSION_COPY } from '@/lib/agentPermissions';
import { ProjectAgentPermission } from '@/types';
import Tooltip from './Tooltip';
import CollapsibleSection from './CollapsibleSection';
import ArenaSelect from './ui/ArenaSelect';

type ProjectEntry = {
  name: string;
  path: string;
  hasProjectMarker: boolean;
};

export default function ProjectContextPanel() {
  const projectContext = useArenaStore((s) => s.projectContext);
  const setProjectContext = useArenaStore((s) => s.setProjectContext);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectPath, setProjectPath] = useState(projectContext?.projectPath || '');
  const [enabled, setEnabled] = useState(projectContext?.mode === 'agent');
  const [permissionMode, setPermissionMode] = useState<ProjectAgentPermission>(
    projectContext?.permissionMode || DEFAULT_PROJECT_AGENT_PERMISSION
  );
  const [readableFileCount, setReadableFileCount] = useState<number | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permissionCopy = PROJECT_AGENT_PERMISSION_COPY[permissionMode];
  const projectOptions = [
    { value: '', label: '选择项目' },
    ...projects.map((project) => ({
      value: project.path,
      label: `${project.hasProjectMarker ? '* ' : ''}${project.name}`,
      description: project.path,
    })),
    ...(projectPath && !projects.some((project) => project.path === projectPath)
      ? [{
          value: projectPath,
          label: `${projectPath.split('/').filter(Boolean).pop() || projectPath}（刚选择）`,
          description: projectPath,
        }]
      : []),
  ];

  function applyContext(nextEnabled: boolean, nextPath = projectPath, nextPermissionMode = permissionMode) {
    const trimmedPath = nextPath.trim();
    if (nextEnabled && trimmedPath) {
      setProjectContext({
        projectPath: trimmedPath,
        files: [],
        mode: 'agent',
        writeEnabled: true,
        permissionMode: nextPermissionMode,
      });
    } else {
      setProjectContext(null);
    }
  }

  async function loadProjects() {
    setLoadingProjects(true);
    setError(null);
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取项目列表失败');
      const nextProjects = data.projects || [];
      setProjects(nextProjects);
      if (!projectPath && nextProjects[0]) {
        setProjectPath(nextProjects[0].path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProjects(false);
    }
  }

  function toggleEnabled() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    if (!nextEnabled) {
      applyContext(false);
      return;
    }
    applyContext(nextEnabled);
  }

  function updatePermissionMode(nextPermissionMode: ProjectAgentPermission) {
    setPermissionMode(nextPermissionMode);
    applyContext(enabled, projectPath, nextPermissionMode);
  }

  function updateProjectPath(nextPath: string) {
    setProjectPath(nextPath);
    setReadableFileCount(null);
    applyContext(enabled, nextPath);
  }

  async function pickProjectFolder() {
    setPickingFolder(true);
    setError(null);
    try {
      const response = await fetch('/api/projects/pick-folder', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '选择文件夹失败');
      if (data.cancelled) return;
      if (!data.projectPath) throw new Error('没有选择到可用的项目文件夹。');
      setEnabled(true);
      updateProjectPath(data.projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingFolder(false);
    }
  }

  async function scan(pathToScan = projectPath) {
    if (!enabled || !pathToScan.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const response = await fetch('/api/projects/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: pathToScan.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '扫描项目失败');
      setProjectPath(data.projectPath);
      setReadableFileCount(Array.isArray(data.files) ? data.files.length : 0);
      applyContext(true, data.projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CollapsibleSection
      title="项目上下文"
      summary={`${enabled ? '自动读项目开' : '自动读项目关'}${enabled ? ` · ${permissionCopy.shortLabel}` : ''} · ${enabled && projectPath ? projectPath : '未启用'}`}
      defaultOpen
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[var(--arena-ink)]">
            <Code2 size={18} />
            <h2 className="text-sm font-semibold">项目上下文</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--arena-dim)]">自动扫描所选项目，忽略密钥、大文件和构建产物</p>
        </div>
        <Tooltip label="刷新常用项目列表" side="left" className="ml-auto">
          <button
            onClick={loadProjects}
            className="arena-icon-button p-1.5"
          >
            {loadingProjects ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </Tooltip>
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--arena-line)] bg-[var(--arena-field)] p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Tooltip label={enabled ? '关闭项目 Agent，不再附带项目上下文' : '开启项目 Agent，让模型自动读取当前项目相关文件'} side="top" align="start">
          <button
            onClick={toggleEnabled}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm transition-colors sm:justify-start ${
              enabled
                ? 'arena-chip-active'
                : 'arena-button-secondary'
            }`}
          >
            <Power size={15} />
            {enabled ? '自动读项目已开启' : '开启自动读项目'}
          </button>
        </Tooltip>
        <div className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-5 text-[var(--arena-dim)]">
          <Bot size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{enabled ? '发送问题时，本地 Agent 会按问题自动挑文件；代码改动会按权限档位处理。' : '关闭时，对话只使用模型自己的会话历史。'}</span>
        </div>
      </div>

      {enabled && (
        <>
          <div className="mt-3 rounded-lg border border-[var(--arena-line)] bg-[var(--arena-field)] p-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--arena-ink)]">Agent 权限</div>
                <p className="mt-1 text-xs leading-5 text-[var(--arena-dim)]">控制模型提出代码修改、联网工具和风险操作时的确认强度。</p>
              </div>
              <span className="arena-chip-active shrink-0 px-2 py-1 text-[11px]">{permissionCopy.shortLabel}</span>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {([
                ['request_approval', Hand],
                ['auto_approve_safe', ShieldAlert],
                ['full_access', Shield],
              ] as const).map(([mode, Icon]) => {
                const selected = permissionMode === mode;
                const copy = PROJECT_AGENT_PERMISSION_COPY[mode];
                return (
                  <Tooltip key={mode} label={copy.description} side="top" align="start">
                    <button
                      onClick={() => updatePermissionMode(mode)}
                      className={`flex min-h-24 w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-[var(--arena-accent-line)] bg-[var(--arena-accent-soft)] text-[var(--arena-accent-readable)]'
                          : 'border-[var(--arena-line)] bg-[rgba(10,14,22,0.68)] text-[var(--arena-muted)] hover:border-[var(--arena-line-strong)] hover:text-[var(--arena-ink)]'
                      }`}
                      aria-pressed={selected}
                    >
                      <Icon size={18} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {copy.title}
                          {selected && <ShieldCheck size={14} className="text-[var(--arena-accent-readable)]" />}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--arena-muted)]">{copy.description}</span>
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--arena-dim)]">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--arena-accent-readable)]" />
              <span>当前版本始终限制在所选项目内，只支持创建文件和精确片段替换，不执行命令，不碰密钥、锁文件、依赖目录或二进制文件。</span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[220px_1fr_auto]">
            <button
              type="button"
              onClick={() => void pickProjectFolder()}
              disabled={pickingFolder}
              className="arena-button-secondary inline-flex h-10 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
            >
              {pickingFolder ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
              {pickingFolder ? '选择中' : '选择文件夹'}
            </button>
            <ArenaSelect
              value={projectPath}
              onChange={updateProjectPath}
              options={projectOptions}
              ariaLabel="项目上下文项目选择"
              className="h-10 w-full px-3 text-sm"
            />
            <input
              value={projectPath}
              onChange={(event) => updateProjectPath(event.target.value)}
              placeholder="也可以粘贴本机项目路径，例如 /Users/mac/Desktop/demo"
              className="arena-input h-10 px-3 text-sm"
            />
          </div>

          <div className="mt-2 flex justify-end">
            <Tooltip label="预览这个项目中可安全读取的文件数量" side="top" align="end" className="h-10">
              <button
                onClick={() => scan()}
                disabled={!projectPath.trim() || scanning}
                className="arena-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {scanning ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                预览
              </button>
            </Tooltip>
          </div>

          {projectPath.trim() && (
            <div className="arena-chip-active mt-2 rounded-lg px-3 py-2 text-xs leading-5">
              已开启自动读项目：{projectPath}
              {readableFileCount !== null ? ` · 当前可安全读取 ${readableFileCount} 个文件` : ''}
              {` · 权限：${permissionCopy.title}`}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
    </CollapsibleSection>
  );
}
