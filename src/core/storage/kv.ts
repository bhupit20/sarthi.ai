import { openDB } from 'idb';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

/** Backed by IndexedDB in the app's own profile (stays on this Mac). */
export function idbStore(name = 'sarthi-kv'): KeyValueStore {
  const db = openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
    },
  });
  return {
    async get<T>(key: string) {
      return (await (await db).get('kv', key)) as T | undefined;
    },
    async set(key, value) {
      await (await db).put('kv', structuredClone(value), key);
    },
    async clear() {
      await (await db).clear('kv');
    },
  };
}

export function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      const v = data.get(key);
      return v === undefined ? undefined : (structuredClone(v) as T);
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async clear() {
      data.clear();
    },
  };
}
