import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODELS, DEFAULT_SETTINGS } from '../../../src/core/shared/defaults';
import type { ProviderId, Settings } from '../../../src/core/shared/types';
import { NoApiKeyError, ProviderError, type ChatRequest, type Provider } from '../../../src/core/ai/providers';
import { modelFor, providerOrder, runJob } from '../../../src/core/ai/run';

const settings = (keys: Partial<Record<ProviderId, string>>, over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  keys: { claude: '', openai: '', gemini: '', nvidia: '', ...keys },
  ...over,
});

type Behaviour = (req: ChatRequest, onDelta: (t: string) => void) => Promise<void>;
const untilAborted = (req: ChatRequest) =>
  new Promise<void>((_, reject) => req.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

function fakeProviders(behaviours: Partial<Record<ProviderId, Behaviour>>) {
  const calls: { id: ProviderId; req: ChatRequest; key: string }[] = [];
  const make = (id: ProviderId): Provider => ({
    id,
    stream: async (req, key, onDelta) => {
      calls.push({ id, req, key });
      await (behaviours[id] ?? (async () => onDelta(`from ${id}`)))(req, onDelta);
    },
  });
  return { providers: { claude: make('claude'), openai: make('openai'), gemini: make('gemini'), nvidia: make('nvidia') }, calls };
}

const base = { system: 's', user: 'u', maxTokens: 10 };

describe('providerOrder', () => {
  it('puts the chosen provider first and skips providers without a key', () => {
    expect(providerOrder('live', settings({ gemini: 'g', openai: 'o' }))).toEqual(['gemini', 'openai']);
    expect(providerOrder('live', settings({ claude: 'c', openai: 'o' }, { live: { provider: 'openai', model: 'm' } }))).toEqual(['openai', 'claude']);
    expect(providerOrder('live', settings({}))).toEqual([]);
  });
});

describe('modelFor', () => {
  it('uses the chosen model for the chosen provider and the default for a fallback provider', () => {
    const s = settings({}, { live: { provider: 'claude', model: 'my-model' } });
    expect(modelFor('claude', 'live', s)).toBe('my-model');
    expect(modelFor('gemini', 'live', s)).toBe(DEFAULT_MODELS.gemini.live);
    expect(modelFor('claude', 'summary', s)).toBe(DEFAULT_SETTINGS.summary.model);
  });
});

describe('runJob', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const go = (s: Settings, providers: Record<ProviderId, Provider>, signal?: AbortSignal) => {
    const deltas: string[] = [];
    const used: ProviderId[] = [];
    const done = runJob('live', { ...base, signal }, s, { onDelta: (t) => deltas.push(t), onProvider: (p) => used.push(p) }, { providers, firstTokenTimeoutMs: 4000 });
    return { deltas, used, done };
  };

  it('sends the key, model and fast flag of the chosen provider', async () => {
    const { providers, calls } = fakeProviders({});
    const { deltas, done } = go(settings({ claude: 'ck' }), providers);
    await done;
    expect(deltas).toEqual(['from claude']);
    expect(calls[0]).toMatchObject({ id: 'claude', key: 'ck', req: { model: DEFAULT_SETTINGS.live.model, fast: true, system: 's', user: 'u' } });
  });

  it('marks summary requests as not fast', async () => {
    const { providers, calls } = fakeProviders({});
    await runJob('summary', base, settings({ claude: 'ck' }), { onDelta: () => {}, onProvider: () => {} }, { providers });
    expect(calls[0]!.req.fast).toBe(false);
  });

  it('falls back when the first provider fails before answering', async () => {
    const { providers } = fakeProviders({ claude: async () => { throw new ProviderError('claude', 500, 'boom'); } });
    const { deltas, used, done } = go(settings({ claude: 'c', gemini: 'g' }), providers);
    await done;
    expect(used).toEqual(['claude', 'gemini']);
    expect(deltas).toEqual(['from gemini']);
  });

  it('falls back when the first provider stays silent past the timeout, and cancels it', async () => {
    let firstSignal: AbortSignal | undefined;
    const { providers } = fakeProviders({ claude: (req) => { firstSignal = req.signal; return untilAborted(req); } });
    const { deltas, done } = go(settings({ claude: 'c', gemini: 'g' }), providers);
    await vi.advanceTimersByTimeAsync(3999);
    expect(deltas).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(firstSignal!.aborted).toBe(true);
    expect(deltas).toEqual(['from gemini']);
  });

  it('falls back when the first provider finishes without saying anything', async () => {
    const { providers } = fakeProviders({ claude: async () => {} });
    const { deltas, done } = go(settings({ claude: 'c', gemini: 'g' }), providers);
    await done;
    expect(deltas).toEqual(['from gemini']);
  });

  it('waits for the last provider instead of timing it out, since there is nothing to fall back to', async () => {
    const { providers } = fakeProviders({
      nvidia: async (_req, onDelta) => {
        await new Promise((r) => setTimeout(r, 9000));
        onDelta('slow but here');
      },
    });
    const { deltas, done } = go(settings({ nvidia: 'n' }), providers);
    await vi.advanceTimersByTimeAsync(9000);
    await done;
    expect(deltas).toEqual(['slow but here']);
  });

  it('does not fall back once text is on screen', async () => {
    const { providers, calls } = fakeProviders({ claude: async (_r, onDelta) => { onDelta('partial'); throw new ProviderError('claude', 500, 'cut off'); } });
    const { deltas, done } = go(settings({ claude: 'c', gemini: 'g' }), providers);
    await expect(done).rejects.toMatchObject({ provider: 'claude', status: 500 });
    expect(deltas).toEqual(['partial']);
    expect(calls.map((c) => c.id)).toEqual(['claude']);
  });

  it('does not time out a provider that has started answering', async () => {
    const { providers } = fakeProviders({
      claude: async (req, onDelta) => {
        onDelta('first');
        await new Promise((r) => setTimeout(r, 10_000));
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        onDelta('second');
      },
    });
    const { deltas, done } = go(settings({ claude: 'c', gemini: 'g' }), providers);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(deltas).toEqual(['first', 'second']);
  });

  it('rejects with NoApiKeyError when no provider has a key', async () => {
    const { providers } = fakeProviders({});
    await expect(go(settings({}), providers).done).rejects.toBeInstanceOf(NoApiKeyError);
  });

  it('stops everything when the caller cancels, without trying another provider', async () => {
    const { providers, calls } = fakeProviders({ claude: untilAborted });
    const ctrl = new AbortController();
    const { done } = go(settings({ claude: 'c', gemini: 'g' }), providers, ctrl.signal);
    const result = done.catch((e) => e);
    ctrl.abort();
    expect((await result).name).toBe('AbortError');
    expect(calls.map((c) => c.id)).toEqual(['claude']);
  });

  it('rethrows the last error when every provider fails, as a ProviderError', async () => {
    const { providers } = fakeProviders({
      claude: async () => { throw new ProviderError('claude', 401, 'no'); },
      gemini: async () => { throw new TypeError('Failed to fetch'); },
    });
    const error = await go(settings({ claude: 'c', gemini: 'g' }), providers).done.catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ provider: 'gemini', status: null });
  });
});
