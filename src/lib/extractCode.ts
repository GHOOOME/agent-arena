interface CodeBlock {
  lang: string;
  code: string;
}

interface PreviewResult {
  hasPreview: boolean;
  html: string;
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const regex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const blocks: CodeBlock[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({ lang: (match[1] || '').toLowerCase(), code: match[2].trim() });
  }
  return blocks;
}

function isReactCode(lang: string, code: string): boolean {
  if (['jsx', 'tsx', 'react'].includes(lang)) return true;
  if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
    return /import\s+React|from\s+['"]react['"]|<\w+[\s/>]/.test(code);
  }
  return false;
}

function wrapReactHtml(code: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"><\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
</head><body>
<div id="root"></div>
<script type="text/babel">
${code}

// Auto-mount: find the default export or common component names
const _exports = typeof App !== 'undefined' ? App
  : typeof Main !== 'undefined' ? Main
  : typeof Home !== 'undefined' ? Home
  : typeof Page !== 'undefined' ? Page
  : typeof ShoppingCart !== 'undefined' ? ShoppingCart
  : typeof Cart !== 'undefined' ? Cart
  : typeof Component !== 'undefined' ? Component
  : null;

if (_exports) {
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_exports));
} else {
  document.getElementById('root').innerHTML = '<p style="color:red;padding:20px;">No component found to render.</p>';
}
</script></body></html>`;
}

function assembleHtmlDoc(blocks: CodeBlock[]): string {
  const htmlBlocks = blocks.filter((b) => b.lang === 'html');
  const cssBlocks = blocks.filter((b) => b.lang === 'css');
  const jsBlocks = blocks.filter((b) => ['javascript', 'js'].includes(b.lang) && !isReactCode(b.lang, b.code));

  const css = cssBlocks.map((b) => b.code).join('\n');
  const js = jsBlocks.map((b) => b.code).join('\n');
  const htmlBody = htmlBlocks.map((b) => b.code).join('\n');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<script src="https://cdn.tailwindcss.com"><\/script>
${css ? `<style>${css}</style>` : ''}
</head><body>
${htmlBody}
${js ? `<script>${js}<\/script>` : ''}
</body></html>`;
}

export function extractPreviewHtml(content: string): PreviewResult {
  const blocks = extractCodeBlocks(content);
  if (blocks.length === 0) {
    const trimmed = content.trim();
    if (/^(?:<!doctype\s+html>|<html[\s>])/i.test(trimmed)) {
      return { hasPreview: true, html: trimmed };
    }
    return { hasPreview: false, html: '' };
  }

  // Check for React/JSX code first
  const reactBlock = blocks.find((b) => isReactCode(b.lang, b.code));
  if (reactBlock) {
    return { hasPreview: true, html: wrapReactHtml(reactBlock.code) };
  }

  // Check for HTML blocks
  const htmlBlocks = blocks.filter((b) => b.lang === 'html');
  if (htmlBlocks.length > 0) {
    // If the HTML block looks like a full document, use it directly
    const first = htmlBlocks[0];
    if (first.code.includes('<!DOCTYPE') || first.code.includes('<html')) {
      return { hasPreview: true, html: first.code };
    }
    // Otherwise assemble from parts
    return { hasPreview: true, html: assembleHtmlDoc(blocks) };
  }

  return { hasPreview: false, html: '' };
}
