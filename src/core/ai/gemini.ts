import { sseData } from './sse';
import { ProviderError, httpError, isAbort, type Provider } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const gemini: Provider = {
  id: 'gemini',
  async stream(req, apiKey, onDelta, fetchFn = fetch) {
    let res: Response;
    try {
      res = await fetchFn(`${BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        // The key goes in a header, never in the URL.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: { maxOutputTokens: req.maxTokens },
        }),
        signal: req.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ProviderError('gemini', null, 'Network error');
    }
    if (!res.ok) throw await httpError('gemini', res, apiKey);
    for await (const data of sseData(res)) {
      const chunk = JSON.parse(data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      };
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) onDelta(part.text);
      }
    }
  },
};

export async function listGeminiModels(apiKey: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw await httpError('gemini', res, apiKey);
  const body = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
    .map((m) => m.name.replace(/^models\//, ''));
}
