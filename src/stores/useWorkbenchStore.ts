import { create } from 'zustand';
import {
  AppConfig,
  ModelConfig,
  PromptAttachment,
  RaceRecord,
  WindowMessageRecord,
  WorkRecord,
  WorkSummary,
} from '@/types';
import { TOKEN_PLAN_MODELS } from '@/lib/models';

export interface WindowStreamState {
  workWindowId: string;
  raceParticipantId?: string;
  content: string;
  reasoning?: string;
  done: boolean;
  status?: string;
  error?: string;
  startTime: number;
  endTime?: number;
  tokensPerSecond?: number;
  projectContext?: unknown;
  agentMessage?: string;
}

interface WorkbenchState {
  config: AppConfig | null;
  configError?: string;
  databaseReady: boolean;
  models: ModelConfig[];
  works: WorkSummary[];
  activeWork: WorkRecord | null;
  activeWorkId?: string;
  selectedWindowIds: string[];
  streams: Record<string, WindowStreamState>;
  races: RaceRecord[];
  isStreaming: boolean;
  setConfig: (config: AppConfig) => void;
  setConfigError: (error?: string) => void;
  setModels: (models: ModelConfig[], databaseReady?: boolean) => void;
  setWorks: (works: WorkSummary[]) => void;
  setActiveWork: (work: WorkRecord | null) => void;
  setActiveWorkId: (id?: string) => void;
  toggleWindowSelection: (id: string) => void;
  setSelectedWindowIds: (ids: string[]) => void;
  upsertWindowMessage: (workWindowId: string, message: WindowMessageRecord) => void;
  appendDraftUserMessage: (workWindowId: string, prompt: string, attachments?: PromptAttachment[], raceParticipantId?: string) => string;
  appendDraftAssistantMessage: (workWindowId: string, raceParticipantId?: string) => string;
  updateDraftAssistantMessage: (workWindowId: string, messageId: string, partial: Partial<WindowMessageRecord>) => void;
  removeDraftMessage: (workWindowId: string, messageId: string) => void;
  updateWindowMemory: (workWindowId: string, memory: { summary?: string | null; memoryUpdatedAt?: string | null }) => void;
  startWindowStream: (workWindowId: string, partial?: Partial<WindowStreamState>) => void;
  updateWindowStream: (workWindowId: string, partial: Partial<WindowStreamState>) => void;
  stopWindowStream: (workWindowId: string) => void;
  addRace: (race: RaceRecord) => void;
  setStreaming: (isStreaming: boolean) => void;
}

function replaceWindow(work: WorkRecord, workWindowId: string, updater: (window: WorkRecord['windows'][number]) => WorkRecord['windows'][number]) {
  return {
    ...work,
    windows: work.windows.map((window) => window.id === workWindowId ? updater(window) : window),
  };
}

