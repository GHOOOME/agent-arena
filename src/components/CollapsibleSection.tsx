'use client';
import { ReactNode, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import Tooltip from './Tooltip';

interface CollapsibleSectionProps {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export default function CollapsibleSection({
  title,
  summary,
  children,
  defaultOpen = false,
  className = '',
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`arena-panel min-w-0 overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 bg-white/[0.018] px-3 py-3 sm:px-4">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
          aria-expanded={open}
        >
          <span className="arena-status-dot shrink-0" />
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }} className="shrink-0 text-[var(--arena-muted)]">
            <ChevronDown size={16} />
          </motion.span>
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--arena-ink)]">{title}</span>
          {summary && <span className="hidden truncate text-xs text-[var(--arena-dim)] sm:block">{summary}</span>}
        </button>
        <Tooltip label={open ? '收起这个区域' : '展开这个区域'} side="left">
          <button
            onClick={() => setOpen((value) => !value)}
            className="arena-button-secondary shrink-0 px-2.5 py-1 text-xs"
            aria-label={open ? '收起这个区域' : '展开这个区域'}
          >
            {open ? '收起' : '展开'}
          </button>
        </Tooltip>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-[var(--arena-line)]"
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
