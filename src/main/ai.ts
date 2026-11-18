import type { WebContents } from 'electron';
import { listModels, PROVIDERS, type Provider } from '../core/ai/providers';
import { runJob } from '../core/ai/run';
import type { Job, ProviderId } from '../core/shared/types';
import { CHANNELS, type AiEvent, type AiRequest, type PublicSettings } from '../shared/api';
import { toWire, type WireError } from '../shared/wire';
import type { KeyStore } from './secrets';

/**
 * Runs AI requests for the windows. Keys are added here, in the main process,
 * and answers stream back as events. Each request can be cancelled by id.
 */
export class AiService {
  private running = new Map<string, AbortController>();

  constructor(
    private readonly keys: KeyStore,
    private readonly providers: Record<ProviderId, Provider> = PROVIDERS,
  ) {}

  start(sender: WebContents, id: string, job: Job, request: AiRequest, settings: PublicSettings): void {
    const abort = new AbortController();
    this.running.set(id, abort);
    const send = (event: Omit<AiEvent, 'id'>) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.aiEvent, { id, ...event } satisfies AiEvent);
    };
    runJob(
      job,
      { ...request, signal: abort.signal },
      { ...settings, keys: this.keys.all() },
      { onDelta: (text) => send({ type: 'delta', text }), onProvider: (provider) => send({ type: 'provider', provider }) },
      { providers: this.providers },
    ).then(
      () => send({ type: 'done' }),
      (error) => send({ type: 'error', error: toWire(error) }),
    ).finally(() => this.running.delete(id));
  }

  cancel(id: string): void {
    this.running.get(id)?.abort();
    this.running.delete(id);
  }

  /** Resolves to null when the key works. */
  async test(provider: ProviderId, model: string): Promise<WireError | null> {
    const key = this.keys.get(provider);
    if (!key) return toWire(new Error('Enter a key first.'));
    try {
      await this.providers[provider].stream(
        { system: 'Reply with the single word OK.', user: 'OK?', model, maxTokens: 64, fast: true },
        key,
        () => {},
      );
      return null;
    } catch (error) {
      return toWire(error);
    }
  }

  async models(provider: ProviderId): Promise<{ models?: string[]; error?: WireError }> {
    const key = this.keys.get(provider);
    if (!key) return { error: toWire(new Error(`Add the ${provider} API key first.`)) };
    try {
      return { models: await listModels(provider, key) };
    } catch (error) {
      return { error: toWire(error) };
    }
  }
}

/** Used only by automated tests: answers instantly without any network. */
export function fakeProviders(): Record<ProviderId, Provider> {
  const fake: Provider = {
    id: 'claude',
    async stream(req, _key, onDelta) {
      const user = req.user;
      const text = user.includes('My answer:')
        ? 'We can deliver it by Friday, with two free revisions.'
        : req.system.includes('Open questions')
          ? 'Decided\n- First version by Friday\nOpen questions\n- None\nI promised\n- None\nClient promised\n- None\n\n=== PHRASES ===\n- I can have it ready by Friday.'
          : 'SHORT: Sure, I can have it ready by Friday.\nDETAILED: Sure. I can have the first version ready by Friday, and then we can review it together.\nSAFE: Let me check my schedule and confirm by tomorrow.';
      for (const part of text.match(/[\s\S]{1,16}/g) ?? []) {
        if (req.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        onDelta(part);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
  return { claude: fake, openai: { ...fake, id: 'openai' }, gemini: { ...fake, id: 'gemini' }, nvidia: { ...fake, id: 'nvidia' } };
}
