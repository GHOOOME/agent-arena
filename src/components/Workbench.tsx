'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Database,
  FilePlus2,
  FolderKanban,
  FolderOpen,
  GitBranch,
  History,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import ApprovalInbox from './ApprovalInbox';
import DataFlowCanvas from './DataFlowCanvas';
import Tooltip from './Tooltip';
import WorkbenchWindowCard from './WorkbenchWindowCard';
import ArenaConfirmDialog from './ui/ArenaConfirmDialog';
import ArenaSelect from './ui/ArenaSelect';
import { useImeEnterSubmit } from '@/hooks/useImeEnterSubmit';
import { useWindowChat } from '@/hooks/useWindowChat';
import { useWorkbenchStore } from '@/stores/useWorkbenchStore';
import { WorkRecord, WorkSummary } from '@/types';
import { DEFAULT_WORK_WINDOW_PERMISSION } from '@/lib/workPermissions';
import { defaultRuntimeForProject } from '@/lib/workRuntime';

type ProjectEntry = {
  name: string;
  path: string;
  hasProjectMarker: boolean;
};

type PendingConfirm = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  run: () => Promise<void>;
};

type WorkStartMode = 'new_project' | 'existing_project' | 'remote_project' | 'chat_only';

type ProjectOnboardingResponse = {
  projectPath: string | null;
  mode: WorkStartMode;
  safety: {
    status: string;
    title: string;
    message: string;
    details: string[];
  };
};

