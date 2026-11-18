import { describe, expect, it } from 'vitest';
import { PROVIDERS, ProviderError } from '../../../src/core/ai/providers';
import type { ChatRequest } from '../../../src/core/ai/providers';
import { claudeStream, fakeFetch, geminiStream, openaiStream, streamResponse } from './helpers';

const KEY = 'sk-secret-key-123';
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  system: 'SYSTEM TEXT', user: 'USER TEXT', model: 'the-model', maxTokens: 321, fast: true, ...over,
});

async function run(id: 'claude' | 'openai' | 'gemini' | 'nvidia', body: string, request = req()) {
  const { fetchFn, calls } = fakeFetch(() => streamResponse([body]));
  const deltas: string[] = [];
  await PROVIDERS[id].stream(request, KEY, (t) => deltas.push(t), fetchFn);
  return { deltas, call: calls[0]! };
}

describe('claude adapter', () => {
  it('streams text and sends the system prompt as a cacheable block', async () => {
    const { deltas, call } = await run('claude', claudeStream(['Hel', 'lo']));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    // The SDK decides which header carries the key (it differs by API version).
    expect([call.headers.get('x-api-key'), call.headers.get('authorization')]).toContain(
      call.headers.has('x-api-key') ? KEY : `Bearer ${KEY}`,
    );
    expect(call.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(call.body).toMatchObject({
      model: 'the-model',
      max_tokens: 321,
      stream: true,
      system: [{ type: 'text', text: 'SYSTEM TEXT', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USER TEXT' }],
    });
  });

  it('turns thinking off for a fast request on a Haiku model', async () => {
    const { call } = await run('claude', claudeStream(['x']), req({ model: 'claude-haiku-5-5', fast: true }));
    expect(call.body.thinking).toEqual({ type: 'disabled' });
  });

  it('asks other models for low effort on a fast request instead of disabling thinking', async () => {
    const { call } = await run('claude', claudeStream(['x']), req({ model: 'claude-opus-5-5', fast: true }));
    expect(call.body.thinking).toBeUndefined();
    expect(call.body.output_config).toEqual({ effort: 'low' });
  });

  it('leaves thinking and effort alone when the request is not fast', async () => {
    const { call } = await run('claude', claudeStream(['x']), req({ model: 'claude-opus-5-5', fast: false }));
    expect(call.body.thinking).toBeUndefined();
    expect(call.body.output_config).toBeUndefined();
  });

  it('treats a refusal as a provider failure', async () => {
    const { fetchFn } = fakeFetch(() => streamResponse([claudeStream([], 'refusal')]));
    await expect(PROVIDERS.claude.stream(req(), KEY, () => {}, fetchFn)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('openai adapter', () => {
  it('streams text from chat completions', async () => {
    const { deltas, call } = await run('openai', openaiStream(['Hel', 'lo']));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(call.body).toMatchObject({
      model: 'the-model',
      stream: true,
      max_completion_tokens: 321,
      messages: [
        { role: 'system', content: 'SYSTEM TEXT' },
        { role: 'user', content: 'USER TEXT' },
      ],
    });
  });
});

describe('nvidia adapter', () => {
  it('streams text from NVIDIA\'s chat endpoint with thinking switched off', async () => {
    const { deltas, call } = await run('nvidia', openaiStream(['Hel', 'lo']));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(call.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(call.body).toMatchObject({
      model: 'the-model',
      stream: true,
      max_tokens: 321,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: 'SYSTEM TEXT' },
        { role: 'user', content: 'USER TEXT' },
      ],
    });
    expect(call.body.max_completion_tokens).toBeUndefined();
  });

  it('never shows a model\'s hidden reasoning as a reply', async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Let me think about the price' } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'It is $900.' } }] })}\n\ndata: [DONE]\n\n`;
    const { deltas } = await run('nvidia', body);
    expect(deltas).toEqual(['It is $900.']);
  });
});

describe('gemini adapter', () => {
  it('streams text from streamGenerateContent', async () => {
    const { deltas, call } = await run('gemini', geminiStream(['Hel', 'lo']));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/the-model:streamGenerateContent?alt=sse');
    expect(call.headers.get('x-goog-api-key')).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(call.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'SYSTEM TEXT' }] },
      contents: [{ role: 'user', parts: [{ text: 'USER TEXT' }] }],
      generationConfig: { maxOutputTokens: 321 },
    });
  });
});

describe.each(['claude', 'openai', 'gemini', 'nvidia'] as const)('%s errors', (id) => {
  it('reports a rejected key as a 401 without leaking the key', async () => {
    const { fetchFn } = fakeFetch(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `bad key ${KEY}`, code: 401 } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await PROVIDERS[id].stream(req(), KEY, () => {}, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(401);
    expect(error.provider).toBe(id);
    expect(error.message).not.toContain(KEY);
  });
});
