'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../Tooltip';

interface ArenaConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ArenaConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  tone = 'default',
  onConfirm,
  onCancel,
}: ArenaConfirmDialogProps) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="arena-confirm-backdrop" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="arena-confirm-title"
        aria-describedby="arena-confirm-description"
        className="arena-confirm-dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className={`arena-confirm-icon ${tone === 'danger' ? 'is-danger' : ''}`}>
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0">
              <h2 id="arena-confirm-title" className="text-base font-semibold text-[var(--arena-ink)]">
                {title}
              </h2>
              <p id="arena-confirm-description" className="mt-2 text-sm leading-6 text-[var(--arena-muted)]">
                {description}
              </p>
            </div>
          </div>
          <Tooltip label="关闭" side="left">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="arena-icon-button p-1.5 disabled:opacity-40"
              aria-label="关闭确认弹窗"
            >
              <X size={16} />
            </button>
          </Tooltip>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="arena-button-secondary h-9 px-3 text-sm disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`h-9 px-3 text-sm disabled:opacity-40 ${
              tone === 'danger' ? 'arena-button-danger' : 'arena-button-primary'
            }`}
          >
            {busy ? '处理中...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
