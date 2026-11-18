import { DEFAULT_MODELS, FIRST_TOKEN_TIMEOUT_MS } from '../shared/defaults';
import type { Job, ProviderId, Settings } from '../shared/types';
import { NoApiKeyError, PROVIDERS, ProviderError, type ChatRequest, type Provider } from './providers';

/** The chosen provider first, then the fallback order; only providers that have a key. */
export function providerOrder(job: Job, s: Settings): ProviderId[] {
  const order = [s[job].provider, ...s.fallbackOrder];
  return order.filter((id, i) => order.indexOf(id) === i && s.keys[id].trim() !== '');
}

export function modelFor(provider: ProviderId, job: Job, s: Settings): string {
  return s[job].provider === provider && s[job].model.trim() ? s[job].model.trim() : DEFAULT_MODELS[provider][job];
}

export interface RunCallbacks {
  onDelta(text: string): void;
  /** Called each time a provider is about to be tried. */
  onProvider(provider: ProviderId): void;
}

export interface RunDeps {
  providers?: Record<ProviderId, Provider>;
  firstTokenTimeoutMs?: number;
}

export type JobRequest = Pick<ChatRequest, 'system' | 'user' | 'maxTokens' | 'signal'>;

/**
 * Run a request on the chosen provider. If it fails, stays silent too long,
 * or returns nothing, try the next provider that has a key. Once any text
 * has reached the caller there is no fallback: the text is already on screen.
 */
export async function runJob(job: Job, req: JobRequest, s: Settings, cb: RunCallbacks, deps: RunDeps = {}): Promise<void> {
  const providers = deps.providers ?? PROVIDERS;
  const timeoutMs = deps.firstTokenTimeoutMs ?? FIRST_TOKEN_TIMEOUT_MS;
  const order = providerOrder(job, s);
  if (order.length === 0) throw new NoApiKeyError();

  let lastError: unknown;
  for (const [index, id] of order.entries()) {
    // Only give up on a slow provider when there is another one to try.
    const hasNext = index < order.length - 1;
    if (req.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const attempt = new AbortController();
    const cancel = () => attempt.abort();
    req.signal?.addEventListener('abort', cancel);
    let answered = false;
    let timedOut = false;
    const timer = hasNext
      ? setTimeout(() => {
          timedOut = true;
          attempt.abort();
        }, timeoutMs)
      : undefined;

    cb.onProvider(id);
    try {
      await providers[id].stream(
        { ...req, model: modelFor(id, job, s), fast: job === 'live', signal: attempt.signal },
        s.keys[id].trim(),
        (text) => {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
          }
          cb.onDelta(text);
        },
      );
      if (answered) return;
      lastError = new ProviderError(id, null, 'The provider returned an empty answer.');
    } catch (error) {
      if (req.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const wrapped = timedOut
        ? new ProviderError(id, null, 'The provider did not answer in time.')
        : error instanceof ProviderError
          ? error
          : new ProviderError(id, null, 'Network error');
      if (answered) throw wrapped;
      lastError = wrapped;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', cancel);
    }
  }
  throw lastError;
}
