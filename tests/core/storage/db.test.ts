import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Client, Meeting } from '../../../src/core/shared/types';
import { newId, openDb, type Db } from '../../../src/core/storage/db';

const client = (name: string): Client => ({ id: newId(), name, notes: '', importedNotes: '', meetCodes: [], createdAt: 1 });
const meeting = (clientId: string, startedAt: number, endedAt: number | null): Meeting => ({
  id: newId(), clientId, meetCode: 'abc-defg-hij', startedAt, endedAt, transcript: [], summary: null,
});

describe('db', () => {
  let db: Db;
  beforeEach(async () => {
    db = await openDb(`test-${newId()}`);
  });

  it('lists clients sorted by name', async () => {
    await db.saveClient(client('Zed Ltd'));
    await db.saveClient(client('acme'));
    expect((await db.listClients()).map((c) => c.name)).toEqual(['acme', 'Zed Ltd']);
  });

  it('moves a meet code to the client it was linked to last', async () => {
    const a = client('A');
    const b = client('B');
    await db.saveClient(a);
    await db.saveClient(b);
    await db.linkMeetCode(a.id, 'abc-defg-hij');
    await db.linkMeetCode(b.id, 'abc-defg-hij');
    expect((await db.findClientByMeetCode('abc-defg-hij'))?.id).toBe(b.id);
    expect((await db.getClient(a.id))?.meetCodes).toEqual([]);
    expect((await db.getClient(b.id))?.meetCodes).toEqual(['abc-defg-hij']);
  });

  it('lists a client\'s meetings newest first', async () => {
    const a = client('A');
    await db.saveClient(a);
    await db.saveMeeting(meeting(a.id, 100, 200));
    await db.saveMeeting(meeting(a.id, 300, 400));
    expect((await db.listMeetings(a.id)).map((m) => m.startedAt)).toEqual([300, 100]);
  });

  it('deletes a client together with its meetings', async () => {
    const a = client('A');
    const b = client('B');
    await db.saveClient(a);
    await db.saveClient(b);
    await db.saveMeeting(meeting(a.id, 1, 2));
    await db.saveMeeting(meeting(b.id, 1, 2));
    await db.deleteClient(a.id);
    expect(await db.getClient(a.id)).toBeUndefined();
    expect(await db.listMeetings(a.id)).toEqual([]);
    expect(await db.listMeetings(b.id)).toHaveLength(1);
  });

  it('finds only meetings that never finished', async () => {
    const a = client('A');
    await db.saveClient(a);
    await db.saveMeeting(meeting(a.id, 1, 2));
    const open = meeting(a.id, 3, null);
    await db.saveMeeting(open);
    expect((await db.unfinishedMeetings()).map((m) => m.id)).toEqual([open.id]);
  });

  it('exports clients and meetings without any API keys, and deletes everything', async () => {
    const a = client('A');
    await db.saveClient(a);
    await db.saveMeeting(meeting(a.id, 1, 2));
    const out = await db.exportAll();
    expect(out.clients).toHaveLength(1);
    expect(out.meetings).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain('"keys"');
    await db.deleteAll();
    expect(await db.exportAll()).toEqual({ clients: [], meetings: [] });
  });
});
