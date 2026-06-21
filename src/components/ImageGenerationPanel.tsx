'use client';
import { useMemo, useState } from 'react';
import { ImageIcon, Loader2, Wand2 } from 'lucide-react';
import { useArenaStore } from '@/stores/useArenaStore';
import Tooltip from './Tooltip';
import CollapsibleSection from './CollapsibleSection';
import { useImeEnterSubmit } from '@/hooks/useImeEnterSubmit';
import ArenaSelect from './ui/ArenaSelect';

const SIZES = ['1024*1024', '1536*1024', '1024*1536', '2048*2048', '2304*1728', '1728*2304'];
const SIZE_OPTIONS = SIZES.map((value) => ({ value, label: value }));

export default function ImageGenerationPanel() {
  const models = useArenaStore((s) => s.models);
  const selectedModelSlugs = useArenaStore((s) => s.selectedModelSlugs);
  const activeConversationIds = useArenaStore((s) => s.activeConversationIds);
  const setActiveConversation = useArenaStore((s) => s.setActiveConversation);
  const updateResponse = useArenaStore((s) => s.updateResponse);
  const setConversations = useArenaStore((s) => s.setConversations);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [size, setSize] = useState('2048*2048');
  const [count, setCount] = useState(1);
  const [promptExtend, setPromptExtend] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [generating, setGenerating] = useState(false);

  const imageModels = useMemo(
    () => models.filter((model) => model.capabilities.includes('image')),
    [models]
  );
  const selectedImageModels = imageModels.filter((model) => selectedModelSlugs.includes(model.slug));

  async function refreshConversations() {
    const response = await fetch('/api/conversations');
    if (response.ok) {
      const data = await response.json();
      setConversations(data.conversations || []);
    }
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || generating || selectedImageModels.length === 0) return;
    setGenerating(true);

    await Promise.allSettled(
      selectedImageModels.map(async (model) => {
        const startTime = Date.now();
        updateResponse(model.slug, {
          modelSlug: model.slug,
          content: '',
          done: false,
          startTime,
          status: 'running',
        });

        try {
          const response = await fetch('/api/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelSlug: model.slug,
              prompt: text,
              negativePrompt,
              size,
              count,
              promptExtend,
              watermark,
              conversationId: activeConversationIds[model.slug],
            }),
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`HTTP ${response.status}: ${body}`);
          }

          const data = await response.json();
          if (data.conversationId) {
            setActiveConversation(model.slug, data.conversationId);
          }
          updateResponse(model.slug, {
            conversationId: data.conversationId,
            runResultId: data.runResultId,
            content: `已生成 ${data.assets?.length || 0} 张图片。`,
            assets: data.assets || [],
            done: true,
            startTime,
            endTime: Date.now(),
            status: 'completed',
          });
        } catch (error) {
          updateResponse(model.slug, {
            error: error instanceof Error ? error.message : String(error),
            done: true,
            startTime,
            endTime: Date.now(),
            status: 'failed',
          });
        }
      })
    );

    setGenerating(false);
    await refreshConversations();
  }

  const promptImeSubmit = useImeEnterSubmit(() => void generate(), Boolean(prompt.trim()) && !generating && selectedImageModels.length > 0);

  if (imageModels.length === 0) return null;

  return (
    <CollapsibleSection
      title="图片生成"
      summary={`选中图片模型后生效：${selectedImageModels.length}/${imageModels.length}`}
      defaultOpen={false}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-[var(--arena-ink)]">
          <ImageIcon size={18} />
          <h2 className="text-sm font-semibold">图片生成</h2>
        </div>
        <span className="text-xs text-[var(--arena-dim)]">
          选中图片模型后生效：{selectedImageModels.length}/{imageModels.length}
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onCompositionStart={promptImeSubmit.onCompositionStart}
          onCompositionEnd={promptImeSubmit.onCompositionEnd}
          onKeyDown={promptImeSubmit.onKeyDown}
          rows={4}
          placeholder="输入图片提示词；Enter 生成，Shift Enter 换行..."
          className="arena-input min-h-28 resize-none px-4 py-3 text-sm"
        />

        <div className="space-y-2">
          <input
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            placeholder="反向提示词"
            className="arena-input h-9 w-full px-3 text-sm"
          />
          <ArenaSelect
            value={size}
            onChange={setSize}
            options={SIZE_OPTIONS}
            ariaLabel="图片尺寸"
            className="h-9 w-full px-3 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="arena-input flex h-9 items-center gap-2 px-3 text-xs text-[var(--arena-muted)]">
              <input
                type="number"
                min={1}
                max={4}
                value={count}
                onChange={(event) => setCount(Math.min(Math.max(Number(event.target.value), 1), 4))}
                className="w-10 bg-transparent text-[var(--arena-ink)] focus:outline-none"
              />
              张
            </label>
            <Tooltip label="让模型先优化图片提示词" side="top" align="end" className="h-9">
              <button
                onClick={() => setPromptExtend(!promptExtend)}
                className={`h-9 w-full rounded-lg border px-3 text-xs transition-colors ${
                  promptExtend ? 'arena-chip-active' : 'arena-button-secondary'
                }`}
              >
                扩写
              </button>
            </Tooltip>
          </div>
          <Tooltip label="控制生成图片是否带水印" side="top" align="end" className="w-full">
            <button
              onClick={() => setWatermark(!watermark)}
              className={`h-9 w-full rounded-lg border px-3 text-xs transition-colors ${
                watermark ? 'border-orange-300/40 bg-orange-500/10 text-orange-100' : 'arena-button-secondary'
              }`}
            >
              水印 {watermark ? '开' : '关'}
            </button>
          </Tooltip>
        </div>
      </div>

      <Tooltip label="使用已选图片模型生成图片" side="top" align="start" className="mt-3">
        <button
          onClick={generate}
          disabled={!prompt.trim() || generating || selectedImageModels.length === 0}
          className="arena-button-primary inline-flex h-9 items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {generating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          生成图片
        </button>
      </Tooltip>
    </CollapsibleSection>
  );
}
