import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbStore } from '../../../src/core/storage/kv';

describe('idbStore', () => {
  it('keeps values, returns copies, and clears', async () => {
    const kv = idbStore(`kv-${Math.random()}`);
    expect(await kv.get('missing')).toBeUndefined();
    const value = { text: 'hello', list: [1, 2] };
    await kv.set('profile', value);
    value.list.push(3);
    expect(await kv.get('profile')).toEqual({ text: 'hello', list: [1, 2] });
    await kv.clear();
    expect(await kv.get('profile')).toBeUndefined();
  });

  it('keeps data across reopening the same store', async () => {
    const name = `kv-${Math.random()}`;
    await idbStore(name).set('a', 1);
    expect(await idbStore(name).get('a')).toBe(1);
  });
});