type PickFolderResponse = {
  cancelled?: boolean;
  projectPath?: string;
  absoluteProjectPath?: string;
  name?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${response.status}`);
  }
  return data as T;
}

export default function Workbench() {
  const {
    config,
    configError,
    databaseReady,
    models,
    works,
    activeWork,
    activeWorkId,
    selectedWindowIds,
    streams,
    isStreaming,
    setConfig,
    setConfigError,
    setModels,
    setWorks,
    setActiveWork,
    setActiveWorkId,
    toggleWindowSelection,
    setSelectedWindowIds,
  } = useWorkbenchStore();
  const { sendToWindow, sendRace, abortWindow, abortAll } = useWindowChat();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [racePrompt, setRacePrompt] = useState('');
  const [newWorkTitle, setNewWorkTitle] = useState('');
  const [newWorkProjectPath, setNewWorkProjectPath] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [remoteProjectUrl, setRemoteProjectUrl] = useState('');
  const [workStartMode, setWorkStartMode] = useState<WorkStartMode>('new_project');
  const [addWindowModel, setAddWindowModel] = useState('qwen3.7-max');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [savingWork, setSavingWork] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [addWindowRuntime, setAddWindowRuntime] = useState('codex_cli');
  const [newWorkOpen, setNewWorkOpen] = useState(false);
  const [workSettingsOpen, setWorkSettingsOpen] = useState(false);
  const [addWindowOpen, setAddWindowOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [localConfigOpen, setLocalConfigOpen] = useState(false);
  const [localApiKey, setLocalApiKey] = useState('');
  const [localBaseUrl, setLocalBaseUrl] = useState('');
  const [savingLocalConfig, setSavingLocalConfig] = useState(false);

  const textModels = useMemo(() => models.filter((model) => !model.capabilities.includes('image')), [models]);
  const projectOptions = useMemo(() => {
    const options = [
      { value: '', label: '不绑定项目' },
      ...projects.map((project) => ({
        value: project.path,
        label: `${project.hasProjectMarker ? '* ' : ''}${project.name}`,
        description: project.path,
      })),
    ];
    if (activeWork?.projectPath && !options.some((option) => option.value === activeWork.projectPath)) {
      const name = activeWork.projectPath.split('/').filter(Boolean).pop() || activeWork.projectPath;
      options.push({
        value: activeWork.projectPath,
        label: `${name}（已绑定）`,
        description: activeWork.projectPath,
      });
    }
    return options;
  }, [activeWork?.projectPath, projects]);
  const existingProjectOptions = useMemo(() => {
    const options = projects.map((project) => ({
      value: project.path,
      label: `${project.hasProjectMarker ? '* ' : ''}${project.name}`,
      description: project.path,
    }));
    if (newWorkProjectPath && !options.some((option) => option.value === newWorkProjectPath)) {
      const name = newWorkProjectPath.split('/').filter(Boolean).pop() || newWorkProjectPath;
      options.unshift({
        value: newWorkProjectPath,
        label: `${name}（刚选择）`,
        description: newWorkProjectPath,
      });
    }
    return options;
  }, [newWorkProjectPath, projects]);
  const startModeOptions = useMemo(() => [
    {
      value: 'new_project' as const,
      label: '新建项目',
      icon: FilePlus2,
      description: '自动创建文件夹和安全快照。',
    },
    {
      value: 'existing_project' as const,
      label: '打开文件夹',
      icon: FolderOpen,
      description: '选择电脑里的项目，系统自动准备。',
    },
    {
      value: 'remote_project' as const,
      label: '从链接导入',
      icon: Link2,
      description: '从 https Git 链接下载到本地。',
    },
    {
      value: 'chat_only' as const,
      label: '只聊天',
      icon: MessageSquare,
      description: '不读写代码，只对话和对比。',
    },
  ], []);
  const textModelOptions = useMemo(() => textModels.map((model) => ({
    value: model.slug,
    label: model.name,
    description: `${model.provider} · ${model.bestFor.slice(0, 2).join(' / ')}`,
  })), [textModels]);
  const runtimeOptions = useMemo(() => [
    {
      value: 'codex_cli',
      label: 'Codex CLI Runtime',
      description: activeWork?.projectPath
        ? '隔离 CODEX_HOME 调用 Codex CLI，模型请求仍走 Token Plan。'
        : '需要先绑定项目，纯对话工作不可用。',
      disabled: !activeWork?.projectPath,
    },
    {
      value: 'token_plan',
      label: 'Token Plan Agent',
      description: '使用内置 Arena 工具循环，消耗阿里云 Token Plan。',
    },
  ], [activeWork?.projectPath]);
  const selectedWindows = activeWork?.windows.filter((window) => selectedWindowIds.includes(window.id)) || [];
  const canRace = Boolean(activeWork && racePrompt.trim() && selectedWindows.length > 0 && !isStreaming);
  const canCreateWork = Boolean(
    workStartMode === 'chat_only' ||
    workStartMode === 'new_project' ||
    (workStartMode === 'existing_project' && newWorkProjectPath.trim()) ||
    (workStartMode === 'remote_project' && remoteProjectUrl.trim())
  );

  const loadWork = useCallback(async (id: string) => {
    const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/works/${id}`));
    setActiveWork(data.work);
    return data.work;
  }, [setActiveWork]);

  const loadWorks = useCallback(async (preferredWorkId?: string) => {
    const data = await readJson<{ works: WorkSummary[] }>(await fetch('/api/works'));
    setWorks(data.works || []);
    const nextId = preferredWorkId || activeWorkId || data.works?.[0]?.id;
    if (nextId) {
      await loadWork(nextId);
    } else {
      const created = await readJson<{ work: WorkRecord }>(await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '默认工作', projectPath: 'llm-arena' }),
      }));
      await loadWorks(created.work.id);
    }
  }, [activeWorkId, loadWork, setWorks]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const [configResponse, modelsResponse, projectsResponse] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/models'),
        fetch('/api/projects'),
      ]);
      const configData = await readJson<typeof config>(configResponse);
      const modelData = await readJson<{ models: typeof models; databaseReady: boolean }>(modelsResponse);
      const projectData = await readJson<{ projects: ProjectEntry[] }>(projectsResponse);
      if (configData) setConfig(configData);
      setModels(modelData.models || [], modelData.databaseReady);
      setProjects(projectData.projects || []);
      if (configData?.hasDatabaseUrl) {
        await loadWorks();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfigError(message);
      setActionError(message);
    } finally {
      setLoading(false);
    }
  }, [loadWorks, setConfig, setConfigError, setModels]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setAddWindowRuntime(defaultRuntimeForProject(activeWork?.projectPath));
  }, [activeWork?.id, activeWork?.projectPath]);

  useEffect(() => {
    if (config) {
      setLocalBaseUrl(config.baseUrl || '');
      if (!config.hasApiKey) setLocalConfigOpen(true);
    }
  }, [config]);

  async function onboardProjectForWork(title: string) {
    if (workStartMode === 'chat_only') {
      return readJson<ProjectOnboardingResponse>(await fetch('/api/projects/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat_only' }),
      }));
    }

    if (workStartMode === 'new_project') {
      return readJson<ProjectOnboardingResponse>(await fetch('/api/projects/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'new_project',
          projectName: newProjectName.trim() || title,
        }),
      }));
    }

    if (workStartMode === 'existing_project') {
      return readJson<ProjectOnboardingResponse>(await fetch('/api/projects/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'existing_project',
          projectPath: newWorkProjectPath,
        }),
      }));
    }

    return readJson<ProjectOnboardingResponse>(await fetch('/api/projects/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'remote_project',
        remoteUrl: remoteProjectUrl.trim(),
        projectName: newProjectName.trim() || title,
      }),
    }));
  }

  async function createWork() {
    const title = newWorkTitle.trim() || '新的工作';
    setSavingWork(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const onboarded = await onboardProjectForWork(title);
      const data = await readJson<{ work: WorkRecord }>(await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          projectPath: onboarded.projectPath,
        }),
      }));
      setNewWorkTitle('');
      setNewProjectName('');
      setRemoteProjectUrl('');
      setNewWorkProjectPath('');
      setActionNotice(`${onboarded.safety.title}：${onboarded.safety.message}`);
      setNewWorkOpen(false);
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingWork(false);
    }
  }

  async function saveLocalConfig(clearApiKey = false) {
    setSavingLocalConfig(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const nextConfig = await readJson<typeof config>(await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: clearApiKey ? undefined : localApiKey,
          baseUrl: localBaseUrl,
          clearApiKey,
        }),
      }));
      if (nextConfig) setConfig(nextConfig);
      setLocalApiKey('');
      setActionNotice(clearApiKey ? '已清除页面保存的 Token Plan Key。' : 'Token Plan 本机配置已保存。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLocalConfig(false);
    }
  }

  async function patchWork(patch: { title?: string; goal?: string | null; projectPath?: string | null; status?: string }) {
    if (!activeWork) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/works/${activeWork.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }));
      setActiveWork(data.work);
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function bindProjectToActiveWork(projectPath: string | null) {
    if (!activeWork) return;
    if (!projectPath) {
      await patchWork({ projectPath: null });
      setActionNotice('已切换为纯对话工作，本地开发能力会暂停。');
      return;
    }

    setActionError(null);
    setActionNotice(null);
    try {
      const onboarded = await readJson<ProjectOnboardingResponse>(await fetch('/api/projects/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'existing_project',
          projectPath,
        }),
      }));
      await patchWork({ projectPath: onboarded.projectPath });
      setActionNotice(`${onboarded.safety.title}：${onboarded.safety.message}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function pickProjectFolder(options?: { bindToActiveWork?: boolean }) {
    setPickingFolder(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const picked = await readJson<PickFolderResponse>(await fetch('/api/projects/pick-folder', {
        method: 'POST',
      }));
      if (picked.cancelled) return;
      if (!picked.projectPath) throw new Error('没有选择到可用的项目文件夹。');

      if (options?.bindToActiveWork) {
        await bindProjectToActiveWork(picked.projectPath);
      } else {
        setWorkStartMode('existing_project');
        setNewWorkProjectPath(picked.projectPath);
        setActionNotice(`已选择文件夹：${picked.absoluteProjectPath || picked.projectPath}`);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPickingFolder(false);
    }
  }

  async function createWindow() {
    if (!activeWork) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/works/${activeWork.id}/windows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSlug: addWindowModel,
          runtimeKind: activeWork.projectPath ? addWindowRuntime : 'token_plan',
          permissionMode: DEFAULT_WORK_WINDOW_PERMISSION,
        }),
      }));
      setActiveWork(data.work);
      setSelectedWindowIds(data.work.windows.map((window) => window.id).slice(0, Math.min(4, data.work.windows.length)));
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateWindow(windowId: string, patch: {
    name?: string;
    modelSlug?: string;
    runtimeKind?: string;
    systemPrompt?: string;
    clearMemory?: boolean;
    permissionMode?: string;
    archived?: boolean;
  }) {
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/windows/${windowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }));
      setActiveWork(data.work);
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function runWindowTool(windowId: string, toolName: string, input?: unknown) {
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/windows/${windowId}/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, input }),
      }));
      setActiveWork(data.work);
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function decideToolRun(windowId: string, toolRunId: string, decision: 'approve' | 'reject') {
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/windows/${windowId}/tools/${toolRunId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }));
      setActiveWork(data.work);
      setActionNotice(decision === 'approve' ? '已批准并执行命令。' : '已拒绝执行命令。');
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function markWinner(windowId: string) {
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/windows/${windowId}/winner`, {
        method: 'POST',
      }));
      setActiveWork(data.work);
      setActionNotice('已标记当前 winner。');
      await loadWorks(data.work.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewMerge(windowId: string) {
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await readJson<{ changes: Array<{ path: string; status: string }> }>(await fetch(`/api/windows/${windowId}/merge`));
      const sample = data.changes.slice(0, 5).map((item) => `${item.status}:${item.path}`).join('，');
      setActionNotice(data.changes.length > 0
        ? `合并预览：${data.changes.length} 个差异。${sample}${data.changes.length > 5 ? '，...' : ''}`
        : '合并预览：没有发现差异。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function applyMerge(windowId: string) {
    setActionError(null);
    setActionNotice(null);
    const targetWindow = activeWork?.windows.find((item) => item.id === windowId);
    setPendingConfirm({
      title: '应用窗口改动',
      description: `将 ${targetWindow?.name || '这个窗口'} 的安全文件改动写回原项目。删除文件不会自动执行，copy fallback 工作区只会合并 Agent 补丁追踪到的文件。`,
      confirmLabel: '应用合并',
      tone: 'danger',
      run: async () => {
        const data = await readJson<{ work: WorkRecord; applied: Array<{ path: string }>; skipped: Array<{ path: string }> }>(await fetch(`/api/windows/${windowId}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }));
        setActiveWork(data.work);
        setActionNotice(`已应用 ${data.applied.length} 个文件${data.skipped.length ? `，跳过 ${data.skipped.length} 个删除项` : ''}。`);
        await loadWorks(data.work.id);
      },
    });
  }

  async function archiveSelectedWindows() {
    if (!activeWork || selectedWindowIds.length === 0) return;
    const selectedCount = selectedWindowIds.length;
    setPendingConfirm({
      title: '归档选中窗口',
      description: `将当前选中的 ${selectedCount} 个窗口从工作台中归档。窗口历史仍保存在数据库里，只是不再显示在当前工作中。`,
      confirmLabel: '归档窗口',
      tone: 'danger',
      run: async () => {
        let nextWork: WorkRecord | null = null;
        for (const windowId of selectedWindowIds) {
          const data = await readJson<{ work: WorkRecord }>(await fetch(`/api/windows/${windowId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: true }),
          }));
          nextWork = data.work;
        }
        if (nextWork) {
          setActiveWork(nextWork);
          setSelectedWindowIds([]);
          setActionNotice(`已归档 ${selectedCount} 个窗口。`);
          await loadWorks(nextWork.id);
        }
      },
    });
  }

  async function confirmPendingAction() {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await pendingConfirm.run();
      setPendingConfirm(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleMergeApplied(work: WorkRecord, message: string) {
    setActiveWork(work);
    setActionNotice(message);
    setActionError(null);
    await loadWorks(work.id);
  }

  async function submitRace() {
    if (!activeWork || !canRace) return;
    const prompt = racePrompt.trim();
    setRacePrompt('');
    setActionError(null);
    try {
      await sendRace({
        workId: activeWork.id,
        prompt,
        windowIds: selectedWindowIds,
        maxParallelRequests: config?.maxParallelRequests || 4,
      });
      await loadWork(activeWork.id);
      await loadWorks(activeWork.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitWindowPrompt(windowId: string, prompt: string) {
    if (!activeWork) return;
    setActionError(null);
    await sendToWindow({ workWindowId: windowId, prompt });
    await loadWork(activeWork.id);
    await loadWorks(activeWork.id);
  }

  const raceIme = useImeEnterSubmit(() => void submitRace(), canRace);

  return (
    <main className="arena-screen relative min-h-screen">
      <DataFlowCanvas />
      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1800px] gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="arena-work-sidebar border-b border-[var(--arena-line)] p-4 lg:min-h-screen lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="arena-brand-mark grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black">A</span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold text-[var(--arena-ink)]">Token Plan Arena</h1>
                <p className="text-xs text-[var(--arena-dim)]">Work / Window / Race</p>
              </div>
            </div>
            <Tooltip label="刷新工作台" side="right">
              <button
                onClick={() => void bootstrap()}
                className="arena-icon-button p-2"
                disabled={loading}
                aria-label="刷新工作台"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
              </button>
            </Tooltip>
          </div>

          {config && (
            <div className="mb-4 grid gap-2 text-xs">
              <div className="arena-status-row"><Network size={14} />并发 {config.maxParallelRequests}</div>
              <div className="arena-status-row"><Database size={14} />DB {config.hasDatabaseUrl && databaseReady ? 'OK' : '未就绪'}</div>
              <div className="arena-status-row">
                <KeyRound size={14} />
                Key {config.hasApiKey ? (config.apiKeySource === 'local' ? '本机' : '环境变量') : '缺少'}
              </div>
            </div>
          )}

          {(configError || actionError || actionNotice || config?.hasApiKey === false || config?.hasDatabaseUrl === false || !databaseReady) && (
            <div className="mb-4 space-y-2">
              {configError && <div className="arena-alert"><AlertTriangle size={14} />{configError}</div>}
              {actionError && <div className="arena-alert"><AlertTriangle size={14} />{actionError}</div>}
              {actionNotice && <div className="arena-status-row text-[var(--arena-accent-readable)]"><Network size={14} />{actionNotice}</div>}
              {config?.hasApiKey === false && <div className="arena-alert"><KeyRound size={14} />缺少 Token Plan Key，请在“本机配置”里填写。</div>}
              {config?.hasDatabaseUrl === false && <div className="arena-alert"><Database size={14} />缺少 DATABASE_URL，Work 无法保存。</div>}
            </div>
          )}

          <section className="arena-sidebar-panel mb-4">
            <button
              type="button"
              onClick={() => setLocalConfigOpen((open) => !open)}
              className="arena-disclosure-trigger"
              aria-expanded={localConfigOpen}
            >
              <span className="inline-flex items-center gap-2">
                <KeyRound size={16} />
                本机配置
              </span>
              <ChevronDown size={15} className={`transition-transform ${localConfigOpen ? 'rotate-180' : ''}`} />
            </button>
            {localConfigOpen && (
              <div className="mt-3 space-y-3">
                <div className="arena-helper-note">
                  Key 只会保存到本机私有配置，不会返回到浏览器显示，也不会进入开源代码。
                </div>
                <input
                  value={localApiKey}
                  onChange={(event) => setLocalApiKey(event.target.value)}
                  placeholder={config?.hasApiKey ? '输入新 Key 可覆盖当前配置' : '粘贴 Token Plan API Key'}
                  type="password"
                  autoComplete="off"
                  className="arena-input h-9 w-full px-3 text-sm"
                />
                <input
                  value={localBaseUrl}
                  onChange={(event) => setLocalBaseUrl(event.target.value)}
                  placeholder="Token Plan Base URL"
                  className="arena-input h-9 w-full px-3 text-sm"
                />
                <div className="arena-selected-path">
                  <KeyRound size={13} />
                  <span className="truncate">
                    {config?.apiKeySource === 'local'
                      ? '当前使用页面保存的本机 Key'
                      : config?.apiKeySource === 'env'
                        ? '当前使用环境变量 Key'
                        : '尚未配置 Key'}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <button
                    type="button"
                    onClick={() => void saveLocalConfig(false)}
                    disabled={savingLocalConfig || (!localApiKey.trim() && localBaseUrl.trim() === config?.baseUrl)}
                    className="arena-button-primary inline-flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
                  >
                    {savingLocalConfig ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                    保存配置
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveLocalConfig(true)}
                    disabled={savingLocalConfig || config?.apiKeySource !== 'local'}
                    className="arena-button-secondary inline-flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
                  >
                    清除本机 Key
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="mb-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--arena-ink)]">
              <FolderKanban size={16} />
              工作
            </div>
            <div className="space-y-1.5">
              {works.map((work) => (
                <button
                  key={work.id}
                  onClick={() => {
                    setActiveWorkId(work.id);
                    void loadWork(work.id);
                  }}
                  className={`arena-work-list-item ${activeWork?.id === work.id ? 'is-active' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{work.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--arena-dim)]">
                      {work.windowCount} 窗口{work.projectPath ? ` · ${work.projectPath}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              {works.length === 0 && !loading && (
                <div className="rounded-lg border border-[var(--arena-line)] bg-[var(--arena-field)] p-3 text-xs text-[var(--arena-dim)]">
                  还没有工作。
                </div>
              )}
            </div>
          </section>

          <section className="arena-sidebar-panel">
            <button
              type="button"
              onClick={() => setNewWorkOpen((open) => !open)}
              className="arena-disclosure-trigger"
              aria-expanded={newWorkOpen}
            >
              <span className="inline-flex items-center gap-2">
                <Plus size={16} />
                开始工作
              </span>
              <ChevronDown size={15} className={`transition-transform ${newWorkOpen ? 'rotate-180' : ''}`} />
            </button>
            {newWorkOpen && (
              <div className="mt-3 space-y-3">
                <input
                  value={newWorkTitle}
                  onChange={(event) => setNewWorkTitle(event.target.value)}
                  placeholder="工作名称，例如 首页开发"
                  className="arena-input h-9 w-full px-3 text-sm"
                />
                <div className="grid gap-1.5">
                  {startModeOptions.map((option) => {
                    const Icon = option.icon;
                    const active = workStartMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setWorkStartMode(option.value)}
                        className={`arena-start-mode ${active ? 'is-active' : ''}`}
                        aria-pressed={active}
                      >
                        <Icon size={15} className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="mt-0.5 block text-[11px] text-[var(--arena-dim)]">{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {workStartMode === 'new_project' && (
                  <input
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="项目文件夹名称，可留空"
                    className="arena-input h-9 w-full px-3 text-sm"
                  />
                )}

                {workStartMode === 'existing_project' && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => void pickProjectFolder()}
                      disabled={pickingFolder || savingWork}
                      className="arena-button-secondary inline-flex h-9 w-full items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
                    >
                      {pickingFolder ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                      {pickingFolder ? '选择中' : '选择电脑里的文件夹'}
                    </button>
                    <ArenaSelect
                      value={newWorkProjectPath}
                      onChange={setNewWorkProjectPath}
                      options={existingProjectOptions}
                      ariaLabel="从常用项目中选择文件夹"
                      placeholder="或从常用项目里选择"
                      className="h-9 w-full px-3 text-sm"
                    />
                    {newWorkProjectPath && (
                      <div className="arena-selected-path">
                        <FolderOpen size={13} />
                        <span className="truncate">{newWorkProjectPath}</span>
                      </div>
                    )}
                  </div>
                )}

                {workStartMode === 'remote_project' && (
                  <div className="space-y-2">
                    <input
                      value={remoteProjectUrl}
                      onChange={(event) => setRemoteProjectUrl(event.target.value)}
                      placeholder="https://github.com/owner/repo.git"
                      className="arena-input h-9 w-full px-3 text-sm"
                    />
                    <input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="本地项目名称，可留空"
                      className="arena-input h-9 w-full px-3 text-sm"
                    />
                  </div>
                )}

                <div className="arena-helper-note">
                  {workStartMode === 'chat_only'
                    ? '纯对话工作不会读写本地代码。之后也可以在工作设置里绑定项目。'
                    : '系统会自动准备本地安全快照，每个窗口都会在自己的工作区里尝试开发。'}
                </div>
                <button
                  onClick={() => void createWork()}
                  disabled={savingWork || !canCreateWork}
                  className="arena-button-primary inline-flex h-9 w-full items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
                >
                  {savingWork ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {workStartMode === 'chat_only' ? '创建纯对话工作' : '准备并创建工作'}
                </button>
              </div>
            )}
          </section>
        </aside>

        <section className="min-w-0 p-4 sm:p-5 lg:p-6">
          {activeWork ? (
            <>
              <header className="arena-work-header mb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={activeWork.title}
                      onChange={(event) => setActiveWork({ ...activeWork, title: event.target.value })}
                      onBlur={(event) => void patchWork({ title: event.target.value })}
                      className="min-w-0 bg-transparent text-2xl font-bold text-[var(--arena-ink)] outline-none"
                      aria-label="工作标题"
                    />
                    <span className="arena-chip-active px-2 py-1 text-xs">{activeWork.windows.length} 窗口</span>
                    <span className="arena-chip px-2 py-1 text-xs">{selectedWindowIds.length} 已选</span>
                    <span className="arena-chip px-2 py-1 text-xs">
                      {activeWork.projectPath ? '项目工作' : '纯对话'}
                    </span>
                  </div>
                  {workSettingsOpen && (
                    <div className="arena-quiet-panel mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <input
                      value={activeWork.goal || ''}
                      onChange={(event) => setActiveWork({ ...activeWork, goal: event.target.value })}
                      onBlur={(event) => void patchWork({ goal: event.target.value })}
                      placeholder="工作目标，可选"
                      className="arena-input h-10 px-3 text-sm"
                    />
                    <ArenaSelect
                      value={activeWork.projectPath || ''}
                      onChange={(value) => void bindProjectToActiveWork(value || null)}
                      options={projectOptions}
                      ariaLabel="当前工作绑定项目"
                      className="h-10 w-full px-3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void pickProjectFolder({ bindToActiveWork: true })}
                      disabled={pickingFolder}
                      className="arena-button-secondary inline-flex h-10 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50 xl:col-start-2"
                    >
                      {pickingFolder ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                      {pickingFolder ? '选择中' : '选择文件夹'}
                    </button>
                  </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Tooltip label="编辑当前工作的目标和项目绑定" side="bottom" align="end">
                    <button
                      type="button"
                      onClick={() => setWorkSettingsOpen((open) => !open)}
                      className={`arena-button-secondary inline-flex h-9 items-center gap-2 px-3 text-sm ${workSettingsOpen ? 'is-active' : ''}`}
                      aria-expanded={workSettingsOpen}
                    >
                      <Settings2 size={15} />
                      工作设置
                    </button>
                  </Tooltip>
                  <Tooltip label="选择执行引擎和模型后添加窗口" side="bottom" align="end">
                    <button
                      type="button"
                      onClick={() => setAddWindowOpen((open) => !open)}
                      className={`arena-button-secondary inline-flex h-9 items-center gap-2 px-3 text-sm ${addWindowOpen ? 'is-active' : ''}`}
                      aria-expanded={addWindowOpen}
                    >
                      <Plus size={15} />
                      添加窗口
                    </button>
                  </Tooltip>
                </div>
              </header>

              {addWindowOpen && (
                <section className="arena-quiet-panel arena-add-window-panel mb-4">
                  <div className="grid gap-2 md:grid-cols-[210px_minmax(220px,1fr)_auto]">
                    <ArenaSelect
                      value={addWindowRuntime}
                      onChange={setAddWindowRuntime}
                      options={runtimeOptions}
                      ariaLabel="新窗口执行引擎"
                      className="h-9 w-full px-3 text-sm"
                    />
                    <ArenaSelect
                      value={addWindowModel}
                      onChange={setAddWindowModel}
                      options={textModelOptions}
                      ariaLabel="新窗口模型"
                      className="h-9 w-full px-3 text-sm"
                    />
                    <button onClick={() => void createWindow()} className="arena-button-primary inline-flex h-9 items-center justify-center gap-2 px-3 text-sm">
                      <Plus size={15} />
                      添加窗口
                    </button>
                  </div>
                </section>
              )}

              <section className="arena-race-panel mb-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--arena-ink)]">
                    <Layers3 size={17} />
                    竞态广播
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--arena-dim)]">
                    <span>同一提示发送到 {selectedWindowIds.length} 个窗口</span>
                    {selectedWindows.length > 1 && (
                      <button
                        onClick={() => setCompareOpen((open) => !open)}
                        className={`arena-filter px-2 py-1 text-xs ${compareOpen ? 'is-active' : ''}`}
                      >
                        {compareOpen ? '收起对比' : '对比'}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedWindowIds(activeWork.windows.map((window) => window.id))}
                      className="arena-filter px-2 py-1 text-xs"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => setSelectedWindowIds([])}
                      className="arena-filter px-2 py-1 text-xs"
                    >
                      清空
                    </button>
                    <Tooltip label="批量归档当前选中的窗口" side="top" align="end">
                      <button
                        onClick={() => void archiveSelectedWindows()}
                        disabled={selectedWindowIds.length === 0 || isStreaming}
                        className="arena-filter inline-flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                        归档选中
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <textarea
                    value={racePrompt}
                    onChange={(event) => setRacePrompt(event.target.value)}
                    onCompositionStart={raceIme.onCompositionStart}
                    onCompositionEnd={raceIme.onCompositionEnd}
                    onKeyDown={raceIme.onKeyDown}
                    placeholder="输入任务，Enter 广播到选中窗口，Shift Enter 换行..."
                    rows={3}
                    className="arena-input min-h-24 resize-none px-4 py-3 text-sm"
                  />
                  <div className="flex gap-2 lg:w-32 lg:flex-col">
                    <Tooltip label={isStreaming ? '停止全部窗口' : '发送同一任务给选中窗口'} side="top" align="end" className="flex-1">
                      <button
                        onClick={isStreaming ? abortAll : () => void submitRace()}
                        disabled={!isStreaming && !canRace}
                        className={`inline-flex h-11 w-full items-center justify-center gap-2 px-3 text-sm ${
                          isStreaming ? 'arena-button-secondary border-red-300/40 text-red-100' : 'arena-button-primary'
                        } disabled:opacity-40`}
                      >
                        {isStreaming ? <Square size={16} /> : <Send size={16} />}
                        {isStreaming ? '停止' : '广播'}
                      </button>
                    </Tooltip>
                    <div className="arena-status-row justify-center text-xs">
                      <History size={13} />
                      Race
                    </div>
                  </div>
                </div>
              </section>

              <ApprovalInbox work={activeWork} onDecide={(windowId, toolRunId, decision) => void decideToolRun(windowId, toolRunId, decision)} />

              {selectedWindows.length > 1 && compareOpen && (
                <section className="arena-compare-panel mb-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--arena-ink)]">
                      <Layers3 size={17} />
                      对比选中窗口
                    </div>
                    <span className="text-xs text-[var(--arena-dim)]">{selectedWindows.length} 条时间线</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {selectedWindows.map((window) => {
                      const model = models.find((item) => item.slug === window.modelSlug);
                      const lastAssistant = [...window.messages].reverse().find((message) => message.role === 'assistant');
                      const lastTool = window.toolRuns?.[0];
                      return (
                        <div key={window.id} className="arena-compare-item">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--arena-ink)]">{window.name}</div>
                              <div className="truncate text-[11px] text-[var(--arena-dim)]">
                                {window.runtimeKind === 'codex_cli' ? 'Codex CLI' : 'Token Plan'} · {model?.name || window.modelSlug} · {window.workspaceBranch?.status || window.branchStatus}
                              </div>
                            </div>
                            <button onClick={() => void markWinner(window.id)} className={`arena-filter px-2 py-1 text-xs ${window.isWinner ? 'is-active' : ''}`}>
                              Winner
                            </button>
                          </div>
                          <p className="line-clamp-2 min-h-10 text-xs leading-5 text-[var(--arena-muted)]">
                            {lastAssistant?.content || '还没有模型回答。'}
                          </p>
                          <div className="mt-2 text-[11px] text-[var(--arena-dim)]">
                            {lastTool ? `最近工具：${lastTool.toolName} · ${lastTool.status}` : '暂无工具记录'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <div className="arena-window-grid">
                {activeWork.windows.map((window) => (
                  <WorkbenchWindowCard
                    key={window.id}
                    window={window}
                    model={models.find((model) => model.slug === window.modelSlug)}
                    models={models}
                    runtimeOptions={runtimeOptions}
                    selected={selectedWindowIds.includes(window.id)}
                    stream={streams[window.id]}
                    onToggleSelected={() => toggleWindowSelection(window.id)}
                    onSend={(prompt) => void submitWindowPrompt(window.id, prompt)}
                    onAbort={() => abortWindow(window.id)}
                    onUpdateWindow={(windowId, patch) => void updateWindow(windowId, patch)}
                    onRunTool={(windowId, toolName, input) => void runWindowTool(windowId, toolName, input)}
                    onDecideToolRun={(windowId, toolRunId, decision) => void decideToolRun(windowId, toolRunId, decision)}
                    onMarkWinner={(windowId) => void markWinner(windowId)}
                    onPreviewMerge={(windowId) => void previewMerge(windowId)}
                    onApplyMerge={(windowId) => void applyMerge(windowId)}
                    onMergeApplied={(work, message) => void handleMergeApplied(work, message)}
                    onActionError={(message) => {
                      setActionError(message);
                      setActionNotice(null);
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="grid min-h-[70vh] place-items-center text-center">
              <div className="arena-panel max-w-md p-6">
                <GitBranch size={28} className="mx-auto mb-3 text-[var(--arena-accent-readable)]" />
                <h2 className="text-lg font-semibold text-[var(--arena-ink)]">准备工作台</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--arena-muted)]">
                  {loading ? '正在读取配置、模型和工作记录。' : '创建一个工作，然后添加窗口开始竞态。'}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
      <ArenaConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || ''}
        description={pendingConfirm?.description || ''}
        confirmLabel={pendingConfirm?.confirmLabel || '确认'}
        tone={pendingConfirm?.tone}
        busy={confirmBusy}
        onConfirm={() => void confirmPendingAction()}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
      />
    </main>
  );
}
