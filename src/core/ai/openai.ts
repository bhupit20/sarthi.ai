import type { ProviderId } from '../shared/types';
import { sseData } from './sse';
import { ProviderError, httpError, isAbort, type Provider } from './types';

interface CompatibleOptions {
  id: ProviderId;
  /** Base address ending in /v1. */
  baseUrl: string;
  /** The request field that caps the answer length. */
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  /** Extra request fields this provider understands. */
  extraBody?: Record<string, unknown>;
}

/** A provider that speaks the OpenAI chat-completions format. */
function compatible({ id, baseUrl, maxTokensField, extraBody = {} }: CompatibleOptions): Provider {
  return {
    id,
    async stream(req, apiKey, onDelta, fetchFn = fetch) {
      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: req.model,
            stream: true,
            [maxTokensField]: req.maxTokens,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
            ...extraBody,
          }),
          signal: req.signal,
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        throw new ProviderError(id, null, 'Network error');
      }
      if (!res.ok) throw await httpError(id, res, apiKey);
      for await (const data of sseData(res)) {
        // Only "content" is the answer; "reasoning_content" is the model thinking out loud.
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null } }> };
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) onDelta(text);
      }
    },
  };
}

async function listCompatibleModels(id: ProviderId, baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw await httpError(id, res, apiKey);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => m.id);
}

const OPENAI = 'https://api.openai.com/v1';
const NVIDIA = 'https://integrate.api.nvidia.com/v1';

export const openai = compatible({ id: 'openai', baseUrl: OPENAI, maxTokensField: 'max_completion_tokens' });

/**
 * NVIDIA's hosted models (build.nvidia.com). Some of them "think" before
 * answering, which is too slow on a live call, so thinking is switched off.
 */
export const nvidia = compatible({
  id: 'nvidia',
  baseUrl: NVIDIA,
  maxTokensField: 'max_tokens',
  extraBody: { chat_template_kwargs: { enable_thinking: false } },
});

export const listOpenAiModels = (apiKey: string, fetchFn?: typeof fetch) => listCompatibleModels('openai', OPENAI, apiKey, fetchFn);

/** Chat models only: NVIDIA also lists embedding, safety and video models. */
export async function listNvidiaModels(apiKey: string, fetchFn?: typeof fetch): Promise<string[]> {
  const notChat = /embed|safety|guard|retriever|clip|detector|calibration|starcoder|riva|cosmos/i;
  return (await listCompatibleModels('nvidia', NVIDIA, apiKey, fetchFn)).filter((m) => !notChat.test(m));
}
