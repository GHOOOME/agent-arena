# Work / Window / Race Implementation Checklist

This document tracks the local Agent workbench migration. Keep it updated as work lands so future sessions can resume without guessing.

## Phase Checklist

- [x] Create this implementation tracker.
- [x] Add Prisma models for Work, WorkWindow, WindowMessage, Race, RaceParticipant, WorkspaceBranch, and ToolRun.
- [x] Add Work/Window/Race API routes.
- [x] Add window-scoped streaming chat with isolated memory.
- [x] Replace the default page with the Workbench UI.
- [x] Add per-window model, permission, branch, preview, and tool status surfaces.
- [x] Add git worktree branch creation with a safe `needs_git` fallback for non-git projects.
- [x] Add controlled ToolRun logging for branch setup and project context reads.
- [x] Verify Prisma migration, lint, and TypeScript.
- [x] Browser smoke test and interaction polish.
- [x] Add non-git copy fallback for projects without git.
- [x] Add real multi-step local tool loop for safe shell/dev-server execution.
- [x] Add embedded per-window live preview with fullscreen mode.
- [x] Add compare/merge workflow for choosing and combining winning branches.
- [x] Replace native/destructive browser confirms with reusable `ArenaConfirmDialog`.
- [x] Add selected-window batch archive from the Race toolbar.
- [x] Polish the Workbench visual system toward a black, professional local tool with restrained cyan/coral state colors.
- [x] Add file-level merge preview with selectable paths, diff snippets, and copy-fallback safety recommendations.
- [x] Add `full_local_agent` command approval gate: non-whitelisted commands become pending `ToolRun` records and require in-window approve/reject.
- [x] Add Work-level Approval Inbox that aggregates pending local command approvals across all windows.
- [x] Add side-by-side split diff rendering in the file-level merge panel.
- [x] Add conservative merge conflict detection for git worktree branches using base commit vs current original project.
- [x] Normalize Work project paths so clearing a project stores real `NULL`, not string values such as `"null"`, and repair the local default Work binding.
- [x] Add isolated Codex CLI runtime windows that run `codex exec` with Token Plan as a custom provider, without touching the user's global `~/.codex` config.
- [x] Add beginner-safe project onboarding: new project, open local folder, import https remote project, or chat-only work, with automatic local safety snapshots.
- [x] Add macOS native folder picker for opening existing projects, so users can choose real local folders instead of typing paths or being limited to the Arena install directory.
- [x] Add window-scoped long-term memory summaries backed by Prisma fields and automatic post-turn refresh.

## Product Direction

The app is moving from a model-centric arena to a work-centric local Agent workbench:

- A `Work` is one user task, such as a page build or refactor.
- A `WorkWindow` is an independent timeline inside that work.
- A `Race` sends one prompt to multiple windows at once.
- Each window has its own model, memory, branch state, permissions, preview, and logs.
- Same model in two windows must still behave as two separate branches.

## Implementation Notes

- Keep legacy `Conversation`, `Message`, `Run`, and `RunResult` during the transition.
- New chat APIs must use `windowId` as identity, not `modelSlug`.
- Default concurrent race fan-out is at least 4 requests.
- API keys stay server-side only.
- This is a trusted local/LAN tool, not a public multi-user service.
- Local project binding accepts concrete project folders under the current user's home directory. It blocks broad/sensitive roots such as the user home, Desktop/Documents/Downloads root, Library, `.ssh`, `.codex`, and app/system configuration folders.

## Current Status

