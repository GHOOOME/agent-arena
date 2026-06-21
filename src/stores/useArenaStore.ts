import { create } from 'zustand';
import {
  AppConfig,
  ConversationRecord,
  ConversationSummary,
  ModelCapability,
  ModelConfig,
  ProjectContextSelection,
  StreamResponse,
} from '@/types';
import { DEFAULT_SELECTED_MODEL_SLUGS, TOKEN_PLAN_MODELS } from '@/lib/models';

interface ArenaState {
  models: ModelConfig[];
  config: AppConfig | null;
  databaseReady: boolean;
  configError?: string;
  selectedModelSlugs: string[];
  responses: Record<string, StreamResponse>;
  activeConversationIds: Record<string, string>;
  conversations: ConversationSummary[];
  projectContext: ProjectContextSelection | null;
  isStreaming: boolean;
  currentPrompt: string;
  capabilityFilter: ModelCapability | 'all';
  toolsEnabled: boolean;
  setConfig: (config: AppConfig) => void;
  setModels: (models: ModelConfig[], databaseReady?: boolean) => void;
  setConversations: (conversations: ConversationSummary[]) => void;
  setProjectContext: (selection: ProjectContextSelection | null) => void;
  setActiveConversation: (modelSlug: string, conversationId?: string) => void;
  setCapabilityFilter: (capability: ModelCapability | 'all') => void;
  setToolsEnabled: (enabled: boolean) => void;
  toggleModel: (slug: string) => void;
  setCurrentPrompt: (prompt: string) => void;
  startStreaming: (clearResponses?: boolean) => void;
  updateResponse: (modelSlug: string, partial: Partial<StreamResponse>) => void;
  loadConversationIntoArena: (conversation: ConversationRecord) => void;
  resetModelConversation: (modelSlug: string) => void;
  stopStreaming: () => void;
  setConfigError: (error?: string) => void;
}

export const useArenaStore = create<ArenaState>((set) => ({
  models: TOKEN_PLAN_MODELS,
  config: null,
  databaseReady: false,
  configError: undefined,
  selectedModelSlugs: DEFAULT_SELECTED_MODEL_SLUGS,
  responses: {},
  activeConversationIds: {},
  conversations: [],
  projectContext: null,
  isStreaming: false,
  currentPrompt: '',
  capabilityFilter: 'all',
  toolsEnabled: false,
  setConfig: (config) => set({ config }),
  setModels: (models, databaseReady = true) =>
    set((s) => ({
      models,
      databaseReady,
      selectedModelSlugs: s.selectedModelSlugs.filter((slug) =>
        models.some((model) => model.slug === slug)
      ),
    })),
  setConversations: (conversations) => set({ conversations }),
  setProjectContext: (selection) => set({ projectContext: selection }),
  setActiveConversation: (modelSlug, conversationId) =>
    set((s) => {
      const next = { ...s.activeConversationIds };
      if (conversationId) next[modelSlug] = conversationId;
      else delete next[modelSlug];
      return { activeConversationIds: next };
    }),
  setCapabilityFilter: (capability) => set({ capabilityFilter: capability }),
  setToolsEnabled: (enabled) => set({ toolsEnabled: enabled }),
  toggleModel: (slug) =>
    set((s) => ({
      selectedModelSlugs: s.selectedModelSlugs.includes(slug)
        ? s.selectedModelSlugs.filter((i) => i !== slug)
        : s.selectedModelSlugs.length >= (s.config?.maxSelectedModels || 6)
          ? s.selectedModelSlugs
          : [...s.selectedModelSlugs, slug],
    })),
  setCurrentPrompt: (prompt) => set({ currentPrompt: prompt }),
  startStreaming: (clearResponses = true) =>
    set((s) => ({
      responses: clearResponses ? {} : s.responses,
      isStreaming: true,
    })),
  updateResponse: (modelSlug, partial) =>
    set((s) => {
      const previous = s.responses[modelSlug];
      const next: StreamResponse = previous
        ? { ...previous, ...partial, modelSlug }
        : {
            modelSlug,
            content: partial.content ?? '',
            done: partial.done ?? false,
            startTime: partial.startTime ?? Date.now(),
            ...partial,
          };

      return {
        responses: {
          ...s.responses,
          [modelSlug]: next,
        },
      };
    }),
  loadConversationIntoArena: (conversation) =>
    set((s) => {
      const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant');
      return {
        activeConversationIds: {
          ...s.activeConversationIds,
          [conversation.modelSlug]: conversation.id,
        },
        selectedModelSlugs: s.selectedModelSlugs.includes(conversation.modelSlug)
          ? s.selectedModelSlugs
          : [...s.selectedModelSlugs, conversation.modelSlug],
        responses: lastAssistant
          ? {
              ...s.responses,
              [conversation.modelSlug]: {
                modelSlug: conversation.modelSlug,
                conversationId: conversation.id,
                content: lastAssistant.content,
                messages: conversation.messages,
                reasoning: lastAssistant.reasoning || undefined,
                done: true,
                startTime: new Date(lastAssistant.createdAt).getTime(),
                endTime: new Date(lastAssistant.createdAt).getTime(),
              },
            }
          : s.responses,
      };
    }),
  resetModelConversation: (modelSlug) =>
    set((s) => {
      const activeConversationIds = { ...s.activeConversationIds };
      const responses = { ...s.responses };
      delete activeConversationIds[modelSlug];
      delete responses[modelSlug];
      return { activeConversationIds, responses };
    }),
  stopStreaming: () => set({ isStreaming: false }),
  setConfigError: (error) => set({ configError: error }),
}));
