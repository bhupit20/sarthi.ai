import { DEFAULT_SETTINGS } from '../shared/defaults';
import { PROVIDER_IDS, type Profile, type ProviderId, type Settings } from '../shared/types';
import type { KeyValueStore } from './kv';

const SETTINGS_KEY = 'settings';
const PROFILE_KEY = 'profile';

export async function loadSettings(kv: KeyValueStore): Promise<Settings> {
  const stored = (await kv.get<Partial<Settings>>(SETTINGS_KEY)) ?? {};
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...stored,
    keys: { ...DEFAULT_SETTINGS.keys, ...stored.keys },
    live: { ...DEFAULT_SETTINGS.live, ...stored.live },
    summary: { ...DEFAULT_SETTINGS.summary, ...stored.summary },
    fallbackOrder: completeOrder(stored.fallbackOrder),
  };
}

/** Keep the owner's order, drop providers that no longer exist, and add new ones at the end. */
function completeOrder(stored: unknown): ProviderId[] {
  const known = Array.isArray(stored) ? stored.filter((id): id is ProviderId => PROVIDER_IDS.includes(id)) : [];
  const order = known.length ? known : [...DEFAULT_SETTINGS.fallbackOrder];
  return [...order, ...PROVIDER_IDS.filter((id) => !order.includes(id))];
}

export async function saveSettings(kv: KeyValueStore, s: Settings): Promise<void> {
  await kv.set(SETTINGS_KEY, s);
}

export async function loadProfile(kv: KeyValueStore): Promise<Profile> {
  return (await kv.get<Profile>(PROFILE_KEY)) ?? { text: '' };
}

export async function saveProfile(kv: KeyValueStore, p: Profile): Promise<void> {
  await kv.set(PROFILE_KEY, p);
}
