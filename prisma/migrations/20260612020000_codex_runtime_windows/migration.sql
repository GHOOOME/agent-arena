-- Add an execution runtime selector for Work windows.
-- Existing windows keep Token Plan behavior.
ALTER TABLE "WorkWindow" ADD COLUMN "runtimeKind" TEXT NOT NULL DEFAULT 'token_plan';

CREATE INDEX "WorkWindow_runtimeKind_updatedAt_idx" ON "WorkWindow"("runtimeKind", "updatedAt");