function messageCreatedAtOffset(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  config: null,
  configError: undefined,
  databaseReady: false,
  models: TOKEN_PLAN_MODELS,
  works: [],
  activeWork: null,
  activeWorkId: undefined,
  selectedWindowIds: [],
  streams: {},
  races: [],
  isStreaming: false,
  setConfig: (config) => set({ config }),
  setConfigError: (error) => set({ configError: error }),
  setModels: (models, databaseReady = true) => set({ models, databaseReady }),
  setWorks: (works) => set({ works }),
  setActiveWorkId: (id) => set({ activeWorkId: id }),
  setActiveWork: (work) =>
    set((state) => {
      const windowIds = work?.windows.map((window) => window.id) || [];
      const selected = state.selectedWindowIds.filter((id) => windowIds.includes(id));
      return {
        activeWork: work,
        activeWorkId: work?.id,
        selectedWindowIds: selected.length > 0 ? selected : windowIds.slice(0, Math.min(4, windowIds.length)),
      };
    }),
  toggleWindowSelection: (id) =>
    set((state) => ({
      selectedWindowIds: state.selectedWindowIds.includes(id)
        ? state.selectedWindowIds.filter((item) => item !== id)
        : [...state.selectedWindowIds, id],
    })),
  setSelectedWindowIds: (ids) => set({ selectedWindowIds: ids }),
  upsertWindowMessage: (workWindowId, message) =>
    set((state) => {
      if (!state.activeWork) return state;
      return {
        activeWork: replaceWindow(state.activeWork, workWindowId, (window) => {
          const exists = window.messages.some((item) => item.id === message.id);
          const messages = exists
            ? window.messages.map((item) => item.id === message.id ? message : item)
            : [...window.messages, message];
          return { ...window, messages };
        }),
      };
    }),
  appendDraftUserMessage: (workWindowId, prompt, attachments, raceParticipantId) => {
    const id = `draft-user-${workWindowId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    get().upsertWindowMessage(workWindowId, {
      id,
      workWindowId,
      raceParticipantId,
      role: 'user',
      content: prompt,
      attachments: attachments && attachments.length > 0 ? attachments : null,
      createdAt: messageCreatedAtOffset(),
    });
    return id;
  },
  appendDraftAssistantMessage: (workWindowId, raceParticipantId) => {
    const id = `draft-assistant-${workWindowId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    get().upsertWindowMessage(workWindowId, {
      id,
      workWindowId,
      raceParticipantId,
      role: 'assistant',
      content: '',
      createdAt: messageCreatedAtOffset(1),
    });
    return id;
  },
  updateDraftAssistantMessage: (workWindowId, messageId, partial) =>
    set((state) => {
      if (!state.activeWork) return state;
      return {
        activeWork: replaceWindow(state.activeWork, workWindowId, (window) => ({
          ...window,
          messages: window.messages.map((message) =>
            message.id === messageId ? { ...message, ...partial } : message
          ),
        })),
      };
    }),
  removeDraftMessage: (workWindowId, messageId) =>
    set((state) => {
      if (!state.activeWork) return state;
      return {
        activeWork: replaceWindow(state.activeWork, workWindowId, (window) => ({
          ...window,
          messages: window.messages.filter((message) => message.id !== messageId),
        })),
      };
    }),
  updateWindowMemory: (workWindowId, memory) =>
    set((state) => {
      if (!state.activeWork) return state;
      return {
        activeWork: replaceWindow(state.activeWork, workWindowId, (window) => ({
          ...window,
          memorySummary: memory.summary ?? window.memorySummary,
          memoryUpdatedAt: memory.memoryUpdatedAt ?? window.memoryUpdatedAt,
        })),
      };
    }),
  startWindowStream: (workWindowId, partial) =>
    set((state) => {
      const base: WindowStreamState = {
        workWindowId,
        content: '',
        reasoning: '',
        done: false,
        startTime: Date.now(),
        status: 'queued',
      };
      return {
        streams: {
          ...state.streams,
          [workWindowId]: {
            ...base,
            ...partial,
          },
        },
        isStreaming: true,
      };
    }),
  updateWindowStream: (workWindowId, partial) =>
    set((state) => {
      const previous = state.streams[workWindowId];
      const base: WindowStreamState = {
        workWindowId,
        content: '',
        done: false,
        startTime: Date.now(),
      };
      const nextStreams = {
        ...state.streams,
        [workWindowId]: {
          ...base,
          ...previous,
          ...partial,
        },
      };
      return {
        streams: nextStreams,
        ...(partial.done !== undefined
          ? { isStreaming: Object.values(nextStreams).some((stream) => !stream.done) }
          : {}),
      };
    }),
  stopWindowStream: (workWindowId) =>
    set((state) => {
      const next = {
        ...state.streams,
        [workWindowId]: {
          ...state.streams[workWindowId],
          workWindowId,
          done: true,
          endTime: Date.now(),
        },
      };
      return {
        streams: next,
        isStreaming: Object.values(next).some((stream) => !stream.done),
      };
    }),
  addRace: (race) =>
    set((state) => ({
      races: [race, ...state.races.filter((item) => item.id !== race.id)].slice(0, 20),
    })),
  setStreaming: (isStreaming) => set({ isStreaming }),
}));
