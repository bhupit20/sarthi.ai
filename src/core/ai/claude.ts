import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, isAbort, scrub, type Provider } from './types';

export const claude: Provider = {
  id: 'claude',
  async stream(req, apiKey, onDelta, fetchFn) {
    const client = new Anthropic({
      apiKey,
      // The key is the owner's own and stays in their browser.
      dangerouslyAllowBrowser: true,
      // The extension has its own fallback to other providers; do not wait on retries.
      maxRetries: 0,
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });

    // Live replies must be quick. Haiku models can answer without thinking;
    // other current models cannot turn thinking off, so ask for low effort.
    const speed: Partial<Anthropic.MessageStreamParams> = !req.fast
      ? {}
      : req.model.includes('haiku')
        ? { thinking: { type: 'disabled' } }
        : { output_config: { effort: 'low' } };

    try {
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
          ...speed,
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          onDelta(event.delta.text);
        } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
          throw new ProviderError('claude', null, 'Claude declined to answer this request.');
        }
      }
    } catch (error) {
      if (error instanceof ProviderError || isAbort(error)) throw error;
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError('claude', error.status ?? null, scrub(error.message, apiKey));
      }
      throw new ProviderError('claude', null, 'Network error');
    }
  },
};

export async function listClaudeModels(apiKey: string, fetchFn?: typeof fetch): Promise<string[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const ids: string[] = [];
  try {
    for await (const model of client.models.list()) ids.push(model.id);
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new ProviderError('claude', error.status ?? null, scrub(error.message, apiKey));
    throw new ProviderError('claude', null, 'Network error');
  }
  return ids;
}
