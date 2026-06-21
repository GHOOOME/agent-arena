'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Code,
  Eye,
  GitBranch,
  GitCompare,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Play,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Square,
  TerminalSquare,
  Trophy,
  Trash2,
} from 'lucide-react';
import CodePreview from './CodePreview';
import LivePreviewFrame from './LivePreviewFrame';
import MergePanel from './MergePanel';
import StreamRenderer from './StreamRenderer';
import Tooltip from './Tooltip';
import ArenaSelect from './ui/ArenaSelect';
import { useImeEnterSubmit } from '@/hooks/useImeEnterSubmit';
import { extractPreviewHtml } from '@/lib/extractCode';
import { WORK_WINDOW_PERMISSION_COPY, WORK_WINDOW_PERMISSION_ORDER } from '@/lib/workPermissions';
import { ModelConfig, ToolRunRecord, WindowMessageRecord, WorkRecord, WorkWindowRecord } from '@/types';
import { WindowStreamState } from '@/stores/useWorkbenchStore';

interface Props {
  window: WorkWindowRecord;
  model?: ModelConfig;
  models: ModelConfig[];
  runtimeOptions: Array<{ value: string; label: string; description?: string; disabled?: boolean }>;
  selected: boolean;
  stream?: WindowStreamState;
  onToggleSelected: () => void;
  onSend: (prompt: string) => void;
  onAbort: () => void;
  onUpdateWindow: (windowId: string, patch: {
    name?: string;
    modelSlug?: string;
    runtimeKind?: string;
    systemPrompt?: string;
    clearMemory?: boolean;
    permissionMode?: string;
    archived?: boolean;
  }) => void;
  onRunTool: (windowId: string, toolName: string, input?: unknown) => void;
  onDecideToolRun: (windowId: string, toolRunId: string, decision: 'approve' | 'reject') => void;
  onMarkWinner: (windowId: string) => void;
  onPreviewMerge: (windowId: string) => void;
  onApplyMerge: (windowId: string) => void;
  onMergeApplied: (work: WorkRecord, message: string) => void;
  onActionError: (message: string) => void;
}

function permissionAtLeast(current: string, target: string) {
  return WORK_WINDOW_PERMISSION_ORDER.indexOf(current as never) >= WORK_WINDOW_PERMISSION_ORDER.indexOf(target as never);
}

function statusCopy(stream?: WindowStreamState) {
  if (!stream) return { label: '空闲', icon: CheckCircle2, tone: 'text-[var(--arena-dim)]' };
  if (stream.error) return { label: '失败', icon: AlertTriangle, tone: 'text-red-200' };
  if (stream.status === 'rate_limited') return { label: '限流等待', icon: AlertTriangle, tone: 'text-[var(--arena-warning)]' };
  if (stream.status === 'reading_project') return { label: '读项目', icon: Loader2, tone: 'text-[var(--arena-accent-readable)]' };
  if (stream.status === 'tool_planning') return { label: '计划工具', icon: Loader2, tone: 'text-[var(--arena-accent-readable)]' };
  if (stream.status === 'tool_running') return { label: '执行工具', icon: Loader2, tone: 'text-[var(--arena-accent-readable)]' };
  if (stream.status === 'tool_result') return { label: '工具完成', icon: CheckCircle2, tone: 'text-[var(--arena-muted)]' };
  if (!stream.done) return { label: stream.status === 'queued' ? '排队' : '生成中', icon: Loader2, tone: 'text-[var(--arena-accent-readable)]' };
  return { label: '完成', icon: CheckCircle2, tone: 'text-[var(--arena-muted)]' };
}

