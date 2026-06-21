'use client';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, MessageSquare, Square, Trash2, X } from 'lucide-react';
import { useArenaStore } from '@/stores/useArenaStore';
import Tooltip from './Tooltip';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HistoryDrawer({ open, onClose }: Props) {
  const conversations = useArenaStore((s) => s.conversations);
  const models = useArenaStore((s) => s.models);
  const setConversations = useArenaStore((s) => s.setConversations);
  const loadConversationIntoArena = useArenaStore((s) => s.loadConversationIntoArena);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  async function refresh() {
    const response = await fetch('/api/conversations');
    if (!response.ok) return;
    const data = await response.json();
    setConversations(data.conversations || []);
    setSelectedIds((current) => current.filter((id) => data.conversations?.some((conversation: { id: string }) => conversation.id === id)));
  }

  async function openConversation(id: string) {
    const response = await fetch(`/api/conversations/${id}`);
    if (!response.ok) return;
    const data = await response.json();
    loadConversationIntoArena(data.conversation);
    onClose();
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setSelectedIds((current) => current.filter((item) => item !== id));
    await refresh();
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => fetch(`/api/conversations/${id}`, { method: 'DELETE' })));
    setSelectedIds([]);
    await refresh();
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function selectAll() {
    setSelectedIds(conversations.map((conversation) => conversation.id));
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--arena-line)] bg-[var(--arena-panel-strong)] shadow-[-8px_0_8px_rgba(0,0,0,0.22)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--arena-line)] p-4">
              <div>
                <h2 className="font-medium text-[var(--arena-ink)]">模型会话</h2>
                <p className="mt-0.5 text-xs text-[var(--arena-dim)]">载入、勾选或批量删除历史会话</p>
              </div>
              <div className="flex gap-2">
                <Tooltip label="刷新历史会话" side="bottom">
                  <button onClick={refresh} className="arena-icon-button p-1.5" aria-label="刷新历史"><MessageSquare size={18} /></button>
                </Tooltip>
                <Tooltip label="关闭历史面板" side="bottom" align="end">
                  <button onClick={onClose} className="arena-icon-button p-1.5" aria-label="关闭历史"><X size={18} /></button>
                </Tooltip>
              </div>
            </div>
            {conversations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--arena-line)] px-4 py-3">
                <button
                  onClick={selectedIds.length === conversations.length ? () => setSelectedIds([]) : selectAll}
                  className="arena-button-secondary inline-flex items-center gap-1.5 px-2 py-1 text-xs"
                >
                  {selectedIds.length === conversations.length ? <CheckSquare size={13} /> : <Square size={13} />}
                  {selectedIds.length === conversations.length ? '清空选择' : '全选'}
                </button>
                <span className="text-xs text-[var(--arena-dim)]">已选 {selectedIds.length}</span>
                <Tooltip label="删除已勾选的历史会话" side="bottom" align="end" className="ml-auto">
                  <button
                    onClick={deleteSelected}
                    disabled={selectedIds.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/30 px-2 py-1 text-xs text-red-100 transition-colors hover:bg-red-950/30 disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                    批量删除
                  </button>
                </Tooltip>
              </div>
            )}
            <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
              {conversations.length === 0 ? (
                <p className="arena-panel mt-8 p-6 text-center text-sm text-[var(--arena-dim)]">暂无历史记录</p>
              ) : (
                conversations.map((conversation) => {
                  const model = models.find((item) => item.slug === conversation.modelSlug);
                  return (
                    <div key={conversation.id} className="arena-card p-3 transition-colors hover:border-[var(--arena-line-strong)]">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleSelected(conversation.id)}
                          className="arena-icon-button mt-0.5 shrink-0 p-0.5"
                          aria-label={selectedSet.has(conversation.id) ? '取消选择会话' : '选择会话'}
                        >
                          {selectedSet.has(conversation.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <Tooltip label="载入这段会话到 Arena" side="top" align="start" className="block w-full">
                            <button onClick={() => openConversation(conversation.id)} className="block w-full text-left">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: model?.color || '#737373' }} />
                                <span className="truncate text-sm font-medium text-[var(--arena-ink)]">{conversation.title}</span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--arena-dim)]">
                                {model?.name || conversation.modelSlug} · {conversation.messageCount} 条消息
                              </p>
                              {conversation.lastMessage && (
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--arena-muted)]">{conversation.lastMessage}</p>
                              )}
                              <p className="mt-2 text-xs text-[var(--arena-faint)]">{new Date(conversation.updatedAt).toLocaleString()}</p>
                            </button>
                          </Tooltip>
                          <Tooltip label="删除这段会话" side="top" align="start">
                            <button
                              onClick={() => deleteConversation(conversation.id)}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--arena-dim)] transition-colors hover:text-red-200"
                            >
                              <Trash2 size={13} />
                              删除
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
