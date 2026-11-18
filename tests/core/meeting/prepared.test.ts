import { describe, expect, it } from 'vitest';
import { loadPrepared, matchPrepared, savePrepared, type PreparedAnswer } from '../../../src/core/meeting/prepared';
import { memoryStore } from '../../../src/core/storage/kv';

const price: PreparedAnswer = { id: 'p', keywords: 'price, cost, how much, charge', answer: 'A standard store is $900.' };
const time: PreparedAnswer = { id: 't', keywords: 'how long, timeline, deliver', answer: 'It usually takes two weeks.' };
const revisions: PreparedAnswer = { id: 'r', keywords: 'revision, changes', answer: 'Two revisions are free.' };
const list = [price, time, revisions];

describe('matchPrepared', () => {
  it('finds the answer whose words the client used', () => {
    expect(matchPrepared('What is the total price?', list)?.id).toBe('p');
    expect(matchPrepared('How long will it take?', list)?.id).toBe('t');
  });

  it('matches plurals and ignores capitals and punctuation', () => {
    expect(matchPrepared('How many REVISIONS do we get?', list)?.id).toBe('r');
    expect(matchPrepared('And the costs, roughly?', list)?.id).toBe('p');
  });

  it('matches whole words only', () => {
    expect(matchPrepared('The delivery was priceless', list)).toBeNull();
    expect(matchPrepared('We exchanged emails', list)).toBeNull();
  });

  it('prefers the answer with more matching words, then the more specific phrase', () => {
    expect(matchPrepared('How much does it cost and how long does it take?', list)?.id).toBe('p');
    expect(matchPrepared('How long, and what changes can we make?', list)?.id).toBe('t');
  });

  it('matches a longer phrase on its important words, in any order', () => {
    const cost: PreparedAnswer = { id: 'c', keywords: 'what is the project cost ?', answer: 'Around 2000 dollars.' };
    expect(matchPrepared('How much will the project cost?', [cost])?.id).toBe('c');
    expect(matchPrepared('And the cost of the whole project?', [cost])?.id).toBe('c');
    expect(matchPrepared('What is the timeline for the project?', [cost])).toBeNull();
  });

  it('needs the exact words when a phrase has only common words', () => {
    const howMuch: PreparedAnswer = { id: 'h', keywords: 'how much', answer: 'Around 2000 dollars.' };
    expect(matchPrepared('How much is it?', [howMuch])?.id).toBe('h');
    expect(matchPrepared('How is it going so much?', [howMuch])).toBeNull();
  });

    it('returns nothing when no words match', () => {
    expect(matchPrepared('Okay that works for me', list)).toBeNull();
  });

  it('ignores entries that have no words or no answer yet', () => {
    expect(matchPrepared('What is the price?', [{ id: 'x', keywords: 'price', answer: '  ' }, { id: 'y', keywords: ' , ', answer: 'Hi' }])).toBeNull();
  });
});

describe('prepared answer storage', () => {
  it('starts empty and keeps what is saved', async () => {
    const kv = memoryStore();
    expect(await loadPrepared(kv)).toEqual([]);
    await savePrepared(kv, list);
    expect(await loadPrepared(kv)).toEqual(list);
  });
});
