'use client';
import type { CSSProperties } from 'react';
import { Check, Sparkles, Wrench } from 'lucide-react';
import { useArenaStore } from '@/stores/useArenaStore';
import { CAPABILITY_LABELS } from '@/lib/models';
import { ModelCapability } from '@/types';
import Tooltip from './Tooltip';
import CollapsibleSection from './CollapsibleSection';

const FILTERS: Array<{ value: ModelCapability | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'text', label: '文本' },
  { value: 'reasoning', label: '推理' },
  { value: 'vision', label: '视觉' },
  { value: 'image', label: '图片' },
  { value: 'tools', label: '工具' },
];

export default function ModelSelector() {
  const {
    models,
    selectedModelSlugs,
    capabilityFilter,
    toolsEnabled,
    config,
    toggleModel,
    setCapabilityFilter,
    setToolsEnabled,
  } = useArenaStore();

  const filteredModels =
    capabilityFilter === 'all'
      ? models
      : models.filter((model) => model.capabilities.includes(capabilityFilter));

  return (
    <CollapsibleSection
      title="模型与工具"
      summary={`已选 ${selectedModelSlugs.length}/${config?.maxSelectedModels || 6} · ${toolsEnabled ? '自动工具开' : '自动工具关'}`}
      defaultOpen={false}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => {
            const active = capabilityFilter === filter.value;
            return (
              <Tooltip key={filter.value} label={`只显示${filter.label}模型`} side="top">
                <button
                  onClick={() => setCapabilityFilter(filter.value)}
                  className={`arena-filter h-8 px-3 text-sm ${active ? 'is-active' : ''}`}
                >
                  {filter.label}
                </button>
              </Tooltip>
            );
          })}

          <Tooltip label="让支持内置工具的千问模型自动使用搜索、代码解释器等工具" side="top" align="end" className="ml-auto">
            <button
              onClick={() => setToolsEnabled(!toolsEnabled)}
              className={`flex h-8 items-center gap-1.5 px-3 text-sm ${
                toolsEnabled ? 'arena-button-primary' : 'arena-button-secondary'
              }`}
            >
              <Wrench size={15} />
              自动工具
            </button>
          </Tooltip>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredModels.map((model) => {
            const selected = selectedModelSlugs.includes(model.slug);
            const selectionFull =
              !selected && selectedModelSlugs.length >= (config?.maxSelectedModels || 6);

            return (
              <Tooltip
                key={model.slug}
                label={selected ? `从本次对比中移除 ${model.name}` : `加入本次对比：${model.name}`}
                side="top"
                align="start"
                className="w-full"
              >
                <button
                  onClick={() => toggleModel(model.slug)}
                  disabled={selectionFull}
                  style={{ '--model-color': model.color } as CSSProperties}
                  className={`arena-model-option p-3 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'is-selected' : ''}`}
                >
                  <div className="flex items-start gap-2">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-white/5" style={{ backgroundColor: model.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{model.name}</span>
                        {selected && <Check size={14} className="text-[var(--arena-accent-readable)]" />}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--arena-dim)]">
                        {model.provider} · {model.slug}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--arena-muted)]">
                    {model.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {model.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          selected ? 'border border-[var(--arena-accent-line)] bg-[var(--arena-accent-soft)] text-[var(--arena-accent-readable)]' : 'border border-white/[0.035] bg-white/[0.04] text-[var(--arena-muted)]'
                        }`}
                      >
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    ))}
                    {model.tools.length > 0 && (
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                        selected ? 'bg-[var(--arena-accent-soft)] text-[var(--arena-accent-readable)]' : 'bg-[var(--arena-warm-soft)] text-[var(--arena-warning)]'
                      }`}>
                        <Sparkles size={11} />
                        工具
                      </span>
                    )}
                  </div>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </CollapsibleSection>
  );
}
