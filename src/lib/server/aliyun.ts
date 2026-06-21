import { BuiltInTool, PromptAttachment } from '@/types';
import { getTokenPlanBaseUrlAsync, requireApiKey } from './config';

type ChatMessage = {
  role: string;
  content: string | Array<Record<string, unknown>>;
};

export const NORMALIZED_TOOLS: BuiltInTool[] = [
  'web_search',
  'code_interpreter',
  'web_extractor',
  'image_search',
  'web_search_image',
];

export function buildChatMessages(
  messages: Array<{
    role: string;
    content: string;
    attachments?: unknown;
  }>
): ChatMessage[] {
  return messages.map((message) => {
    const attachments = Array.isArray(message.attachments)
      ? (message.attachments as PromptAttachment[])
      : [];
    const imageAttachments = attachments.filter((attachment) => attachment.dataUrl);

    if (message.role === 'user' && imageAttachments.length > 0) {
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          ...imageAttachments.map((attachment) => ({
            type: 'image_url',
            image_url: { url: attachment.dataUrl },
          })),
        ],
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

export async function createChatCompletionStream(model: string, messages: ChatMessage[], signal?: AbortSignal) {
  const [apiKey, baseUrl] = await Promise.all([requireApiKey(), getTokenPlanBaseUrlAsync()]);
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });
}

export async function createChatCompletion(params: {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}) {
  const [apiKey, baseUrl] = await Promise.all([requireApiKey(), getTokenPlanBaseUrlAsync()]);
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: false,
      temperature: params.temperature ?? 0,
      max_tokens: params.maxTokens ?? 1200,
    }),
    signal: params.signal,
  });
}

export async function createResponsesStream(model: string, messages: ChatMessage[], signal?: AbortSignal) {
  const [apiKey, baseUrl] = await Promise.all([requireApiKey(), getTokenPlanBaseUrlAsync()]);
  const input = messages
    .map((message) => {
      if (typeof message.content === 'string') {
        return `${message.role}: ${message.content}`;
      }
      return `${message.role}: ${JSON.stringify(message.content)}`;
    })
    .join('\n\n');

  return fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      tools: NORMALIZED_TOOLS.map((type) => ({ type })),
      tool_choice: 'auto',
      stream: true,
    }),
    signal,
  });
}

export async function getImageGenerationUrl() {
  const configured = process.env.ALIYUN_IMAGE_GENERATION_URL;
  if (configured) return configured;
  const origin = new URL(await getTokenPlanBaseUrlAsync()).origin;
  return `${origin}/api/v1/services/aigc/multimodal-generation/generation`;
}

export async function createImageGeneration(params: {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size: string;
  count: number;
  promptExtend: boolean;
  watermark: boolean;
  signal?: AbortSignal;
}) {
  const [apiKey, imageGenerationUrl] = await Promise.all([requireApiKey(), getImageGenerationUrl()]);
  return fetch(imageGenerationUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: params.prompt }],
          },
        ],
      },
      parameters: {
        negative_prompt: params.negativePrompt || '',
        prompt_extend: params.promptExtend,
        watermark: params.watermark,
        size: params.size,
        n: params.count,
      },
    }),
    signal: params.signal,
  });
}

export async function pumpTokenPlanSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: { content?: string; reasoning?: string; usage?: unknown }) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        const delta = choice?.delta;
        const responseType = json.type || '';
        const usage = json.usage || json.response?.usage;

        const content =
          delta?.content ||
          json.delta ||
          json.output_text ||
          (responseType.includes('output_text.delta') ? json.delta : '');
        const reasoning =
          delta?.reasoning ||
          delta?.reasoning_content ||
          json.reasoning ||
          json.reasoning_content ||
          (responseType.includes('reasoning') ? json.delta : '');

        onEvent({
          content: typeof content === 'string' ? content : '',
          reasoning: typeof reasoning === 'string' ? reasoning : '',
          usage,
        });
      } catch {
        // Ignore malformed keep-alive chunks.
      }
    }
  }
}
