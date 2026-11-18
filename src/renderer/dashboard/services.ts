import { loadPrepared } from '../../core/meeting/prepared';
import type { SessionDeps } from '../../core/meeting/session';
import { openDb } from '../../core/storage/db';
import { idbStore, type KeyValueStore } from '../../core/storage/kv';
import { loadProfile, loadSettings } from '../../core/storage/settings';
import { remoteRun } from '../lib/bridge';

export interface Services {
  deps: SessionDeps;
  kv: KeyValueStore;
}

export async function createServices(): Promise<Services> {
  const kv = idbStore('sarthi-kv');
  const db = await openDb('sarthi');
  return {
    kv,
    deps: {
      db,
      getSettings: () => loadSettings(kv),
      getProfile: () => loadProfile(kv),
      getPrepared: () => loadPrepared(kv),
      run: remoteRun,
      now: () => Date.now(),
    },
  };
}
