'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Maximize2, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import Tooltip from './Tooltip';

interface Props {
  port: number;
  title: string;
}

export default function LivePreviewFrame({ port, title }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const url = `http://localhost:${port}`;

  const handleEsc = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') setFullscreen(false);
  }, []);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEsc);
    };
  }, [fullscreen, handleEsc]);

  const frame = (className: string, frameTitle: string) => (
    <iframe
      key={`${url}-${reloadKey}-${frameTitle}`}
      src={url}
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      className={className}
      title={frameTitle}
    />
  );

  const fullscreenLayer = fullscreen && typeof document !== 'undefined'
    ? createPortal(
      <div className="arena-preview-overlay">
        <div className="arena-preview-toolbar">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--arena-ink)]">{title}</div>
            <div className="text-xs text-[var(--arena-dim)]">{url} · Esc 或返回按钮退出</div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip label="刷新预览" side="bottom">
              <button
                onClick={() => setReloadKey((key) => key + 1)}
                className="arena-icon-button p-2"
                aria-label="刷新预览"
              >
                <RefreshCw size={16} />
              </button>
            </Tooltip>
            <Tooltip label="返回对话" side="bottom" align="end">
              <button
                onClick={() => setFullscreen(false)}
                className="arena-button-secondary inline-flex h-9 items-center gap-2 px-3 text-sm"
              >
                <ArrowLeft size={16} />
                返回对话
              </button>
            </Tooltip>
          </div>
        </div>
        {frame('arena-preview-frame', `${title} fullscreen`)}
      </div>,
      document.body
    )
    : null;

  return (
    <div className="arena-live-preview">
      {fullscreenLayer}
      <div className="arena-live-preview-toolbar">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--arena-ink)]">{title}</div>
          <a href={url} target="_blank" rel="noreferrer" className="truncate text-[11px] text-[var(--arena-dim)] hover:text-[var(--arena-accent-readable)]">
            {url}
          </a>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label="刷新预览" side="top">
            <button
              onClick={() => setReloadKey((key) => key + 1)}
              className="arena-icon-button p-1.5"
              aria-label="刷新预览"
            >
              <RefreshCw size={14} />
            </button>
          </Tooltip>
          <Tooltip label="新窗口打开" side="top">
            <a href={url} target="_blank" rel="noreferrer" className="arena-icon-button p-1.5" aria-label="新窗口打开预览">
              <ExternalLink size={14} />
            </a>
          </Tooltip>
          <Tooltip label="全屏预览" side="top" align="end">
            <button onClick={() => setFullscreen(true)} className="arena-icon-button p-1.5" aria-label="全屏预览">
              <Maximize2 size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      {frame('h-72 w-full border-0 bg-white', `${title} preview`)}
    </div>
  );
}
