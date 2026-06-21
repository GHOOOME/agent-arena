'use client';
import type { CSSProperties } from 'react';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Brain, Code, Eye, FileSearch, ImageIcon, Plus, Send, Timer } from 'lucide-react';
import { useArenaStore } from '@/stores/useArenaStore';
import StreamRenderer from './StreamRenderer';
import CodePreview from './CodePreview';
import CodePatchProposalPanel from './CodePatchProposalPanel';
import { extractPreviewHtml } from '@/lib/extractCode';
import { extractCodePatchProposal, stripCodePatchProposals } from '@/lib/codePatch';
import { DEFAULT_PROJECT_AGENT_PERMISSION, PROJECT_AGENT_PERMISSION_COPY } from '@/lib/agentPermissions';
import { CAPABILITY_LABELS } from '@/lib/models';
import Tooltip from './Tooltip';
import { MessageRecord, ProjectContextSelection } from '@/types';
import { useImeEnterSubmit } from '@/hooks/useImeEnterSubmit';

interface Props {
  modelSlug: string;
  index: number;
  onSendToModel: (modelSlug: string, prompt: string, projectContext?: ProjectContextSelection | null) => void;
  projectContext?: ProjectContextSelection | null;
}

function MessageBubble({ message, suppressPreviewSource = false }: { message: MessageRecord; suppressPreviewSource?: boolean }) {
  const isUser = message.role === 'user';
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  const messagePreview = !isUser && message.content.trim() ? extractPreviewHtml(message.content) : { hasPreview: false, html: '' };
  const shouldCollapseSource = suppressPreviewSource && messagePreview.hasPreview;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[92%] rounded-lg border px-3 py-2 text-sm leading-6 ${
          isUser
            ? 'border-[var(--arena-accent-line)] bg-[var(--arena-accent-soft)] text-[var(--arena-ink)]'
            : 'border-[var(--arena-line)] bg-white/[0.025] text-[var(--arena-ink)]'
        }`}
      >
        <div className="mb-1 text-[11px] text-[var(--arena-dim)]">
          {isUser ? '你' : '模型'}
        </div>
        {hasAttachments && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments?.map((attachment) => (
              <div key={attachment.id} className="h-14 w-14 overflow-hidden rounded border border-[var(--arena-line)] bg-[var(--arena-field)]">
                {attachment.dataUrl || attachment.publicUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attachment.dataUrl || attachment.publicUrl} alt={attachment.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center px-1 text-center text-[10px] text-[var(--arena-dim)]">{attachment.name}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {shouldCollapseSource ? (
          <div className="rounded-md border border-[var(--arena-line)] bg-[var(--arena-field)] px-3 py-2 text-xs leading-5 text-[var(--arena-muted)]">
            HTML 源码已折叠，下面可以直接预览。需要查看代码时切换到“源码”。
          </div>
        ) : message.content.trim() ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <StreamRenderer content={message.content} />
          )
        ) : (
          <div className="text-[var(--arena-dim)]">生成中...</div>
        )}
      </div>
    </div>
  );
}

export default function ModelCard({ modelSlug, index, onSendToModel, projectContext }: Props) {
  const model = useArenaStore((s) => s.models.find((m) => m.slug === modelSlug));
  const response = useArenaStore((s) => s.responses[modelSlug]);
  const activeConversationId = useArenaStore((s) => s.activeConversationIds[modelSlug]);
  const resetModelConversation = useArenaStore((s) => s.resetModelConversation);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [viewOverride, setViewOverride] = useState<{ key: string; mode: 'code' | 'preview' } | null>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const responseContent = response?.content || '';
  const isActiveStream = Boolean(response && !response.done);
  const codePatchProposal = responseContent ? extractCodePatchProposal(responseContent) : null;
  const visibleContent = codePatchProposal ? stripCodePatchProposals(responseContent) : responseContent;
  const preview = visibleContent ? extractPreviewHtml(visibleContent) : { hasPreview: false, html: '' };
  const transcriptMessages = response?.messages || [];
  const responseViewKey = response?.runResultId || String(response?.startTime || 'empty');
  const viewMode =
    viewOverride?.key === responseViewKey
      ? viewOverride.mode
      : response?.done && preview.hasPreview
        ? 'preview'
        : 'code';
  const activePermissionMode =
    projectContext?.permissionMode ||
    response?.projectContext?.permissionMode ||
    DEFAULT_PROJECT_AGENT_PERMISSION;
  const permissionCopy = PROJECT_AGENT_PERMISSION_COPY[activePermissionMode];
  const canSendLocal = !!model && !model.capabilities.includes('image') && !isActiveStream && localPrompt.trim().length > 0;
  const sendLocalPrompt = () => {
    if (!model || !canSendLocal) return;
    onSendToModel(model.slug, localPrompt.trim(), projectContext);
    setLocalPrompt('');
  };
  const localImeSubmit = useImeEnterSubmit(sendLocalPrompt, canSendLocal);

  useEffect(() => {
    if (isActiveStream && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isActiveStream, response?.content, response?.reasoning]);

  if (!model) return null;

  const elapsed = response?.endTime && response?.startTime
    ? ((response.endTime - response.startTime) / 1000).toFixed(1)
    : null;

  const isReasoning = response && !response.done && response.reasoning && !response.content;
  const isTextModel = !model.capabilities.includes('image');
  const waitingLabel = response?.status === 'queued'
    ? '排队中...'
    : response?.status === 'reading_project'
      ? '项目 Agent 正在读文件...'
      : '等待响应...';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      style={{ '--model-color': model.color } as CSSProperties}
      className={`arena-model-card ${isActiveStream ? 'is-streaming' : ''}`}
    >
      {/* Streaming light bar */}
      {response && !response.done && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <div
            className="arena-stream-line h-full w-1/3 rounded-full"
            style={{ backgroundColor: model.color }}
          />
        </div>
      )}

      {/* Header */}
      <div className="arena-model-card-header flex flex-wrap items-center gap-2 border-b border-[var(--arena-line)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/5" style={{ backgroundColor: model.color }} />
        <span className="text-sm font-medium text-[var(--arena-ink)]">{model.name}</span>
        <span className="text-xs text-[var(--arena-dim)]">{model.provider}</span>
        {activeConversationId && (
          <span className="arena-chip px-2 py-0.5 text-[11px]">
            会话 {activeConversationId.slice(-6)}
          </span>
        )}
        <Tooltip label="为该模型开启新对话" side="top" align="end" className="ml-auto">
          <button
            onClick={() => resetModelConversation(model.slug)}
            className="arena-icon-button p-1.5"
          >
            <Plus size={15} />
          </button>
        </Tooltip>
        {elapsed && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--arena-dim)]">
            <Timer size={12} />
            {elapsed}s
          </span>
        )}
        {response?.tokensPerSecond && response.done && (
          <span className="text-xs text-[var(--arena-faint)]">{response.tokensPerSecond.toFixed(1)} t/s</span>
        )}
        {response?.done && preview.hasPreview && (
          <div className="ml-2 flex items-center rounded-lg border border-[var(--arena-line)] bg-[var(--arena-field)] p-0.5">
            <Tooltip label="查看模型输出的源码" side="top">
              <button
                onClick={() => setViewOverride({ key: responseViewKey, mode: 'code' })}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                  viewMode === 'code' ? 'bg-[var(--arena-accent-soft)] text-[var(--arena-accent-readable)]' : 'text-[var(--arena-muted)] hover:text-[var(--arena-ink)]'
                }`}
              >
                <Code size={12} />
                源码
              </button>
            </Tooltip>
            <Tooltip label="预览模型生成的 HTML" side="top" align="end">
              <button
                onClick={() => setViewOverride({ key: responseViewKey, mode: 'preview' })}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                  viewMode === 'preview' ? 'bg-[var(--arena-accent-soft)] text-[var(--arena-accent-readable)]' : 'text-[var(--arena-muted)] hover:text-[var(--arena-ink)]'
                }`}
              >
                <Eye size={12} />
                预览
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="border-b border-[var(--arena-line)] px-4 py-3">
        <p className="text-xs leading-5 text-[var(--arena-muted)]">{model.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {model.capabilities.map((capability) => (
            <span key={capability} className="rounded border border-white/[0.035] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-[var(--arena-muted)]">
              {CAPABILITY_LABELS[capability]}
            </span>
          ))}
          {model.bestFor.slice(0, 3).map((item) => (
            <span key={item} className="rounded border border-[var(--arena-line)] bg-[var(--arena-field)] px-1.5 py-0.5 text-[11px] text-[var(--arena-dim)]">
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="scrollbar-thin max-h-[500px] flex-1 overflow-y-auto p-4">
        {response?.error ? (
          <>
            {transcriptMessages.length > 0 && (
              <div className="mb-3 space-y-3">
                {transcriptMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} suppressPreviewSource={viewMode === 'preview'} />
                ))}
              </div>
            )}
            <p className="rounded-lg border border-red-300/30 bg-red-950/20 px-3 py-2 text-sm text-red-100">{response.error}</p>
          </>
        ) : (
          <>
            {response?.agentStatus && (
              <div className="arena-chip-active mb-3 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <FileSearch size={14} />
                  <span>{response.agentStatus}</span>
                </div>
                {response.projectContext && (
                  <div className="mt-2 text-[var(--arena-muted)]">
                    <div>
                      自动读取 {response.projectContext.fileCount} 个文件
                      {response.projectContext.fallback ? ' · 本地关键词兜底' : ''}
                      {response.projectContext.writeEnabled ? ' · 可提修改' : ''}
                      {response.projectContext.permissionMode ? ` · ${PROJECT_AGENT_PERMISSION_COPY[response.projectContext.permissionMode].title}` : ''}
                    </div>
                    {response.projectContext.files && response.projectContext.files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {response.projectContext.files.slice(0, 8).map((file) => (
                          <span key={file} className="max-w-full truncate rounded bg-black/25 px-1.5 py-0.5 text-[11px] text-[var(--arena-ink)]">
                            {file}
                          </span>
                        ))}
                        {response.projectContext.files.length > 8 && (
                          <span className="rounded bg-black/25 px-1.5 py-0.5 text-[11px] text-[var(--arena-dim)]">
                            +{response.projectContext.files.length - 8}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Reasoning section */}
            {response?.reasoning && (
              <div className="mb-3">
                <Tooltip label={reasoningOpen ? '收起思考过程' : '展开思考过程'} side="top" align="start">
                  <button
                    onClick={() => setReasoningOpen(!reasoningOpen)}
                    className="mb-1 flex items-center gap-1.5 text-xs text-[var(--arena-muted)] transition-colors hover:text-[var(--arena-ink)]"
                  >
                    <Brain size={14} />
                    <span>思考过程</span>
                    {isReasoning && (
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        className="text-[var(--arena-warning)]"
                      >
                        思考中...
                      </motion.span>
                    )}
                    {reasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </Tooltip>
                {reasoningOpen && (
                  <div className="scrollbar-thin max-h-[200px] overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--arena-accent-line)] pl-3 text-xs leading-relaxed text-[var(--arena-muted)]">
                    {response.reasoning}
                  </div>
                )}
              </div>
            )}

            {/* Main content */}
            {response?.assets && response.assets.length > 0 && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                {response.assets.map((asset) => (
                  <a key={asset.id} href={asset.publicUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-[var(--arena-line)] transition-colors hover:border-[var(--arena-line-strong)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.publicUrl} alt={asset.prompt || model.name} className="aspect-square w-full object-cover" />
                  </a>
                ))}
              </div>
            )}

            {codePatchProposal && (
              <CodePatchProposalPanel
                proposal={codePatchProposal}
                projectPath={projectContext?.projectPath || response?.projectContext?.projectPath}
                permissionMode={activePermissionMode}
              />
            )}

            {transcriptMessages.length > 0 ? (
              <div className="space-y-3">
                {transcriptMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} suppressPreviewSource={viewMode === 'preview'} />
                ))}
                {viewMode === 'preview' && preview.hasPreview && (
                  <CodePreview html={preview.html} />
                )}
              </div>
            ) : visibleContent ? (
              viewMode === 'preview' && preview.hasPreview ? (
                <CodePreview html={preview.html} />
              ) : (
                <StreamRenderer content={visibleContent} />
              )
            ) : response && !response.reasoning && !codePatchProposal ? (
              <div className="flex items-center gap-2 text-sm text-[var(--arena-dim)]">
                <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                  {waitingLabel}
                </motion.span>
              </div>
            ) : !response ? (
              <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-[var(--arena-faint)]">
                {model.capabilities.includes('image') ? <ImageIcon size={22} /> : <Brain size={22} />}
                <p className="text-sm">
                  {model.capabilities.includes('image') ? '在图片生成面板输入提示词。' : '等待你的问题。'}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-[var(--arena-line)] p-3">
        {isTextModel ? (
          <>
            {projectContext?.mode === 'agent' && projectContext.projectPath && (
              <div className="mb-2 text-[11px] text-[var(--arena-accent-readable)]">
                单独追问也会启用项目 Agent：{projectContext.projectPath} · {permissionCopy.title}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
              <textarea
                value={localPrompt}
                onChange={(event) => setLocalPrompt(event.target.value)}
                onCompositionStart={localImeSubmit.onCompositionStart}
                onCompositionEnd={localImeSubmit.onCompositionEnd}
                onKeyDown={localImeSubmit.onKeyDown}
                placeholder={`只问 ${model.name}`}
                disabled={isActiveStream}
                rows={1}
                className="arena-input max-h-28 min-h-10 min-w-0 resize-none px-3 py-2 text-sm leading-5 disabled:opacity-50"
              />
              <Tooltip label={`只发送给 ${model.name}`} side="top" align="end">
                <button
                  onClick={() => {
                    sendLocalPrompt();
                  }}
                  disabled={!canSendLocal}
                  className="arena-button-primary inline-flex h-10 w-10 items-center justify-center disabled:opacity-30"
                >
                  <Send size={16} />
                </button>
              </Tooltip>
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--arena-dim)]">图片模型请使用上方图片生成面板。</p>
        )}
      </div>
    </motion.div>
  );
}
