import { openDB, type IDBPDatabase } from 'idb';
import type { Client, Meeting } from '../shared/types';

export interface Db {
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  saveClient(c: Client): Promise<void>;
  /** Also deletes the client's meetings. */
  deleteClient(id: string): Promise<void>;
  findClientByMeetCode(code: string): Promise<Client | undefined>;
  /** A meet code belongs to one client: linking removes it from any other. */
  linkMeetCode(clientId: string, code: string): Promise<void>;
  saveMeeting(m: Meeting): Promise<void>;
  /** Newest first. */
  listMeetings(clientId: string): Promise<Meeting[]>;
  unfinishedMeetings(): Promise<Meeting[]>;
  exportAll(): Promise<{ clients: Client[]; meetings: Meeting[] }>;
  deleteAll(): Promise<void>;
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function openDb(name = 'meet-reply-assistant'): Promise<Db> {
  const idb: IDBPDatabase = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('clients', { keyPath: 'id' });
      const meetings = db.createObjectStore('meetings', { keyPath: 'id' });
      meetings.createIndex('clientId', 'clientId');
    },
  });

  const allClients = () => idb.getAll('clients') as Promise<Client[]>;

  return {
    async listClients() {
      const clients = await allClients();
      return clients.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },
    getClient: (id) => idb.get('clients', id),
    async saveClient(c) {
      await idb.put('clients', c);
    },
    async deleteClient(id) {
      const tx = idb.transaction(['clients', 'meetings'], 'readwrite');
      await tx.objectStore('clients').delete(id);
      const keys = await tx.objectStore('meetings').index('clientId').getAllKeys(id);
      await Promise.all(keys.map((k) => tx.objectStore('meetings').delete(k)));
      await tx.done;
    },
    async findClientByMeetCode(code) {
      return (await allClients()).find((c) => c.meetCodes.includes(code));
    },
    async linkMeetCode(clientId, code) {
      const tx = idb.transaction('clients', 'readwrite');
      const clients = (await tx.store.getAll()) as Client[];
      for (const c of clients) {
        const has = c.meetCodes.includes(code);
        if (c.id === clientId && !has) {
          await tx.store.put({ ...c, meetCodes: [...c.meetCodes, code] });
        } else if (c.id !== clientId && has) {
          await tx.store.put({ ...c, meetCodes: c.meetCodes.filter((m) => m !== code) });
        }
      }
      await tx.done;
    },
    async saveMeeting(m) {
      await idb.put('meetings', m);
    },
    async listMeetings(clientId) {
      const meetings = (await idb.getAllFromIndex('meetings', 'clientId', clientId)) as Meeting[];
      return meetings.sort((a, b) => b.startedAt - a.startedAt);
    },
    async unfinishedMeetings() {
      const meetings = (await idb.getAll('meetings')) as Meeting[];
      return meetings.filter((m) => m.endedAt === null).sort((a, b) => b.startedAt - a.startedAt);
    },
    async exportAll() {
      return { clients: await allClients(), meetings: (await idb.getAll('meetings')) as Meeting[] };
    },
    async deleteAll() {
      const tx = idb.transaction(['clients', 'meetings'], 'readwrite');
      await tx.objectStore('clients').clear();
      await tx.objectStore('meetings').clear();
      await tx.done;
    },
  };
}
