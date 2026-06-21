import {
  Asset,
  Conversation,
  Message,
  Race,
  RaceParticipant,
  RunResult,
  ToolRun,
  WindowMessage,
  Work,
  WorkspaceBranch,
  WorkWindow,
} from '@prisma/client';
import {
  AssetRecord,
  ConversationRecord,
  ConversationSummary,
  MessageRecord,
  RaceParticipantRecord,
  RaceRecord,
  StreamResponse,
  ToolRunRecord,
  WindowMessageRecord,
  WorkRecord,
  WorkspaceBranchRecord,
  WorkWindowRuntimeKind,
  WorkSummary,
  WorkWindowPermission,
  WorkWindowRecord,
} from '@/types';

export function serializeMessage(message: Message): MessageRecord {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role as MessageRecord['role'],
    content: message.content,
    reasoning: message.reasoning,
    attachments: message.attachments as MessageRecord['attachments'],
    usage: message.usage,
    createdAt: message.createdAt.toISOString(),
  };
}

export function serializeAsset(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    type: asset.type as AssetRecord['type'],
    modelSlug: asset.modelSlug,
    conversationId: asset.conversationId,
    runResultId: asset.runResultId,
    localPath: asset.localPath,
    publicUrl: asset.publicUrl,
    remoteUrl: asset.remoteUrl,
    prompt: asset.prompt,
    metadata: asset.metadata,
    createdAt: asset.createdAt.toISOString(),
  };
}

export function serializeConversationSummary(
  conversation: Conversation & { messages?: Message[]; _count?: { messages: number } }
): ConversationSummary {
  const lastMessage = conversation.messages?.[0];
  return {
    id: conversation.id,
    modelSlug: conversation.modelSlug,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: conversation._count?.messages ?? 0,
    lastMessage: lastMessage?.content,
  };
}

export function serializeConversation(
  conversation: Conversation & { messages: Message[]; assets: Asset[]; _count?: { messages: number } }
): ConversationRecord {
  return {
    ...serializeConversationSummary(conversation),
    messages: conversation.messages.map(serializeMessage),
    assets: conversation.assets.map(serializeAsset),
  };
}

export function serializeRunResult(result: RunResult & { assets?: Asset[] }): StreamResponse {
  return {
    modelSlug: result.modelSlug,
    conversationId: result.conversationId,
    runResultId: result.id,
    content: result.content || '',
    reasoning: result.reasoning || undefined,
    done: result.status !== 'running',
    status: result.status,
    error: result.error || undefined,
    startTime: result.startedAt.getTime(),
    endTime: result.completedAt?.getTime(),
    usage: result.usage,
    assets: result.assets?.map(serializeAsset),
  };
}

export function serializeWindowMessage(message: WindowMessage): WindowMessageRecord {
  return {
    id: message.id,
    workWindowId: message.workWindowId,
    raceParticipantId: message.raceParticipantId,
    role: message.role as WindowMessageRecord['role'],
    content: message.content,
    reasoning: message.reasoning,
    attachments: message.attachments as WindowMessageRecord['attachments'],
    usage: message.usage,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
  };
}

export function serializeWorkspaceBranch(branch: WorkspaceBranch): WorkspaceBranchRecord {
  return {
    id: branch.id,
    workWindowId: branch.workWindowId,
    projectPath: branch.projectPath,
    branchName: branch.branchName,
    worktreePath: branch.worktreePath,
    baseCommit: branch.baseCommit,
    currentCommit: branch.currentCommit,
    status: branch.status,
    lastDiffSummary: branch.lastDiffSummary,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  };
}

export function serializeToolRun(toolRun: ToolRun): ToolRunRecord {
  return {
    id: toolRun.id,
    workWindowId: toolRun.workWindowId,
    toolName: toolRun.toolName,
    status: toolRun.status,
    input: toolRun.input,
    output: toolRun.output,
    error: toolRun.error,
    startedAt: toolRun.startedAt.toISOString(),
    completedAt: toolRun.completedAt?.toISOString(),
    durationMs: toolRun.durationMs,
  };
}

export function serializeWorkWindow(
  window: WorkWindow & {
    messages?: WindowMessage[];
    workspaceBranch?: WorkspaceBranch | null;
    toolRuns?: ToolRun[];
  }
): WorkWindowRecord {
  return {
    id: window.id,
    workId: window.workId,
    modelSlug: window.modelSlug,
    runtimeKind: window.runtimeKind as WorkWindowRuntimeKind,
    name: window.name,
    systemPrompt: window.systemPrompt,
    memorySummary: window.memorySummary,
    memoryUpdatedAt: window.memoryUpdatedAt?.toISOString() || null,
    permissionMode: window.permissionMode as WorkWindowPermission,
    branchStatus: window.branchStatus,
    previewPort: window.previewPort,
    sortOrder: window.sortOrder,
    archived: window.archived,
    isWinner: window.isWinner,
    createdAt: window.createdAt.toISOString(),
    updatedAt: window.updatedAt.toISOString(),
    messages: window.messages?.map(serializeWindowMessage) || [],
    workspaceBranch: window.workspaceBranch ? serializeWorkspaceBranch(window.workspaceBranch) : null,
    toolRuns: window.toolRuns?.map(serializeToolRun) || [],
  };
}

export function serializeWorkSummary(
  work: Work & {
    windows?: Array<WorkWindow & { messages?: WindowMessage[] }>;
    _count?: { windows: number };
  }
): WorkSummary {
  const lastMessage = work.windows
    ?.flatMap((window) => window.messages || [])
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return {
    id: work.id,
    title: work.title,
    goal: work.goal,
    projectPath: work.projectPath,
    status: work.status,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
    archivedAt: work.archivedAt?.toISOString(),
    windowCount: work._count?.windows ?? work.windows?.length ?? 0,
    lastMessage: lastMessage?.content,
  };
}

export function serializeWork(
  work: Work & {
    windows: Array<WorkWindow & {
      messages?: WindowMessage[];
      workspaceBranch?: WorkspaceBranch | null;
      toolRuns?: ToolRun[];
    }>;
  }
): WorkRecord {
  return {
    id: work.id,
    title: work.title,
    goal: work.goal,
    projectPath: work.projectPath,
    status: work.status,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
    archivedAt: work.archivedAt?.toISOString(),
    windows: work.windows.map(serializeWorkWindow),
  };
}

export function serializeRaceParticipant(participant: RaceParticipant): RaceParticipantRecord {
  return {
    id: participant.id,
    raceId: participant.raceId,
    workWindowId: participant.workWindowId,
    modelSlug: participant.modelSlug,
    status: participant.status,
    content: participant.content,
    reasoning: participant.reasoning,
    error: participant.error,
    usage: participant.usage,
    latencyMs: participant.latencyMs,
    startedAt: participant.startedAt.toISOString(),
    completedAt: participant.completedAt?.toISOString(),
  };
}

export function serializeRace(race: Race & { participants: RaceParticipant[] }): RaceRecord {
  return {
    id: race.id,
    workId: race.workId,
    prompt: race.prompt,
    status: race.status,
    maxParallelRequests: race.maxParallelRequests,
    createdAt: race.createdAt.toISOString(),
    completedAt: race.completedAt?.toISOString(),
    participants: race.participants.map(serializeRaceParticipant),
  };
}
