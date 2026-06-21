'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, FilePenLine, Loader2, ShieldCheck } from 'lucide-react';
import { DEFAULT_PROJECT_AGENT_PERMISSION, PROJECT_AGENT_PERMISSION_COPY } from '@/lib/agentPermissions';
import { CodePatchProposal, ProjectAgentPermission, ProjectPatchResult } from '@/types';
import Tooltip from './Tooltip';

interface CodePatchProposalPanelProps {
  proposal: CodePatchProposal;
  projectPath?: string;
  permissionMode?: ProjectAgentPermission;
}

function previewText(text: string, limit = 2600) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... 已截断预览，完整内容会按提案应用。`;
}

export default function CodePatchProposalPanel({ proposal, projectPath, permissionMode }: CodePatchProposalPanelProps) {
  const resolvedProjectPath = projectPath || proposal.projectPath || '';
  const activePermission = permissionMode || DEFAULT_PROJECT_AGENT_PERMISSION;
  const permissionCopy = PROJECT_AGENT_PERMISSION_COPY[activePermission];
  const requiresSeparateApproval = activePermission === 'request_approval';
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [checked, setChecked] = useState(false);
  const [applied, setApplied] = useState(false);
  const [result, setResult] = useState<ProjectPatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proposalKey = useMemo(() => JSON.stringify(proposal), [proposal]);

  useEffect(() => {
    setOpenFiles({});
    setChecking(false);
    setApplying(false);
    setChecked(false);
    setApplied(false);
    setResult(null);
    setError(null);
  }, [proposalKey]);

  async function submit(dryRun: boolean) {
    if (!resolvedProjectPath) {
      setError('缺少项目路径，不能应用代码修改。');
      return null;
    }

    setError(null);
    if (dryRun) setChecking(true);
    else setApplying(true);

    try {
      const response = await fetch('/api/projects/patch/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: resolvedProjectPath,
          proposal,
          dryRun,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '代码修改处理失败。');
      }
      setResult(data);
      if (dryRun) setChecked(true);
      else setApplied(true);
      return data as ProjectPatchResult;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setChecking(false);
      setApplying(false);
    }
  }

  async function applyWithPermission() {
    if (requiresSeparateApproval) {
      await submit(false);
      return;
    }

    setChecked(false);
    const dryRunResult = await submit(true);
    if (dryRunResult) {
      await submit(false);
    }
  }

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-[var(--arena-accent-line)] bg-[rgba(10,14,22,0.94)]">
      <div className="flex flex-col gap-3 border-b border-[var(--arena-line)] p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--arena-accent-readable)]">
            <FilePenLine size={16} />
            <span>代码修改提案</span>
            <span className="arena-chip px-2 py-0.5 text-[11px]">{proposal.edits.length} 个文件</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--arena-muted)]">
            {proposal.summary || '模型生成了一个待确认的本地代码修改提案。'}
          </p>
          <div className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[var(--arena-dim)]">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--arena-accent)]" />
            <span>
              当前权限：{permissionCopy.title}。服务端会限制路径、文件类型和精确替换片段。
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {requiresSeparateApproval && (
            <Tooltip label="只校验路径、文件类型和 oldText 是否精确匹配，不写入文件" side="top" align="end">
              <button
                onClick={() => submit(true)}
                disabled={checking || applying || applied}
                className="arena-button-secondary inline-flex h-9 items-center gap-2 px-3 text-xs disabled:opacity-40"
              >
                {checking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                校验提案
              </button>
            </Tooltip>
          )}
          <Tooltip label={requiresSeparateApproval && !checked ? '请先校验提案' : '写入前仍会经过服务端安全校验'} side="top" align="end">
            <button
              onClick={applyWithPermission}
              disabled={(requiresSeparateApproval && !checked) || checking || applying || applied}
              className="arena-button-primary inline-flex h-9 items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-35"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {applied ? '已应用' : requiresSeparateApproval ? '应用到本地' : '校验并应用'}
            </button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-300/25 bg-red-950/20 px-3 py-2 text-xs leading-5 text-red-100">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </span>
        </div>
      )}

      {result && (
        <div className="border-b border-[var(--arena-line)] bg-[var(--arena-accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--arena-accent-readable)]">
          {applied ? '已写入本地文件' : '校验通过'}：{result.edits.map((edit) => edit.path).join('，')}
        </div>
      )}

      <div className="divide-y divide-[var(--arena-line)]">
        {proposal.edits.map((edit) => {
          const isOpen = Boolean(openFiles[edit.path]);
          return (
            <div key={`${edit.operation}:${edit.path}`} className="min-w-0">
              <button
                onClick={() => setOpenFiles((current) => ({ ...current, [edit.path]: !isOpen }))}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.03]"
              >
                <span className="shrink-0 text-[var(--arena-muted)]">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="rounded border border-[var(--arena-line)] px-1.5 py-0.5 text-[10px] text-[var(--arena-muted)]">
                  {edit.operation === 'create' ? 'create' : 'update'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--arena-ink)]">{edit.path}</span>
              </button>
              {isOpen && (
                <div className="grid gap-2 px-3 pb-3 md:grid-cols-2">
                  {edit.operation === 'update' && (
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] text-[var(--arena-dim)]">原片段</div>
                      <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md border border-red-300/20 bg-red-950/10 p-2 text-[11px] leading-5 text-red-50">
                        {previewText(edit.oldText || '')}
                      </pre>
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] text-[var(--arena-dim)]">{edit.operation === 'create' ? '新文件内容' : '替换为'}</div>
                    <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md border border-[var(--arena-accent-line)] bg-[var(--arena-accent-soft)] p-2 text-[11px] leading-5 text-[var(--arena-ink)]">
                      {previewText(edit.newText)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
