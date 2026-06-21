-- Make Codex CLI Runtime the default for project-backed windows.
-- Chat-only works still fall back to Token Plan Agent in application code because
-- Codex CLI needs an isolated project worktree.
ALTER TABLE "WorkWindow" ALTER COLUMN "runtimeKind" SET DEFAULT 'codex_cli';

UPDATE "WorkWindow" AS ww
SET "runtimeKind" = 'codex_cli'
FROM "Work" AS w
WHERE ww."workId" = w."id"
  AND ww."runtimeKind" = 'token_plan'
  AND w."projectPath" IS NOT NULL
  AND btrim(w."projectPath") <> '';
