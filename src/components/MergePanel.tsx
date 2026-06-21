'use client';

import { CheckSquare2, ChevronDown, FileCode2, GitCompare, Loader2, RefreshCw, Square, SquareMinus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Tooltip from './Tooltip';
import { WorkRecord } from '@/types';

export type MergeFileChange = {
  path: string;
  status: 'create' | 'update' | 'delete';
  bytes: number;
  additions: number;
  deletions: number;
  preview: string;
  diffRows?: Array<{
    type: 'same' | 'add' | 'delete' | 'change';
    oldLine?: string;
    newLine?: string;
  }>;
  selectable: boolean;
  recommended: boolean;
  conflict: boolean;
  reason?: string;
};

type MergePreview = {
  workId: string;
  workWindowId: string;
  sourcePath: string;
  targetPath: string;
  copyFallback?: boolean;
  trackedPatchPaths?: string[];
  changes: MergeFileChange[];
};

interface MergePanelProps {
  windowId: string;
  onApplied: (work: WorkRecord, message: string) => void;
  onError: (message: string) => void;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${response.status}`);
  }
  return data as T;
}

function statusLabel(status: MergeFileChange['status']) {
  if (status === 'create') return '新增';
  if (status === 'update') return '修改';
  return '删除';
}

function statusClass(status: MergeFileChange['status']) {
  if (status === 'create') return 'is-create';
  if (status === 'update') return 'is-update';
  return 'is-delete';
}

export default function MergePanel({ windowId, onApplied, onError }: MergePanelProps) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('split');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const selectableChanges = useMemo(() => preview?.changes.filter((change) => change.selectable) || [], [preview]);
  const selectedCount = selectedPaths.length;
  const allSelected = selectableChanges.length > 0 && selectableChanges.every((change) => selectedPaths.includes(change.path));

  async function loadPreview() {
    setLoading(true);
    try {
      const data = await readJson<MergePreview>(await fetch(`/api/windows/${windowId}/merge`));
      setPreview(data);
      const initialPaths = data.changes
        .filter((change) => change.selectable && change.recommended)
        .map((change) => change.path);
      setSelectedPaths(initialPaths);
      setExpandedPath(data.changes[0]?.path || null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function applySelected() {
    if (!preview || selectedPaths.length === 0) return;
    setApplying(true);
    try {
      const data = await readJson<{ work: WorkRecord; applied: Array<{ path: string }>; skipped: Array<{ path: string }> }>(await fetch(`/api/windows/${windowId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: selectedPaths }),
      }));
      onApplied(data.work, `已应用 ${data.applied.length} 个文件${data.skipped.length ? `，跳过 ${data.skipped.length} 个删除项` : ''}。`);
      setPreview(null);
      setSelectedPaths([]);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    void loadPreview();
    // Only reload when the user opens a different window's merge panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId]);

  const toggleAll = () => {
    setSelectedPaths(allSelected ? [] : selectableChanges.map((change) => change.path));
  };

  const togglePath = (path: string) => {
    setSelectedPaths((paths) => paths.includes(path)
      ? paths.filter((item) => item !== path)
      : [...paths, path]);
  };

  return (
    <section className="arena-merge-panel">
      <div className="arena-merge-panel-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--arena-ink)]">
            <GitCompare size={15} />
            文件级合并
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--arena-dim)]">
            {preview ? `${preview.sourcePath} -> ${preview.targetPath}` : '正在读取窗口工作区差异'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label="刷新合并预览" side="top">
            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={loading || applying}
              className="arena-icon-button p-1.5 disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </Tooltip>
          <Tooltip label={allSelected ? '取消选择所有文件' : '选择所有可合并文件'} side="top">
            <button
              type="button"
              onClick={toggleAll}
              disabled={loading || applying || selectableChanges.length === 0}
              className="arena-icon-button p-1.5 disabled:opacity-40"
            >
              {allSelected ? <CheckSquare2 size={14} /> : <Square size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {loading && !preview ? (
        <div className="arena-merge-empty">
          <Loader2 size={16} className="animate-spin" />
          正在生成差异预览...
        </div>
      ) : preview && preview.changes.length > 0 ? (
        <>
          <div className="arena-merge-summary">
            <span>{preview.changes.length} 个差异</span>
            <span>{selectedCount} 个待应用</span>
            {preview.copyFallback && <span>{preview.trackedPatchPaths?.length || 0} 个 Agent 追踪文件</span>}
            <span>{preview.changes.filter((change) => change.conflict).length} 个冲突</span>
            <span>{preview.changes.filter((change) => change.status === 'delete').length} 个删除只预览</span>
            <button
              type="button"
              onClick={() => setDiffMode((mode) => mode === 'split' ? 'unified' : 'split')}
              className="arena-merge-mode-toggle"
            >
              {diffMode === 'split' ? '分栏 diff' : '统一 diff'}
            </button>
          </div>
          <div className="arena-merge-list scrollbar-thin">
            {preview.changes.map((change) => {
              const selected = selectedPaths.includes(change.path);
              const expanded = expandedPath === change.path;
              return (
                <article key={change.path} className={`arena-merge-file ${expanded ? 'is-expanded' : ''}`}>
                  <div className="arena-merge-file-row">
                    <button
                      type="button"
                      onClick={() => change.selectable && togglePath(change.path)}
                      disabled={!change.selectable || applying}
                      className="arena-merge-checkbox disabled:opacity-40"
                      aria-label={`选择 ${change.path}`}
                    >
                      {change.selectable ? (
                        selected ? <CheckSquare2 size={15} /> : <Square size={15} />
                      ) : (
                        <SquareMinus size={15} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedPath(expanded ? null : change.path)}
                      className="arena-merge-file-main"
                    >
                      <span className={`arena-merge-status ${statusClass(change.status)}`}>{statusLabel(change.status)}</span>
                      {!change.recommended && (
                        <span className="arena-merge-status is-caution">谨慎</span>
                      )}
                      {change.conflict && (
                        <span className="arena-merge-status is-conflict">冲突</span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[var(--arena-ink)]">
                        {change.path}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--arena-dim)]">
                        +{change.additions} -{change.deletions}
                      </span>
                      <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="arena-merge-diff">
                      {change.reason && <div className={`mb-2 text-[11px] ${change.conflict ? 'text-red-200' : 'text-[var(--arena-warning)]'}`}>{change.reason}</div>}
                      {diffMode === 'split' && change.diffRows && change.diffRows.length > 0 ? (
                        <div className="arena-split-diff">
                          <div className="arena-split-diff-heading">原项目</div>
                          <div className="arena-split-diff-heading">窗口分支</div>
                          {change.diffRows.map((row, index) => (
                            <div key={`${change.path}-${index}`} className={`arena-split-diff-row is-${row.type}`}>
                              <pre>{row.oldLine ?? ''}</pre>
                              <pre>{row.newLine ?? ''}</pre>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre>{change.preview || '没有可显示的文本 diff。'}</pre>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="arena-merge-actions">
            <div className="min-w-0 text-[11px] leading-5 text-[var(--arena-dim)]">
              删除项不会自动执行。copy fallback 默认只合并 Agent 补丁追踪到的文件，你也可以在这里显式选择。
            </div>
            <button
              type="button"
              onClick={() => void applySelected()}
              disabled={applying || selectedPaths.length === 0}
              className="arena-button-primary inline-flex h-8 shrink-0 items-center gap-2 px-3 text-xs disabled:opacity-40"
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <FileCode2 size={13} />}
              {selectedPaths.length > 0 ? `应用 ${selectedPaths.length} 个` : '选择文件'}
            </button>
          </div>
        </>
      ) : (
        <div className="arena-merge-empty">
          <GitCompare size={16} />
          没有发现可合并差异。
        </div>
      )}
    </section>
  );
}
