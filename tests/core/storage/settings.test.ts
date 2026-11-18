import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/core/shared/defaults';
import { memoryStore } from '../../../src/core/storage/kv';
import { loadProfile, loadSettings, saveProfile, saveSettings } from '../../../src/core/storage/settings';

describe('settings', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a saved value and fills the rest from defaults', async () => {
    const kv = memoryStore();
    await saveSettings(kv, { ...DEFAULT_SETTINGS, pauseMs: 800 });
    const s = await loadSettings(kv);
    expect(s.pauseMs).toBe(800);
    expect(s.fallbackOrder).toEqual(['claude', 'gemini', 'openai', 'nvidia']);
  });

  it('fills fields missing from an older stored object', async () => {
    const kv = memoryStore();
    const { myMeetName: _drop, ...old } = DEFAULT_SETTINGS;
    await kv.set('settings', { ...old, keys: { claude: 'k' } });
    const s = await loadSettings(kv);
    expect(s.myMeetName).toBe('');
    expect(s.keys).toEqual({ claude: 'k', openai: '', gemini: '', nvidia: '' });
  });

  it('adds a newly supported provider to an older fallback order and drops unknown ones', async () => {
    const kv = memoryStore();
    await kv.set('settings', { ...DEFAULT_SETTINGS, fallbackOrder: ['openai', 'claude', 'retired', 'gemini'] });
    expect((await loadSettings(kv)).fallbackOrder).toEqual(['openai', 'claude', 'gemini', 'nvidia']);
  });

  it('stores the profile text', async () => {
    const kv = memoryStore();
    expect(await loadProfile(kv)).toEqual({ text: '' });
    await saveProfile(kv, { text: 'I build websites.' });
    expect(await loadProfile(kv)).toEqual({ text: 'I build websites.' });
  });
});
