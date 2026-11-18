// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../src/core/ai/providers';
import { DEFAULT_SETTINGS } from '../../src/core/shared/defaults';
import type { AiEvent, SarthiApi } from '../../src/shared/api';
import { toWire } from '../../src/shared/wire';
import { remoteRun } from '../../src/renderer/lib/bridge';

let listeners: Array<(e: AiEvent) => void>;
let started: Array<{ id: string; job: string; request: unknown; settings: Record<string, unknown> }>;
let cancelled: string[];

beforeEach(() => {
  listeners = [];
  started = [];
  cancelled = [];
  window.sarthi = {
    ai: {
      start: (id: string, job: string, request: unknown, settings: Record<string, unknown>) => started.push({ id, job, request, settings }),
      cancel: (id: string) => cancelled.push(id),
      onEvent: (fn: (e: AiEvent) => void) => {
        listeners.push(fn);
        return () => (listeners = listeners.filter((l) => l !== fn));
      },
    },
  } as unknown as SarthiApi;
});

const emit = (e: AiEvent) => listeners.forEach((l) => l(e));
const settings = { ...DEFAULT_SETTINGS, keys: { claude: 'SECRET', openai: '', gemini: '', nvidia: '' } };

describe('remoteRun', () => {
  it('streams text from the main process and never sends keys there', async () => {
    const deltas: string[] = [];
    const providers: string[] = [];
    const done = remoteRun('live', { system: 's', user: 'u', maxTokens: 10 }, settings, {
      onDelta: (t) => deltas.push(t),
      onProvider: (p) => providers.push(p),
    });
    const { id } = started[0]!;
    expect(started[0]!.settings).not.toHaveProperty('keys');
    expect(JSON.stringify(started[0])).not.toContain('SECRET');
    emit({ id: 'other', type: 'delta', text: 'ignored' });
    emit({ id, type: 'provider', provider: 'nvidia' });
    emit({ id, type: 'delta', text: 'Hel' });
    emit({ id, type: 'delta', text: 'lo' });
    emit({ id, type: 'done' });
    await done;
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(providers).toEqual(['nvidia']);
    expect(listeners).toHaveLength(0);
  });

  it('rejects with the original kind of error', async () => {
    const done = remoteRun('live', { system: 's', user: 'u', maxTokens: 10 }, settings, { onDelta: vi.fn(), onProvider: vi.fn() });
    emit({ id: started[0]!.id, type: 'error', error: toWire(new ProviderError('gemini', 429, 'slow down')) });
    await expect(done).rejects.toMatchObject({ provider: 'gemini', status: 429 });
  });

  it('cancels in the main process when the request is aborted', async () => {
    const abort = new AbortController();
    const done = remoteRun('live', { system: 's', user: 'u', maxTokens: 10, signal: abort.signal }, settings, { onDelta: vi.fn(), onProvider: vi.fn() });
    abort.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toEqual([started[0]!.id]);
  });
});
