CREATE TABLE "Work" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT,
  "projectPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkWindow" (
  "id" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "modelSlug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "systemPrompt" TEXT,
  "permissionMode" TEXT NOT NULL DEFAULT 'read_only',
  "branchStatus" TEXT NOT NULL DEFAULT 'not_created',
  "previewPort" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WindowMessage" (
  "id" TEXT NOT NULL,
  "workWindowId" TEXT NOT NULL,
  "raceParticipantId" TEXT,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "reasoning" TEXT,
  "attachments" JSONB,
  "usage" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WindowMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Race" (
  "id" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "maxParallelRequests" INTEGER NOT NULL DEFAULT 4,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RaceParticipant" (
  "id" TEXT NOT NULL,
  "raceId" TEXT NOT NULL,
  "workWindowId" TEXT NOT NULL,
  "modelSlug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "content" TEXT,
  "reasoning" TEXT,
  "error" TEXT,
  "usage" JSONB,
  "latencyMs" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RaceParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceBranch" (
  "id" TEXT NOT NULL,
  "workWindowId" TEXT NOT NULL,
  "projectPath" TEXT,
  "branchName" TEXT,
  "worktreePath" TEXT,
  "baseCommit" TEXT,
  "currentCommit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'not_created',
  "lastDiffSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceBranch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToolRun" (
  "id" TEXT NOT NULL,
  "workWindowId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input" JSONB,
  "output" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  CONSTRAINT "ToolRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Work_status_updatedAt_idx" ON "Work"("status", "updatedAt");
CREATE INDEX "WorkWindow_workId_sortOrder_idx" ON "WorkWindow"("workId", "sortOrder");
CREATE INDEX "WorkWindow_modelSlug_updatedAt_idx" ON "WorkWindow"("modelSlug", "updatedAt");
CREATE INDEX "WindowMessage_workWindowId_createdAt_idx" ON "WindowMessage"("workWindowId", "createdAt");
CREATE INDEX "WindowMessage_raceParticipantId_idx" ON "WindowMessage"("raceParticipantId");
CREATE INDEX "Race_workId_createdAt_idx" ON "Race"("workId", "createdAt");
CREATE INDEX "RaceParticipant_raceId_idx" ON "RaceParticipant"("raceId");
CREATE INDEX "RaceParticipant_workWindowId_startedAt_idx" ON "RaceParticipant"("workWindowId", "startedAt");
CREATE INDEX "RaceParticipant_modelSlug_startedAt_idx" ON "RaceParticipant"("modelSlug", "startedAt");
CREATE UNIQUE INDEX "WorkspaceBranch_workWindowId_key" ON "WorkspaceBranch"("workWindowId");
CREATE INDEX "WorkspaceBranch_status_updatedAt_idx" ON "WorkspaceBranch"("status", "updatedAt");
CREATE INDEX "ToolRun_workWindowId_startedAt_idx" ON "ToolRun"("workWindowId", "startedAt");
CREATE INDEX "ToolRun_toolName_startedAt_idx" ON "ToolRun"("toolName", "startedAt");

ALTER TABLE "WorkWindow" ADD CONSTRAINT "WorkWindow_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkWindow" ADD CONSTRAINT "WorkWindow_modelSlug_fkey" FOREIGN KEY ("modelSlug") REFERENCES "Model"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WindowMessage" ADD CONSTRAINT "WindowMessage_workWindowId_fkey" FOREIGN KEY ("workWindowId") REFERENCES "WorkWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WindowMessage" ADD CONSTRAINT "WindowMessage_raceParticipantId_fkey" FOREIGN KEY ("raceParticipantId") REFERENCES "RaceParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Race" ADD CONSTRAINT "Race_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_workWindowId_fkey" FOREIGN KEY ("workWindowId") REFERENCES "WorkWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_modelSlug_fkey" FOREIGN KEY ("modelSlug") REFERENCES "Model"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBranch" ADD CONSTRAINT "WorkspaceBranch_workWindowId_fkey" FOREIGN KEY ("workWindowId") REFERENCES "WorkWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolRun" ADD CONSTRAINT "ToolRun_workWindowId_fkey" FOREIGN KEY ("workWindowId") REFERENCES "WorkWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
