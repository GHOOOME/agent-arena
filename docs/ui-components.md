# UI Components

Reusable interface components for Token Plan Arena. Keep new product UI consistent by using these before adding local one-off controls.

## ArenaSelect

Path: `src/components/ui/ArenaSelect.tsx`

Use `ArenaSelect` for all dropdown/select interactions. Do not add native `<select>` controls in product surfaces.

```tsx
import ArenaSelect from '@/components/ui/ArenaSelect';

<ArenaSelect
  value={modelSlug}
  onChange={setModelSlug}
  ariaLabel="窗口模型"
  options={[
    { value: 'qwen3.7-max', label: 'Qwen 3.7 Max', description: '千问 · 复杂分析 / 代码辅助' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'DeepSeek · 代码审查 / 系统设计' },
  ]}
  className="h-9 w-full px-3 text-sm"
/>
```

### Rules

- Menus render through a portal, so they are not clipped by scroll containers or window cards.
- Provide an `ariaLabel` that names the control.
- Use short labels and put extra context in `description`.
- Keep trigger sizing explicit with utility classes such as `h-9`, `w-full`, `px-3`, and `text-sm`.
- Do not style a dropdown differently for one local use case; extend the shared component if a pattern repeats.

## ArenaConfirmDialog

Path: `src/components/ui/ArenaConfirmDialog.tsx`

Use `ArenaConfirmDialog` for destructive, high-risk, or irreversible local actions. Do not use browser-native `window.confirm` in product surfaces.

```tsx
import ArenaConfirmDialog from '@/components/ui/ArenaConfirmDialog';

<ArenaConfirmDialog
  open={Boolean(pendingAction)}
  title="应用窗口改动"
  description="将这个窗口的安全文件改动写回原项目。删除文件不会自动执行。"
  confirmLabel="应用合并"
  tone="danger"
  busy={saving}
  onConfirm={runAction}
  onCancel={closeDialog}
/>
```

### Rules

- Keep the title short and name the concrete action.
- The description must say what changes and what safety boundary applies.
- Use `tone="danger"` only for destructive or project-writing actions.
- While `busy` is true, keep the dialog open and disable escape/cancel.

## Cursor And Interaction

- Clickable controls must use a semantic interactive element whenever possible, especially `<button>` and `<a>`.
- For custom clickable surfaces that are not native controls, add `data-clickable="true"`.
- Disabled states must keep `cursor: not-allowed` and visible reduced opacity.

## Visual Direction

- The app uses black as the dominant surface: dark background, quiet panels, thin borders.
- Cyan is the primary action and selection accent. Coral is reserved for danger. Warm warning colors must stay tiny and semantic.
- Avoid large yellow fields, green-wash surfaces, marketing gradients, heavy glow, and decorative color washes.
