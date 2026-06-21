'use client';

import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { ToolRunRecord, WorkRecord } from '@/types';

type PendingApproval = {
  windowId: string;
  windowName: string;
  tool: ToolRunRecord;
};

interface ApprovalInboxProps {
  work: WorkRecord;
  onDecide: (windowId: string, toolRunId: string, decision: 'approve' | 'reject') => void;
}

function extractCommand(tool: ToolRunRecord) {
  const input = tool.input as { command?: unknown; reason?: unknown } | undefined;
  return {
    command: typeof input?.command === 'string' ? input.command : '未知命令',
    reason: typeof input?.reason === 'string' ? input.reason : '该命令需要用户确认。',
  };
}

export function getPendingApprovals(work: WorkRecord): PendingApproval[] {
  return work.windows.flatMap((window) =>
    (window.toolRuns || [])
      .filter((tool) => tool.status === 'pending_approval')
      .map((tool) => ({
        windowId: window.id,
        windowName: window.name,
        tool,
      }))
  );
}

export default function ApprovalInbox({ work, onDecide }: ApprovalInboxProps) {
  const approvals = getPendingApprovals(work);
  if (approvals.length === 0) return null;

  return (
    <section className="arena-approval-inbox">
      <div className="arena-approval-inbox-header">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert size={17} className="text-[var(--arena-warning)]" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--arena-ink)]">审批 Inbox</div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--arena-dim)]">
              {approvals.length} 个本地命令等待确认。批准后只在对应窗口工作区执行。
            </div>
          </div>
        </div>
        <span className="arena-merge-status is-caution">{approvals.length} pending</span>
      </div>
      <div className="grid gap-2 p-3">
        {approvals.map(({ windowId, windowName, tool }) => {
          const { command, reason } = extractCommand(tool);
          return (
            <article key={tool.id} className="arena-approval-inbox-item">
              <div className="min-w-0">
                <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="arena-mini-pill">
                    <AlertTriangle size={11} />
                    {windowName}
                  </span>
                  <code className="min-w-0 break-words text-[12px] text-[var(--arena-ink)]">{command}</code>
                </div>
                <p className="text-[11px] leading-5 text-[var(--arena-dim)]">{reason}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onDecide(windowId, tool.id, 'reject')}
                  className="arena-button-secondary inline-flex h-8 items-center gap-1.5 px-2 text-xs text-red-100"
                >
                  <XCircle size={13} />
                  拒绝
                </button>
                <button
                  type="button"
                  onClick={() => onDecide(windowId, tool.id, 'approve')}
                  className="arena-button-primary inline-flex h-8 items-center gap-1.5 px-2 text-xs"
                >
                  <CheckCircle2 size={13} />
                  批准执行
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
