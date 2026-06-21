export type ModelCapability =
  | 'text'
  | 'reasoning'
  | 'vision'
  | 'image'
  | 'tools';

export type BuiltInTool =
  | 'web_search'
  | 'code_interpreter'
  | 'web_extractor'
  | 'image_search'
  | 'web_search_image';

export interface ModelConfig {
  id: string;
  slug: string;
  name: string;
  provider: string;
  family: string;
  color: string;
  description: string;
  bestFor: string[];
  capabilities: ModelCapability[];
  tools: BuiltInTool[];
  isActive: boolean;
}

export interface PromptAttachment {
  id: string;
  name: string;
  type: string;
  dataUrl?: string;
  publicUrl?: string;
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  size: number;
  extension: string;
  selected?: boolean;
}

export type ProjectContextMode = 'agent';
export type ProjectAgentPermission = 'request_approval' | 'auto_approve_safe' | 'full_access';
export type WorkWindowRuntimeKind = 'token_plan' | 'codex_cli';
export type WorkWindowPermission =
  | 'read_only'
  | 'propose_patch'
  | 'apply_files'
  | 'run_safe_commands'
  | 'run_dev_server'
  | 'full_local_agent';

export interface ProjectContextSelection {
  projectPath: string;
  files: string[];
  mode?: ProjectContextMode;
  writeEnabled?: boolean;
  permissionMode?: ProjectAgentPermission;
}

export interface ProjectContextSummary {
  projectPath: string;
  mode?: ProjectContextMode;
  writeEnabled?: boolean;
  permissionMode?: ProjectAgentPermission;
  fileCount: number;
  totalBytes: number;
  scannedFileCount?: number;
  files?: string[];
  queries?: string[];
  fallback?: boolean;
}

export type CodePatchOperation = 'create' | 'update';

export interface ProposedFileEdit {
  operation: CodePatchOperation;
  path: string;
  oldText?: string;
  newText: string;
  note?: string;
}

export interface CodePatchProposal {
  type: 'code_patch';
  projectPath?: string;
  summary?: string;
  edits: ProposedFileEdit[];
}

export interface ProjectPatchEditResult {
  operation: CodePatchOperation;
  path: string;
  status: 'ready' | 'applied';
  bytes: number;
}

export interface ProjectPatchResult {
  projectPath: string;
  summary?: string;
  edits: ProjectPatchEditResult[];
}

export interface StreamResponse {
  modelSlug: string;
  conversationId?: string;
  runResultId?: string;
  content: string;
  messages?: MessageRecord[];
  reasoning?: string;
  done: boolean;
  status?: string;
  error?: string;
  startTime: number;
  endTime?: number;
  tokensPerSecond?: number;
  usage?: unknown;
  assets?: AssetRecord[];
  projectContext?: ProjectContextSummary;
  agentStatus?: string;
}

export interface ConversationSummary {
  id: string;
  modelSlug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string | null;
  attachments?: PromptAttachment[] | null;
  usage?: unknown;
  createdAt: string;
}

export interface WindowMessageRecord {
  id: string;
  workWindowId: string;
  raceParticipantId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoning?: string | null;
  attachments?: PromptAttachment[] | null;
  usage?: unknown;
  metadata?: unknown;
  createdAt: string;
}

export interface WorkspaceBranchRecord {
  id: string;
  workWindowId: string;
  projectPath?: string | null;
  branchName?: string | null;
  worktreePath?: string | null;
  baseCommit?: string | null;
  currentCommit?: string | null;
  status: string;
  lastDiffSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRunRecord {
  id: string;
  workWindowId: string;
  toolName: string;
  status: string;
  input?: unknown;
  output?: string | null;
  error?: string | null;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
}

export interface WorkWindowRecord {
  id: string;
  workId: string;
  modelSlug: string;
  runtimeKind: WorkWindowRuntimeKind;
  name: string;
  systemPrompt?: string | null;
  memorySummary?: string | null;
  memoryUpdatedAt?: string | null;
  permissionMode: WorkWindowPermission;
  branchStatus: string;
  previewPort?: number | null;
  sortOrder: number;
  archived: boolean;
  isWinner: boolean;
  createdAt: string;
  updatedAt: string;
  messages: WindowMessageRecord[];
  workspaceBranch?: WorkspaceBranchRecord | null;
  toolRuns?: ToolRunRecord[];
}

export interface WorkRecord {
  id: string;
  title: string;
  goal?: string | null;
  projectPath?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  windows: WorkWindowRecord[];
}

export interface WorkSummary {
  id: string;
  title: string;
  goal?: string | null;
  projectPath?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  windowCount: number;
  lastMessage?: string;
}

export interface RaceParticipantRecord {
  id: string;
  raceId: string;
  workWindowId: string;
  modelSlug: string;
  status: string;
  content?: string | null;
  reasoning?: string | null;
  error?: string | null;
  usage?: unknown;
  latencyMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface RaceRecord {
  id: string;
  workId: string;
  prompt: string;
  status: string;
  maxParallelRequests: number;
  createdAt: string;
  completedAt?: string | null;
  participants: RaceParticipantRecord[];
}

export interface ConversationRecord extends ConversationSummary {
  messages: MessageRecord[];
  assets: AssetRecord[];
}

export interface RunRecord {
  id: string;
  prompt: string;
  createdAt: string;
  results: StreamResponse[];
}

export interface AssetRecord {
  id: string;
  type: 'upload' | 'generated';
  modelSlug?: string | null;
  conversationId?: string | null;
  runResultId?: string | null;
  localPath: string;
  publicUrl: string;
  remoteUrl?: string | null;
  prompt?: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface AppConfig {
  hasApiKey: boolean;
  hasDatabaseUrl: boolean;
  baseUrl: string;
  apiKeySource?: 'env' | 'local' | 'missing';
  configPath?: string;
  maxParallelRequests: number;
  maxSelectedModels: number;
  assetDir: string;
}

export interface ImageGenerationOptions {
  modelSlug: string;
  prompt: string;
  negativePrompt?: string;
  size: string;
  count: number;
  promptExtend: boolean;
  watermark: boolean;
  conversationId?: string;
}
