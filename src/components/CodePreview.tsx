'use client';
import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import Tooltip from './Tooltip';

interface Props {
  html: string;
}

export default function CodePreview({ html }: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setFullscreen(false);
  }, []);

  useEffect(() => {
    if (fullscreen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleEsc);
      return () => {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener('keydown', handleEsc);
      };
    }
  }, [fullscreen, handleEsc]);

  const fullscreenLayer = fullscreen && typeof document !== 'undefined'
    ? createPortal(
      <div className="arena-preview-overlay">
        <div className="arena-preview-toolbar">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--arena-ink)]">HTML 预览</div>
            <div className="text-xs text-[var(--arena-dim)]">Esc 或返回按钮退出</div>
          </div>
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
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="arena-preview-frame"
          title="preview-fullscreen"
        />
      </div>,
      document.body
    )
    : null;

  return (
    <div className="relative group">
      {fullscreenLayer}
      <Tooltip label="全屏预览" side="left" className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setFullscreen(true)}
          className="arena-icon-button bg-[rgba(0,0,0,0.56)] p-1 text-[var(--arena-ink)]"
        >
          <Maximize2 size={14} />
        </button>
      </Tooltip>
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        className="h-[400px] w-full rounded-lg border border-[var(--arena-line)] bg-white"
        title="preview"
      />
    </div>
  );
}
