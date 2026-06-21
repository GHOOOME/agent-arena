CREATE TABLE "Model" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "bestFor" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "modelSlug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "reasoning" TEXT,
  "attachments" JSONB,
  "usage" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Run" (
  "id" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "modelSlug" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "content" TEXT,
  "reasoning" TEXT,
  "error" TEXT,
  "usage" JSONB,
  "latencyMs" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RunResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "modelSlug" TEXT,
  "conversationId" TEXT,
  "runResultId" TEXT,
  "localPath" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "remoteUrl" TEXT,
  "prompt" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Model_slug_key" ON "Model"("slug");
CREATE INDEX "Conversation_modelSlug_updatedAt_idx" ON "Conversation"("modelSlug", "updatedAt");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "RunResult_runId_idx" ON "RunResult"("runId");
CREATE INDEX "RunResult_conversationId_idx" ON "RunResult"("conversationId");
CREATE INDEX "RunResult_modelSlug_startedAt_idx" ON "RunResult"("modelSlug", "startedAt");
CREATE INDEX "Asset_conversationId_createdAt_idx" ON "Asset"("conversationId", "createdAt");
CREATE INDEX "Asset_runResultId_idx" ON "Asset"("runResultId");
CREATE INDEX "Asset_modelSlug_createdAt_idx" ON "Asset"("modelSlug", "createdAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_modelSlug_fkey" FOREIGN KEY ("modelSlug") REFERENCES "Model"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_modelSlug_fkey" FOREIGN KEY ("modelSlug") REFERENCES "Model"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_modelSlug_fkey" FOREIGN KEY ("modelSlug") REFERENCES "Model"("slug") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_runResultId_fkey" FOREIGN KEY ("runResultId") REFERENCES "RunResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
