'use client';
import { useArenaStore } from '@/stores/useArenaStore';
import ModelCard from './ModelCard';
import { ProjectContextSelection } from '@/types';

interface Props {
  onSendToModel: (modelSlug: string, prompt: string, projectContext?: ProjectContextSelection | null) => void;
  projectContext?: ProjectContextSelection | null;
}

export default function ArenaGrid({ onSendToModel, projectContext }: Props) {
  const selectedModelSlugs = useArenaStore((s) => s.selectedModelSlugs);

  const cols = selectedModelSlugs.length <= 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2';

  if (selectedModelSlugs.length === 0) {
    return (
      <div className="arena-panel arena-animate-in p-8 text-center text-sm text-[var(--arena-dim)]">
        选择一个或多个模型后开始对比。
      </div>
    );
  }

  return (
    <div className={`grid ${cols} gap-4`}>
      {selectedModelSlugs.map((slug, i) => (
        <ModelCard
          key={slug}
          modelSlug={slug}
          index={i}
          onSendToModel={onSendToModel}
          projectContext={projectContext}
        />
      ))}
    </div>
  );
}
