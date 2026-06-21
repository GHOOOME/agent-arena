'use client';
import dynamic from 'next/dynamic';

function supportsLookbehind(): boolean {
  try {
    new RegExp('(?<=test)');
    return true;
  } catch {
    return false;
  }
}

const DynamicMarkdown = dynamic(
  () =>
    import('react-markdown').then((mod) => {
      const ReactMarkdown = mod.default;
      if (supportsLookbehind()) {
        return import('remark-gfm').then((gfmMod) => {
          const remarkGfm = gfmMod.default;
          return function MarkdownWrapper({ children }: { children: string }) {
            return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
          };
        });
      }
      return function MarkdownWrapper({ children }: { children: string }) {
        return <ReactMarkdown>{children}</ReactMarkdown>;
      };
    }),
  { ssr: false }
);

export default function StreamRenderer({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="stream-markdown prose prose-invert prose-sm max-w-none prose-code:text-[var(--arena-accent-readable)] prose-pre:rounded-xl prose-pre:bg-[var(--arena-field)]">
      <DynamicMarkdown>{content}</DynamicMarkdown>
    </div>
  );
}