- Prisma migration `20260612000000_work_window_race` applied locally.
- Main page now opens the Workbench UI.
- Window chat uses `workWindowId` identity and isolated `WindowMessage` history.
- Race creation stores one `Race` plus per-window `RaceParticipant` rows.
- Git worktree preparation is implemented for git-backed projects; non-git projects get a filtered copy fallback under `/Users/mac/Documents/.llm-arena-worktrees`.
- Shared dropdowns now use `ArenaSelect`; usage is documented in `docs/ui-components.md`.
- Local tools are available through `/api/windows/[id]/tools`: file listing, file reads, search, code patch application, safe commands, preview server start/stop, and log reads.
- Window chat can run up to three Agent tool-planning rounds through the `TOOL_CALLS` protocol before producing the final answer.
- Each window now stores a compact long-term memory summary plus `memoryUpdatedAt`; chat turns feed the summary compressor with the final answer, reasoning, project context, and tool results.
- Live preview iframes render inside each window when a preview server is running, with refresh, external open, and fullscreen controls.
- Compare/merge is available through merge preview, winner marking, and confirmed safe-file merge back to the original project. Copy fallback merges only tracked Agent patch files by default to avoid stale overwrites.
- Playwright smoke verified the Workbench page, window card rendering, custom dropdown portal, and winner badge. Use `npm run smoke:ui` while the dev server is running.
- Destructive project-writing and batch-archive actions use `ArenaConfirmDialog`, not `window.confirm`.
- The Race toolbar can archive selected windows in one confirmed action.
- Merge preview now opens inside a window settings panel, shows per-file create/update/delete status, additions/deletions, a compact text diff preview, and allows applying selected files only.
- Copy fallback merge safety: files changed by tracked Agent patches are recommended by default; untracked copy differences are visible but not preselected, so stale fallback copies do not silently overwrite the original project.
- `full_local_agent` no longer silently runs non-whitelisted commands. Safe commands still run directly; other allowed command names enter `pending_approval` and can be approved or rejected from the window tool log. Dangerous command families such as `rm`, `sudo`, `curl`, `wget`, `docker`, shell pipes, redirection, variables, and chained commands are blocked even before approval.
- Approval Inbox appears at Work scope when any window has `pending_approval` ToolRuns, so approvals are not buried inside individual tool logs.
- Preview recovery tools are available per window: `check_preview_server` validates whether the stored preview port is reachable and clears stale ports; `recover_preview_server` reuses a reachable stored port or starts a fresh dev server after a Next restart.
- Merge preview supports unified and split diff modes. Split mode shows original project content next to the window branch content with low-noise add/delete/change highlighting.
- Git worktree merges now detect same-file conflicts when both the original project and window branch changed a file after the recorded base commit. Conflicted files are marked in the merge panel and are not selectable by default.
- Work create/update APIs now normalize empty, `null`, `"null"`, and `"undefined"` project path values. The local default Work is rebound to `llm-arena`, and both existing windows have `copy_ready` branch records that point at `llm-arena`.
- Work windows now have a `runtimeKind`: `codex_cli` is the default for project-backed windows and invokes local Codex CLI in the window worktree; `token_plan` keeps the native Arena tool loop and is still used for chat-only windows. Codex CLI state is isolated under `.codex-runtime`; Token Plan provider settings are passed per invocation with `-c`, and the API key is passed only through `ALIYUN_TOKEN_PLAN_API_KEY`.
- The Work sidebar now uses a "Start work" flow for zero-experience users. Project work automatically prepares local version records and safety snapshots; chat-only work is allowed but disables local development runtimes until a project is bound.
- "Open local folder" now offers a native macOS folder picker through `/api/projects/pick-folder`. The quick project dropdown remains only as a convenience list; it is no longer the only way to bind a project.
- Remaining v2 polish candidates: none in the current v2 list. Future ideas can be added as a new phase.

## Latest Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm run smoke:ui`
- `npx prisma validate`
- `npx prisma migrate status`
- API smoke: PATCH project path to `null`, confirmed persisted `NULL`, then restored the default Work to `llm-arena` and confirmed both window branches stayed `copy_ready`.
- Project onboarding smoke: created a temporary new local project through `/api/projects/onboard`, confirmed `.gitignore`, local Git init, and initial safety snapshot, then removed the temporary smoke project.
- Codex runtime smoke: created a temporary `codex_cli` window using `qwen3.7-max`, ran a read-only `package.json` task through `codex exec` with the Token Plan provider, confirmed a completed response, then archived the temporary window.
- API safety smoke: temporarily set one window to `full_local_agent`, requested `run_command: node --version`, confirmed it created `pending_approval` instead of executing, rejected it through `/api/windows/[id]/tools/[toolRunId]/decision`, then restored the original permission.
- Current folder-picker change verified with `npm run lint` and `npx tsc --noEmit`; native picker itself is intentionally not opened in automated smoke because it blocks on a real macOS dialog.
