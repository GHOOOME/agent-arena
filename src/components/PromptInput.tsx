'use client';
import { useState, useRef, useCallback } from 'react';
import { ImagePlus, Send, Square, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { DEFAULT_PROJECT_AGENT_PERMISSION, PROJECT_AGENT_PERMISSION_COPY } from '@/lib/agentPermissions';
import { ProjectContextSelection, PromptAttachment } from '@/types';
import Tooltip from './Tooltip';
import { useImeEnterSubmit } from '@/hooks/useImeEnterSubmit';

interface Props {
  onSend: (prompt: string, attachments: PromptAttachment[], projectContext?: ProjectContextSelection | null) => void;
  onStop: () => void;
  isStreaming: boolean;
  projectContext?: ProjectContextSelection | null;
}

export default function PromptInput({ onSend, onStop, isStreaming, projectContext }: Props) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const permissionCopy = projectContext?.permissionMode
    ? PROJECT_AGENT_PERMISSION_COPY[projectContext.permissionMode]
    : PROJECT_AGENT_PERMISSION_COPY[DEFAULT_PROJECT_AGENT_PERMISSION];

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim(), attachments, projectContext);
    setInput('');
    setAttachments([]);
  }, [attachments, input, isStreaming, onSend, projectContext]);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const images = [...files].filter((file) => file.type.startsWith('image/')).slice(0, 4);
    const loaded = await Promise.all(
      images.map(
        (file) =>
          new Promise<PromptAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                dataUrl: String(reader.result),
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachments((current) => [...current, ...loaded].slice(0, 4));
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const imeSubmit = useImeEnterSubmit(handleSend, Boolean(input.trim()) && !isStreaming);

  return (
    <motion.div
      className="arena-animate-in relative mx-auto w-full max-w-4xl"
      animate={isStreaming ? { y: [0, -1, 0] } : {}}
      transition={isStreaming ? { repeat: Infinity, duration: 1.8, ease: 'easeInOut' } : {}}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="arena-card group relative h-16 w-16 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
              <Tooltip label="移除这张图片" side="top" align="end" className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  className="rounded border border-[var(--arena-line)] bg-[var(--arena-panel-strong)] p-0.5 text-[var(--arena-ink)]"
                >
                  <X size={12} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
      {projectContext?.mode === 'agent' && projectContext.projectPath && (
        <div className="arena-chip-active mb-2 rounded-lg px-3 py-2 text-xs">
          本次会启用项目 Agent：{projectContext.projectPath} · {permissionCopy.title}
          {projectContext.permissionMode === 'request_approval' ? ' · 自动工具需审批，当前不会自动调用' : ' · 可生成修改提案'}
        </div>
      )}
      <div className="arena-panel arena-prompt-panel overflow-hidden border-[var(--arena-line-strong)]">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={imeSubmit.onCompositionStart}
          onCompositionEnd={imeSubmit.onCompositionEnd}
          onKeyDown={imeSubmit.onKeyDown}
          placeholder="输入你的问题；上传图片时只会发送给支持视觉理解的模型..."
          rows={3}
          className="min-h-28 w-full resize-none bg-transparent px-5 py-4 text-[var(--arena-ink)] placeholder-[var(--arena-dim)] focus:outline-none"
        />
        <div className="flex flex-col gap-3 border-t border-[var(--arena-line)] bg-white/[0.018] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap gap-2">
            <span className="arena-chip px-2.5 py-1 text-xs">Enter 发送</span>
            <span className="arena-chip px-2.5 py-1 text-xs">Shift Enter 换行</span>
            <span className="arena-chip px-2.5 py-1 text-xs">{attachments.length}/4 图片</span>
          </div>
          <div className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto sm:justify-end">
            <Tooltip label="上传图片给视觉模型提问" side="top" className="w-11 sm:w-auto">
              <button
                onClick={() => fileRef.current?.click()}
                className="arena-icon-button w-full p-2 sm:w-auto"
                disabled={isStreaming}
              >
                <ImagePlus size={18} />
              </button>
            </Tooltip>
            <Tooltip label={isStreaming ? '停止当前生成' : '发送给选中的模型'} side="top" align="end" className="min-w-0 flex-1 sm:flex-none">
              <button
                onClick={isStreaming ? onStop : handleSend}
                className={`inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 px-3 text-sm sm:min-w-24 ${isStreaming ? 'arena-button-secondary border-red-300/40 text-red-100 hover:bg-red-950/30' : 'arena-button-primary'}`}
                disabled={!isStreaming && !input.trim()}
              >
                {isStreaming ? <Square size={17} /> : <Send size={17} />}
                {isStreaming ? '停止' : '发送'}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => addFiles(event.target.files)}
      />
    </motion.div>
  );
}