function toolRunPreview(tool: ToolRunRecord) {
  const raw = tool.error || tool.output || '没有输出。';
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function toolRunTime(tool: ToolRunRecord) {
  return new Date(tool.startedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageBubble({ message, showHtmlPreview }: { message: WindowMessageRecord; showHtmlPreview: boolean }) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const preview = !isUser && message.content.trim() ? extractPreviewHtml(message.content) : { hasPreview: false, html: '' };
  const collapseSource = showHtmlPreview && preview.hasPreview;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[94%] rounded-lg border px-3 py-2 text-sm leading-6 ${
          isUser
            ? 'border-[var(--arena-accent-line)] bg-[var(--arena-accent-soft)] text-[var(--arena-ink)]'
            : isTool
              ? 'border-[var(--arena-info-line)] bg-[var(--arena-info-soft)] text-[var(--arena-ink)]'
              : 'border-[var(--arena-line)] bg-white/[0.025] text-[var(--arena-ink)]'
        }`}
      >
        <div className="mb-1 text-[11px] text-[var(--arena-dim)]">
          {isUser ? '你' : isTool ? '工具' : '模型'}
        </div>
        {collapseSource ? (
          <div className="rounded-md border border-[var(--arena-line)] bg-[var(--arena-field)] px-3 py-2 text-xs leading-5 text-[var(--arena-muted)]">
            HTML 源码已折叠，下面直接预览。
          </div>
        ) : isUser || isTool ? (
          <div className="whitespace-pre-wrap break-words">{message.content || '...'}</div>
        ) : message.content.trim() ? (
          <StreamRenderer content={message.content} />
        ) : (
          <div className="text-[var(--arena-dim)]">生成中...</div>
        )}
      </div>
    </div>
  );
}

export default function WorkbenchWindowCard({
  window,
  model,
  models,
  runtimeOptions,
  selected,
  stream,
  onToggleSelected,
  onSend,
  onAbort,
  onUpdateWindow,
  onRunTool,
  onDecideToolRun,
  onMarkWinner,
  onPreviewMerge,
  onApplyMerge,
  onMergeApplied,
  onActionError,
}: Props) {
  const [localPrompt, setLocalPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [htmlView, setHtmlView] = useState<'preview' | 'source'>('preview');
  const scrollRef = useRef<HTMLDivElement>(null);
  const status = statusCopy(stream);
  const StatusIcon = status.icon;
  const permission = WORK_WINDOW_PERMISSION_COPY[window.permissionMode];
  const branch = window.workspaceBranch;
  const isRunning = Boolean(stream && !stream.done);
  const textModels = useMemo(() => models.filter((item) => !item.capabilities.includes('image')), [models]);
  const modelOptions = useMemo(() => textModels.map((item) => ({
    value: item.slug,
    label: item.name,
    description: `${item.provider} · ${item.bestFor.slice(0, 2).join(' / ')}`,
  })), [textModels]);
  const permissionOptions = useMemo(() => WORK_WINDOW_PERMISSION_ORDER.map((item) => ({
    value: item,
    label: WORK_WINDOW_PERMISSION_COPY[item].title,
    description: WORK_WINDOW_PERMISSION_COPY[item].description,
  })), []);
  const latestPreview = [...window.messages]
    .reverse()
    .map((message) => message.role === 'assistant' ? extractPreviewHtml(message.content) : null)
    .find((item) => item?.hasPreview);
  const canSend = localPrompt.trim().length > 0 && !isRunning;
  const canRunSafeCommand = permissionAtLeast(window.permissionMode, 'run_safe_commands');
  const canRunPreview = permissionAtLeast(window.permissionMode, 'run_dev_server');
  const runtimeLabel = window.runtimeKind === 'codex_cli' ? 'Codex CLI' : 'Token Plan';

  const sendLocal = () => {
    if (!canSend) return;
    onSend(localPrompt.trim());
    setLocalPrompt('');
  };
  const imeSubmit = useImeEnterSubmit(sendLocal, canSend);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [window.messages.length, stream?.content, stream?.reasoning]);

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`arena-work-window ${selected ? 'is-selected' : ''} ${isRunning ? 'is-running' : ''}`}
    >
      <header className="arena-work-window-header">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Tooltip label={selected ? '从下一次竞态中移除' : '加入下一次竞态'} side="top" align="start">
            <button
              onClick={onToggleSelected}
              className={`mt-0.5 h-5 w-5 shrink-0 rounded border transition-colors ${
                selected
                  ? 'border-[var(--arena-accent-line)] bg-[var(--arena-accent)]'
                  : 'border-[var(--arena-line-strong)] bg-[var(--arena-field)] hover:border-[var(--arena-accent-line)]'
              }`}
              aria-pressed={selected}
              aria-label="选择窗口参与竞态"
            />
          </Tooltip>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input
                key={`${window.id}-${window.name}`}
                defaultValue={window.name}
                onBlur={(event) => {
                  const nextName = event.currentTarget.value.trim();
                  if (nextName && nextName !== window.name) {
                    onUpdateWindow(window.id, { name: nextName });
                  } else {
                    event.currentTarget.value = window.name;
                  }
                }}
                className="min-w-0 max-w-[180px] bg-transparent text-sm font-semibold text-[var(--arena-ink)] outline-none"
                aria-label="窗口名称"
              />
              <span className={`inline-flex items-center gap-1 text-[11px] ${status.tone}`}>
                <StatusIcon size={12} className={!stream?.done && stream ? 'animate-spin' : ''} />
                {status.label}
              </span>
              {window.isWinner && (
                <span className="arena-chip-active inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px]">
                  <Trophy size={11} />
                  Winner
                </span>
              )}
              {stream?.tokensPerSecond && stream.done && (
                <span className="text-[11px] text-[var(--arena-faint)]">{stream.tokensPerSecond.toFixed(1)} t/s</span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--arena-dim)]">
              <span className="arena-mini-pill" style={{ '--pill-color': model?.color || 'var(--arena-accent)' } as CSSProperties}>
                {model?.name || window.modelSlug}
              </span>
              <span className="arena-mini-pill"><Sparkles size={11} />{runtimeLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {latestPreview?.hasPreview && (
            <Tooltip label={htmlView === 'preview' ? '切换为源码显示' : '切换为预览显示'} side="top">
              <button
                onClick={() => setHtmlView(htmlView === 'preview' ? 'source' : 'preview')}
                className="arena-icon-button p-1.5"
                aria-label={htmlView === 'preview' ? '切换为源码显示' : '切换为预览显示'}
              >
                {htmlView === 'preview' ? <Code size={15} /> : <Eye size={15} />}
              </button>
            </Tooltip>
          )}
          <Tooltip label="窗口设置" side="top">
            <button
              onClick={() => setSettingsOpen((open) => !open)}
              className="arena-icon-button p-1.5"
              aria-label="窗口设置"
              aria-expanded={settingsOpen}
            >
              <MoreHorizontal size={15} />
            </button>
          </Tooltip>
        </div>
      </header>

      {settingsOpen && (
        <div className="border-b border-[var(--arena-line)] bg-[rgba(255,255,255,0.018)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-[var(--arena-muted)]">
              执行引擎
              <ArenaSelect
                value={window.runtimeKind}
                onChange={(value) => onUpdateWindow(window.id, { runtimeKind: value })}
                options={runtimeOptions}
                ariaLabel={`${window.name} 执行引擎`}
                className="mt-1 h-9 w-full px-2 text-sm"
                disabled={isRunning}
              />
            </label>
            <label className="text-xs text-[var(--arena-muted)]">
              模型
              <ArenaSelect
                value={window.modelSlug}
                onChange={(value) => onUpdateWindow(window.id, { modelSlug: value })}
                options={modelOptions}
                ariaLabel={`${window.name} 模型`}
                className="mt-1 h-9 w-full px-2 text-sm"
                disabled={isRunning}
              />
            </label>
            <label className="text-xs text-[var(--arena-muted)] sm:col-span-2">
              权限
              <ArenaSelect
                value={window.permissionMode}
                onChange={(value) => onUpdateWindow(window.id, { permissionMode: value })}
                options={permissionOptions}
                ariaLabel={`${window.name} 权限`}
                className="mt-1 h-9 w-full px-2 text-sm"
              />
            </label>
            <label className="text-xs text-[var(--arena-muted)] sm:col-span-2">
              窗口指令
              <textarea
                key={`${window.id}-system-${window.systemPrompt || ''}`}
                defaultValue={window.systemPrompt || ''}
                onBlur={(event) => {
                  const nextPrompt = event.currentTarget.value.trim();
                  if (nextPrompt !== (window.systemPrompt || '').trim()) {
                    onUpdateWindow(window.id, { systemPrompt: nextPrompt });
                  }
                }}
                placeholder="例如：你负责做极简黑色高级 UI，只改必要文件，回复先给结论再给验证结果。"
                rows={3}
                className="arena-input mt-1 min-h-20 w-full resize-y px-3 py-2 text-sm leading-5"
              />
            </label>
          </div>
          <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--arena-dim)]">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="arena-metadata-row">
                <Shield size={13} />
                <span>{permission?.title || window.permissionMode}</span>
              </div>
              <div className="arena-metadata-row">
                <GitBranch size={13} />
                <span>{branch?.status || window.branchStatus}</span>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2">
              <GitBranch size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                {branch?.worktreePath ? branch.worktreePath : branch?.lastDiffSummary || '尚未创建分支或当前工作没有项目路径。'}
              </span>
            </div>
            {window.toolRuns && window.toolRuns.length > 0 && (
              <div className="flex min-w-0 items-start gap-2">
                <TerminalSquare size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  最近工具：{window.toolRuns[0].toolName} · {window.toolRuns[0].status}
                </span>
              </div>
            )}
          </div>
          <div className="arena-tool-log mt-3">
            <button
              type="button"
              className="arena-tool-log-trigger"
              aria-expanded="true"
            >
              <span className="inline-flex items-center gap-2">
                <Brain size={13} />
                长期记忆
                {window.memoryUpdatedAt && (
                  <span className="text-[var(--arena-faint)]">
                    {new Date(window.memoryUpdatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
            </button>
            <div className="border-t border-[var(--arena-line)] p-2">
              <p className="break-words text-xs leading-5 text-[var(--arena-muted)]">
                {window.memorySummary || '还没有长期摘要。窗口对话变长后会自动压缩出记忆，用来保留早期决策、偏好和待办。'}
              </p>
              {window.memorySummary && (
                <button
                  type="button"
                  onClick={() => onUpdateWindow(window.id, { clearMemory: true })}
                  className="arena-button-secondary mt-2 h-7 px-2 text-[11px] text-red-100"
                >
                  清空记忆摘要
                </button>
              )}
            </div>
          </div>
          {window.toolRuns && window.toolRuns.length > 0 && (
            <div className="arena-tool-log mt-3">
              <button
                type="button"
                onClick={() => setToolLogOpen((open) => !open)}
                className="arena-tool-log-trigger"
                aria-expanded={toolLogOpen}
              >
                <span className="inline-flex items-center gap-2">
                  <TerminalSquare size={13} />
                  工具日志
                  <span className="text-[var(--arena-faint)]">{window.toolRuns.length}</span>
                </span>
                <ChevronDown size={14} className={`transition-transform ${toolLogOpen ? 'rotate-180' : ''}`} />
              </button>
              {toolLogOpen && (
                <div className="space-y-2 border-t border-[var(--arena-line)] p-2">
                  {window.toolRuns.slice(0, 4).map((tool) => (
                    <div key={tool.id} className="arena-tool-log-item">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-[var(--arena-ink)]">{tool.toolName}</span>
                        <span className={`shrink-0 ${tool.status === 'failed' ? 'text-red-200' : 'text-[var(--arena-dim)]'}`}>
                          {tool.status} · {toolRunTime(tool)}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-[11px] leading-5 text-[var(--arena-dim)]">
                        {toolRunPreview(tool)}
                      </p>
                      {tool.status === 'pending_approval' && (
                        <div className="arena-approval-actions">
                          <div className="min-w-0 text-[11px] leading-5 text-[var(--arena-warning)]">
                            高风险命令待审批，只会在这个窗口工作区执行。
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => onDecideToolRun(window.id, tool.id, 'reject')}
                              className="arena-button-secondary h-7 px-2 text-[11px] text-red-100"
                            >
                              拒绝
                            </button>
                            <button
                              type="button"
                              onClick={() => onDecideToolRun(window.id, tool.id, 'approve')}
                              className="arena-button-primary h-7 px-2 text-[11px]"
                            >
                              批准执行
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Tooltip label="把这个窗口标记为当前工作 winner" side="top" align="start">
              <button
                onClick={() => onMarkWinner(window.id)}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs"
              >
                <Trophy size={13} />
                Winner
              </button>
            </Tooltip>
            <Tooltip label="查看这个窗口相对原项目的可合并文件" side="top">
              <button
                onClick={() => {
                  setMergeOpen((open) => !open);
                  if (!mergeOpen) onPreviewMerge(window.id);
                }}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs"
              >
                <GitCompare size={13} />
                {mergeOpen ? '收起合并' : '合并预览'}
              </button>
            </Tooltip>
            <Tooltip label="把这个窗口的安全文件改动应用到原项目" side="top">
              <button
                onClick={() => onApplyMerge(window.id)}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs text-[var(--arena-accent-readable)]"
              >
                <GitBranch size={13} />
                应用合并
              </button>
            </Tooltip>
            <Tooltip label={canRunSafeCommand ? '在该窗口工作区运行 npm run lint' : '需要“安全命令”或更高权限'} side="top" align="start">
              <button
                onClick={() => onRunTool(window.id, 'run_command', { command: 'npm run lint' })}
                disabled={!canRunSafeCommand}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <TerminalSquare size={13} />
                Lint
              </button>
            </Tooltip>
            <Tooltip label={canRunSafeCommand ? '在该窗口工作区运行 TypeScript 检查' : '需要“安全命令”或更高权限'} side="top">
              <button
                onClick={() => onRunTool(window.id, 'run_command', { command: 'npx tsc --noEmit' })}
                disabled={!canRunSafeCommand}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <TerminalSquare size={13} />
                TSC
              </button>
            </Tooltip>
            <Tooltip label={canRunPreview ? '启动该窗口独立预览服务' : '需要“启动预览”或更高权限'} side="top">
              <button
                onClick={() => onRunTool(window.id, 'start_dev_server')}
                disabled={!canRunPreview}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <Play size={13} />
                预览
              </button>
            </Tooltip>
            <Tooltip label={canRunPreview ? '检查当前预览端口是否仍然可用' : '需要“启动预览”或更高权限'} side="top">
              <button
                onClick={() => onRunTool(window.id, 'check_preview_server')}
                disabled={!canRunPreview}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <Loader2 size={13} />
                检查
              </button>
            </Tooltip>
            <Tooltip label={canRunPreview ? '如果预览进程丢失，则重新启动或恢复端口' : '需要“启动预览”或更高权限'} side="top">
              <button
                onClick={() => onRunTool(window.id, 'recover_preview_server')}
                disabled={!canRunPreview}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <RefreshCw size={13} />
                恢复
              </button>
            </Tooltip>
            <Tooltip label={canRunPreview ? '停止该窗口预览服务' : '需要“启动预览”或更高权限'} side="top">
              <button
                onClick={() => onRunTool(window.id, 'stop_dev_server')}
                disabled={!canRunPreview}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <Square size={12} />
                停止
              </button>
            </Tooltip>
            <Tooltip label={canRunPreview ? '读取该窗口预览日志' : '需要“启动预览”或更高权限'} side="top" align="end">
              <button
                onClick={() => onRunTool(window.id, 'read_dev_server_log')}
                disabled={!canRunPreview}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs disabled:opacity-40"
              >
                <TerminalSquare size={13} />
                日志
              </button>
            </Tooltip>
          </div>
          {mergeOpen && (
            <MergePanel
              windowId={window.id}
              onApplied={onMergeApplied}
              onError={onActionError}
            />
          )}
          <div className="mt-3 flex justify-end">
            <Tooltip label="归档这个窗口" side="top" align="end">
              <button
                onClick={() => onUpdateWindow(window.id, { archived: true })}
                className="arena-button-secondary inline-flex h-8 items-center gap-2 px-2 text-xs text-red-100"
              >
                <Trash2 size={13} />
                删除窗口
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="scrollbar-thin min-h-[360px] flex-1 overflow-y-auto p-4">
        {stream?.error && (
          <div className="mb-3 rounded-lg border border-red-300/30 bg-red-950/20 px-3 py-2 text-sm text-red-100">
            {stream.error}
          </div>
        )}
        {window.previewPort && (
          <div className="mb-3">
            <LivePreviewFrame port={window.previewPort} title={`${window.name} 实时预览`} />
          </div>
        )}
        {stream && !stream.done && (stream.status === 'reading_project' || stream.agentMessage) && (
          <div className="arena-chip-active mb-3 rounded-lg px-3 py-2 text-xs">
            {stream.agentMessage || '正在读取窗口自己的项目上下文...'}
          </div>
        )}
        {window.messages.length === 0 ? (
          <div className="grid min-h-72 place-items-center text-center text-[var(--arena-faint)]">
            <div>
              <Brain size={24} className="mx-auto mb-2" />
              <p className="text-sm text-[var(--arena-muted)]">这个窗口还没有时间线。</p>
              <p className="mt-1 text-xs">选中它参与竞态，或在下方单独发送。</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {window.messages.map((message) => (
              <MessageBubble key={message.id} message={message} showHtmlPreview={htmlView === 'preview'} />
            ))}
            {htmlView === 'preview' && latestPreview?.hasPreview && (
              <CodePreview html={latestPreview.html} />
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--arena-line)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--arena-dim)]">
          <span className="min-w-0 truncate">窗口 ID {window.id.slice(-8)}</span>
          {window.previewPort ? (
            <span className="inline-flex items-center gap-1"><Maximize2 size={11} />预览端口 {window.previewPort}</span>
          ) : (
            <span className="inline-flex items-center gap-1"><Play size={11} />预览待启动</span>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
          <textarea
            value={localPrompt}
            onChange={(event) => setLocalPrompt(event.target.value)}
            onCompositionStart={imeSubmit.onCompositionStart}
            onCompositionEnd={imeSubmit.onCompositionEnd}
            onKeyDown={imeSubmit.onKeyDown}
            placeholder={`只发给 ${window.name}`}
            rows={1}
            disabled={isRunning}
            className="arena-input max-h-28 min-h-10 min-w-0 resize-none px-3 py-2 text-sm leading-5 disabled:opacity-50"
          />
          <Tooltip label={isRunning ? '停止这个窗口' : '只发送给这个窗口'} side="top" align="end">
            <button
              onClick={isRunning ? onAbort : sendLocal}
              disabled={!isRunning && !canSend}
              className={`inline-flex h-10 w-10 items-center justify-center ${isRunning ? 'arena-button-secondary border-red-300/40 text-red-100' : 'arena-button-primary'} disabled:opacity-30`}
            >
              {isRunning ? <Square size={16} /> : <Send size={16} />}
            </button>
          </Tooltip>
        </div>
      </footer>
    </motion.section>
  );
}
