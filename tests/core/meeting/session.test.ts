import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoApiKeyError, ProviderError } from '../../../src/core/ai/providers';
import type { JobRequest, RunCallbacks } from '../../../src/core/ai/run';
import { MeetingSession, errorMessage, type SessionDeps } from '../../../src/core/meeting/session';
import { DEFAULT_SETTINGS } from '../../../src/core/shared/defaults';
import type { PreparedAnswer } from '../../../src/core/meeting/prepared';
import type { Client, Job, Settings } from '../../../src/core/shared/types';
import { newId, openDb, type Db } from '../../../src/core/storage/db';

interface Call {
  job: Job;
  req: JobRequest;
  cb: RunCallbacks;
  resolve(): void;
  reject(e: unknown): void;
}

function fakeRun() {
  const calls: Call[] = [];
  const run = ((job: Job, req: JobRequest, _s: Settings, cb: RunCallbacks) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ job, req, cb, resolve, reject });
      req.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    })) as SessionDeps['run'];
  return { run, calls };
}

/** Let IndexedDB and promise chains finish (setImmediate stays real). */
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

describe('MeetingSession', () => {
  let db: Db;
  let client: Client;
  let calls: Call[];
  let session: MeetingSession;
  let settings: Settings;
  let prepared: PreparedAnswer[];

  /** The client's voice from the call audio, or the owner's microphone ("You"). */
  const say = async (_blockId: string, speaker: string, text: string) => {
    session.addSpeech(speaker === 'You' ? 'me' : 'client', text);
    await settle();
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    db = await openDb(`session-${newId()}`);
    client = { id: newId(), name: 'Acme Co', notes: 'Redesign project.', importedNotes: '', meetCodes: [], createdAt: 1 };
    await db.saveClient(client);
    settings = { ...DEFAULT_SETTINGS, myMeetName: 'Bhupinder Singh' };
    prepared = [{ id: 'p', keywords: 'price, cost', answer: 'A standard store is $900.' }];
    const fake = fakeRun();
    calls = fake.calls;
    session = new MeetingSession({
      db,
      getSettings: async () => settings,
      getProfile: async () => ({ text: 'I build Shopify stores.' }),
      getPrepared: async () => prepared,
      run: fake.run,
      now: () => Date.now(),
    });
    await session.start(client.id, 'abc-defg-hij');
  });
  afterEach(() => vi.useRealTimers());

  it('starts live and remembers which client this Meet link belongs to', async () => {
    expect(session.getState().phase).toBe('live');
    expect((await db.findClientByMeetCode('abc-defg-hij'))?.id).toBe(client.id);
  });

  it('asks for replies when the client finishes a sentence and streams them into the state', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.job).toBe('live');
    expect(calls[0]!.req.system).toContain('Acme Co');
    expect(calls[0]!.req.system).toContain('I build Shopify stores.');
    expect(calls[0]!.req.user).toContain('When can you deliver the first version?');
    expect(session.getState()).toMatchObject({ lastClientText: 'When can you deliver the first version?', suggesting: true });

    calls[0]!.cb.onProvider('claude');
    calls[0]!.cb.onDelta('SHORT: By Fri');
    expect(session.getState().suggestions).toEqual({ short: 'By Fri' });
    calls[0]!.cb.onDelta('day.\nDETAILED: We can deliver by Friday.\nSAFE: Let me check.');
    calls[0]!.resolve();
    await settle();
    expect(session.getState()).toMatchObject({
      suggestions: { short: 'By Friday.', detailed: 'We can deliver by Friday.', safe: 'Let me check.' },
      suggesting: false,
      provider: 'claude',
      error: null,
    });
  });

  it('cancels the older request when the client speaks again, and ignores its late text', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    const firstSignal = calls[0]!.req.signal!;
    await say('b2', 'Sarah', 'Actually what is the total price?');
    expect(firstSignal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    calls[0]!.cb.onDelta('SHORT: stale answer');
    expect(session.getState().suggestions).toEqual({});
    calls[1]!.cb.onDelta('SHORT: fresh answer');
    expect(session.getState().suggestions).toEqual({ short: 'fresh answer' });
    await settle();
    expect(session.getState().error).toBeNull();
  });

  it('saves the meeting as a draft after the first line, before the meeting ends', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    const drafts = await db.unfinishedMeetings();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ clientId: client.id, endedAt: null });
    expect(drafts[0]!.transcript.map((l) => l.text)).toEqual(['When can you deliver the first version?']);
  });

  it('explains a missing API key and keeps working for the next sentence', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    calls[0]!.reject(new NoApiKeyError());
    await settle();
    expect(session.getState()).toMatchObject({ error: 'Add an API key in Settings to get suggestions.', suggesting: false });
    await say('b2', 'Sarah', 'And what is the total price?');
    expect(calls).toHaveLength(2);
    expect(session.getState().error).toBeNull();
  });

  it('Suggest now asks again for the last thing the client said', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    calls[0]!.resolve();
    session.suggestNow();
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.req.user).toContain('When can you deliver the first version?');
  });

  it('turns a rough typed note into a sentence', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    const done = session.quickType('delivery friday, 2 revisions free');
    await settle();
    const call = calls[1]!;
    expect(call.job).toBe('live');
    expect(call.req.user).toContain('delivery friday, 2 revisions free');
    expect(session.getState().quickType).toMatchObject({ rough: 'delivery friday, 2 revisions free', busy: true });
    call.cb.onDelta('We can deliver by Friday, ');
    call.cb.onDelta('with two free revisions.');
    call.resolve();
    await done;
    expect(session.getState().quickType).toEqual({
      rough: 'delivery friday, 2 revisions free', result: 'We can deliver by Friday, with two free revisions.', busy: false,
    });
    // Quick-type does not cancel the reply suggestions.
    expect(calls[0]!.req.signal!.aborted).toBe(false);
  });

  it('ends by saving the transcript and a summary', async () => {
    await say('b1', 'Sarah', 'We need the first version by Friday.');
    session.addSpeech('me', 'Okay');
    const ending = session.end();
    await settle();
    expect(session.getState().phase).toBe('ending');
    const summaryCall = calls.find((c) => c.job === 'summary')!;
    expect(summaryCall.req.user).toContain('Client: We need the first version by Friday.');
    expect(summaryCall.req.user).toContain('Me: Okay');
    summaryCall.cb.onDelta('Decided\n- First version by Friday\n\n=== PHRASES ===\n- I\'ll send it by Friday.\n- Does that work for you?');
    summaryCall.resolve();
    const meeting = await ending;
    expect(meeting.endedAt).not.toBeNull();
    expect(meeting.summary).toBe('Decided\n- First version by Friday');
    expect(meeting.practice).toEqual(["I'll send it by Friday.", 'Does that work for you?']);
    expect(session.getState().phase).toBe('ended');
    expect(await db.unfinishedMeetings()).toEqual([]);
    expect((await db.listMeetings(client.id))[0]).toMatchObject({ summary: 'Decided\n- First version by Friday' });
  });

  it('still finishes and keeps the transcript when the summary fails', async () => {
    await say('b1', 'Sarah', 'We need the first version by Friday.');
    const ending = session.end();
    await settle();
    calls.find((c) => c.job === 'summary')!.reject(new ProviderError('claude', 500, 'down'));
    const meeting = await ending;
    expect(meeting.summary).toBeNull();
    expect(meeting.endedAt).not.toBeNull();
    expect(session.getState()).toMatchObject({ phase: 'ended' });
    expect(session.getState().error).toContain('summary');
    expect((await db.listMeetings(client.id))[0]!.transcript).toHaveLength(1);
  });

  it('does not ask the AI to summarise a meeting where nothing was said', async () => {
    const meeting = await session.end();
    expect(calls).toHaveLength(0);
    expect(meeting).toMatchObject({ summary: null, transcript: [] });
  });

  it('ignores speech after the meeting has ended', async () => {
    await session.end();
    await say('b9', 'Sarah', 'One more thing about the project');
    expect(calls).toHaveLength(0);
  });

  it('does not ask for replies to small talk, and says so', async () => {
    await say('b1', 'Sarah', 'Okay that works for me');
    expect(calls).toHaveLength(0);
    expect(session.getState()).toMatchObject({ skipped: 'Okay that works for me', lineCount: 1, suggesting: false });
  });

  it('keeps the replies on screen when small talk follows a question', async () => {
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    calls[0]!.cb.onDelta('SHORT: By Friday.');
    calls[0]!.resolve();
    await say('b2', 'Sarah', 'No rush, take your time');
    expect(calls).toHaveLength(1);
    expect(session.getState()).toMatchObject({
      lastClientText: 'When can you deliver the first version?',
      suggestions: { short: 'By Friday.' },
      skipped: 'No rush, take your time',
    });
  });

  it('Suggest now answers small talk that was skipped', async () => {
    await say('b1', 'Sarah', 'Okay that works for me');
    session.suggestNow();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req.user.trimEnd().endsWith('Okay that works for me')).toBe(true);
    expect(session.getState()).toMatchObject({ lastClientText: 'Okay that works for me', skipped: null });
  });

  it('replies to everything when the owner chose that', async () => {
    settings = { ...settings, replyTo: 'everything' };
    await session.start(client.id, 'abc-defg-hij');
    await say('b1', 'Sarah', 'Okay that works for me');
    expect(calls).toHaveLength(1);
  });

  it('shows my prepared answer at once when the client uses its words, and still asks the AI', async () => {
    await say('b1', 'Sarah', 'So the cost is fine then');
    expect(session.getState().prepared).toMatchObject({ id: 'p', answer: 'A standard store is $900.' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req.system).toContain('A standard store is $900.');
  });

  it('clears the prepared answer when the next question is about something else', async () => {
    await say('b1', 'Sarah', 'What is the total price?');
    expect(session.getState().prepared?.id).toBe('p');
    await say('b2', 'Sarah', 'And when can you start?');
    expect(session.getState().prepared).toBeNull();
  });

  it('records the owner\'s own speech without asking for replies', async () => {
    await say('m1', 'You', 'I will send the design tomorrow');
    expect(calls).toHaveLength(0);
    expect(session.getState().transcript).toMatchObject([{ speaker: 'Me', own: true }]);
  });

  it('labels call audio as the client', async () => {
    await say('c1', 'Sarah', 'When can you deliver the first version?');
    expect(session.getState().transcript).toMatchObject([{ speaker: 'Client', own: false }]);
  });

  it('drops microphone lines that only repeat the call playing through the speakers', async () => {
    await say('c1', 'Sarah', 'When can you deliver the first version of the store?');
    await say('m1', 'You', 'when can you deliver the first version of the store');
    await say('m2', 'You', 'I can deliver it by Friday');
    expect(session.getState().transcript.map((l) => l.text)).toEqual([
      'When can you deliver the first version of the store?',
      'I can deliver it by Friday',
    ]);
  });

  it('reports whether it is listening', () => {
    session.setListening(true);
    expect(session.getState().listening).toBe(true);
    session.setListening(false);
    expect(session.getState().listening).toBe(false);
  });

  it('Suggest now explains when nothing has been heard from the call yet', async () => {
    session.suggestNow();
    await settle();
    expect(calls).toHaveLength(0);
    expect(session.getState().error).toMatch(/Nothing heard from the call yet/);
  });

  it('continues an unfinished meeting with its earlier lines', async () => {
    await say('c1', 'Sarah', 'We need the first version by Friday.');
    const [draft] = await db.unfinishedMeetings();
    const second = new MeetingSession({ db, getSettings: async () => settings, getProfile: async () => ({ text: '' }), run: (async () => {}) as SessionDeps['run'], now: () => Date.now() });
    await second.resume(draft!);
    expect(second.getState()).toMatchObject({ phase: 'live', lineCount: 1 });
    second.addSpeech('client', 'And the price is important too');
    await settle();
    expect((await db.unfinishedMeetings())[0]!.transcript).toHaveLength(2);
  });

  it('notifies subscribers of every change', async () => {
    const seen: string[] = [];
    const stop = session.subscribe((s) => seen.push(s.lastClientText));
    await say('b1', 'Sarah', 'When can you deliver the first version?');
    stop();
    await say('b2', 'Sarah', 'And what is the total price?');
    expect(seen).toContain('When can you deliver the first version?');
    expect(seen).not.toContain('And what is the total price?');
  });
});

describe('errorMessage', () => {
  it('writes plain messages for the common failures', () => {
    expect(errorMessage(new NoApiKeyError())).toBe('Add an API key in Settings to get suggestions.');
    expect(errorMessage(new ProviderError('openai', 401, 'x'))).toBe('The OpenAI API key was rejected. Check it in Settings.');
    expect(errorMessage(new ProviderError('gemini', 403, 'x'))).toBe('The Gemini API key was rejected. Check it in Settings.');
    expect(errorMessage(new ProviderError('claude', 429, 'x'))).toBe('Claude rate limit reached. Try again in a moment.');
    expect(errorMessage(new ProviderError('claude', 500, 'x'))).toBe('Could not get an answer from Claude: x');
    expect(errorMessage(new DOMException('c', 'AbortError'))).toBe('');
    expect(errorMessage(new Error('weird'))).toBe('Could not get an answer (network problem).');
  });
});
