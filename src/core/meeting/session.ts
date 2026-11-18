import { NoApiKeyError, ProviderError, isAbort } from '../ai/providers';
import type { runJob } from '../ai/run';
import { PROVIDER_NAMES } from '../shared/types';
import { isEcho } from '../audio/echo';
import type { Meeting, Profile, ProviderId, Settings, Suggestions, TranscriptLine } from '../shared/types';
import { newId, type Db } from '../storage/db';
import { matchPrepared, type PreparedAnswer } from './prepared';
import { needsReply } from './relevance';
import {
  buildQuickTypeUser, buildSuggestUser, buildSummaryPrompt, buildSystem, parseSuggestions, splitSummary, type Memory,
} from './prompts';

export interface SessionState {
  phase: 'idle' | 'live' | 'ending' | 'ended';
  /** True while the call audio and microphone are being listened to. */
  listening: boolean;
  lastClientText: string;
  suggestions: Suggestions;
  suggesting: boolean;
  quickType: { rough: string; result: string; busy: boolean } | null;
  /** The provider that is answering (or answered) the current suggestions. */
  provider: ProviderId | null;
  /** Plain English, shown in the panel. */
  error: string | null;
  lineCount: number;
  transcript: TranscriptLine[];
  meeting: Meeting | null;
  /** The owner's own prepared answer that fits what the client just said. */
  prepared: PreparedAnswer | null;
  /** The latest client remark that was heard but judged to need no reply. */
  skipped: string | null;
}

export interface SessionDeps {
  db: Db;
  getSettings(): Promise<Settings>;
  getProfile(): Promise<Profile>;
  getPrepared?(): Promise<PreparedAnswer[]>;
  run: typeof runJob;
  now(): number;
}

const MAX_TOKENS = { suggest: 1024, quickType: 1024, summary: 4096 };

export function errorMessage(error: unknown): string {
  if (isAbort(error)) return '';
  if (error instanceof NoApiKeyError) return 'Add an API key in Settings to get suggestions.';
  if (error instanceof ProviderError) {
    const name = PROVIDER_NAMES[error.provider];
    if (error.status === 401 || error.status === 403) return `The ${name} API key was rejected. Check it in Settings.`;
    if (error.status === 429) return `${name} rate limit reached. Try again in a moment.`;
    return `Could not get an answer from ${name}: ${error.message}`;
  }
  return 'Could not get an answer (network problem).';
}

async function loadMemory(deps: SessionDeps, meeting: Meeting): Promise<Memory> {
  const [profile, client, meetings, prepared] = await Promise.all([
    deps.getProfile(),
    deps.db.getClient(meeting.clientId),
    deps.db.listMeetings(meeting.clientId),
    deps.getPrepared?.() ?? [],
  ]);
  if (!client) throw new Error('This client no longer exists.');
  return { profile, client, prepared, pastMeetings: meetings.filter((m) => m.id !== meeting.id && m.endedAt !== null) };
}

/** Write (or rewrite) the summary of a saved meeting. Throws if the AI call fails. */
export async function summarise(deps: SessionDeps, meeting: Meeting): Promise<Meeting> {
  const memory = await loadMemory(deps, meeting);
  const settings = await deps.getSettings();
  const { system, user } = buildSummaryPrompt(memory, meeting.transcript);
  let text = '';
  await deps.run('summary', { system, user, maxTokens: MAX_TOKENS.summary }, settings, {
    onDelta: (t) => (text += t),
    onProvider: () => {},
  });
  const { summary, practice } = splitSummary(text);
  const done: Meeting = { ...meeting, endedAt: meeting.endedAt ?? deps.now(), summary: summary || null, practice };
  await deps.db.saveMeeting(done);
  return done;
}

const INITIAL: SessionState = {
  phase: 'idle',
  listening: false,
  lastClientText: '',
  suggestions: {},
  suggesting: false,
  quickType: null,
  provider: null,
  error: null,
  lineCount: 0,
  transcript: [],
  meeting: null,
  prepared: null,
  skipped: null,
};

/** One meeting from start to saved summary. Knows nothing about the UI or Chrome. */
export class MeetingSession {
  private state: SessionState = INITIAL;
  private listeners = new Set<(s: SessionState) => void>();
  private meeting: Meeting | null = null;
  private system = '';
  /** Increases with every suggestion request; only the newest may touch the state. */
  private suggestSeq = 0;
  private suggestAbort: AbortController | null = null;
  private quickAbort: AbortController | null = null;
  private saving: Promise<void> = Promise.resolve();
  private prepared: PreparedAnswer[] = [];
  private replyToEverything = false;
  /** The newest thing the client said, whether or not it got replies. */
  private latestClientText = '';

  constructor(private readonly deps: SessionDeps) {}

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): SessionState {
    return this.state;
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async start(clientId: string, meetCode: string): Promise<void> {
    if (meetCode) await this.deps.db.linkMeetCode(clientId, meetCode);
    const meeting: Meeting = {
      id: newId(), clientId, meetCode, startedAt: this.deps.now(), endedAt: null, transcript: [], summary: null,
    };
    await this.begin(meeting);
    await this.deps.db.saveMeeting(meeting);
  }

  /** Continue a meeting that never finished (for example the panel was closed). */
  async resume(meeting: Meeting): Promise<void> {
    await this.begin({ ...meeting, endedAt: null, transcript: [...meeting.transcript] });
  }

  private async begin(meeting: Meeting): Promise<void> {
    const [memory, settings] = await Promise.all([loadMemory(this.deps, meeting), this.deps.getSettings()]);
    this.meeting = meeting;
    this.system = buildSystem(memory);
    this.prepared = memory.prepared ?? [];
    this.replyToEverything = settings.replyTo === 'everything';
    const lastClient = [...meeting.transcript].reverse().find((l) => !l.own);
    this.latestClientText = lastClient?.text ?? '';
    this.set({
      ...INITIAL,
      phase: 'live',
      listening: this.state.listening,
      transcript: meeting.transcript,
      lineCount: meeting.transcript.length,
      lastClientText: lastClient?.text ?? '',
      meeting,
    });
  }

  setListening(listening: boolean): void {
    if (listening !== this.state.listening) this.set({ listening });
  }

  dismissError(): void {
    if (this.state.error) this.set({ error: null });
  }

  /**
   * Something was said. `client` is the call audio, `me` the owner's
   * microphone. Microphone text that repeats what the client just said is the
   * call playing through speakers, and is dropped.
   */
  addSpeech(source: 'client' | 'me', text: string, at: number = this.deps.now()): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || !this.meeting || this.state.phase !== 'live') return;
    if (source === 'me') {
      const recentClient = this.meeting.transcript.filter((l) => !l.own).slice(-5);
      if (isEcho(clean, recentClient, at)) return;
    }
    this.onLine({ speaker: source === 'client' ? 'Client' : 'Me', text: clean, at, own: source === 'me' });
  }

  private onLine(line: TranscriptLine): void {
    if (!this.meeting) return;
    this.meeting = { ...this.meeting, transcript: [...this.meeting.transcript, line] };
    this.saveDraft();
    this.set({ transcript: this.meeting.transcript, lineCount: this.meeting.transcript.length, meeting: this.meeting });
    if (line.own) return;
    this.latestClientText = line.text;
    if (this.state.phase !== 'live') return;
    // A prepared answer shows at once; it also means the remark needs a reply.
    const prepared = matchPrepared(line.text, this.prepared);
    if (prepared || this.replyToEverything || needsReply(line.text)) this.suggest(prepared);
    else this.set({ skipped: line.text });
  }

  /** Writes happen one after another so an older save can never land last. */
  private saveDraft(): void {
    const snapshot = this.meeting;
    if (!snapshot) return;
    this.saving = this.saving.then(() => this.deps.db.saveMeeting(snapshot)).catch(() => {});
  }

  suggestNow(): void {
    if (this.state.phase !== 'live') return;
    if (!this.state.transcript.some((l) => !l.own)) {
      this.set({ error: 'Nothing heard from the call yet. Check that SARTHI can hear the call in Settings → Listening.' });
      return;
    }
    this.suggest();
  }

  private suggest(prepared: PreparedAnswer | null = matchPrepared(this.latestClientText, this.prepared)): void {
    this.suggestAbort?.abort();
    const abort = new AbortController();
    this.suggestAbort = abort;
    const seq = ++this.suggestSeq;
    const newest = () => seq === this.suggestSeq;
    const lastClientText = this.latestClientText;
    this.set({ suggestions: {}, suggesting: true, error: null, provider: null, lastClientText, prepared, skipped: null });

    const transcript = this.state.transcript;
    let text = '';
    void (async () => {
      try {
        const settings = await this.deps.getSettings();
        if (!newest()) return;
        await this.deps.run(
          'live',
          { system: this.system, user: buildSuggestUser(transcript, lastClientText), maxTokens: MAX_TOKENS.suggest, signal: abort.signal },
          settings,
          {
            onDelta: (t) => {
              if (!newest()) return;
              text += t;
              this.set({ suggestions: parseSuggestions(text) });
            },
            onProvider: (provider) => {
              if (newest()) this.set({ provider });
            },
          },
        );
        if (newest()) this.set({ suggesting: false });
      } catch (error) {
        if (!newest()) return;
        this.set({ suggesting: false, error: errorMessage(error) || null });
      }
    })();
  }

  async quickType(rough: string): Promise<void> {
    const note = rough.trim();
    if (!note || this.state.phase !== 'live') return;
    this.quickAbort?.abort();
    const abort = new AbortController();
    this.quickAbort = abort;
    const current = () => this.quickAbort === abort;
    this.set({ quickType: { rough: note, result: '', busy: true }, error: null });
    let text = '';
    try {
      const settings = await this.deps.getSettings();
      await this.deps.run(
        'live',
        {
          system: this.system,
          user: buildQuickTypeUser(this.state.transcript, this.latestClientText, note),
          maxTokens: MAX_TOKENS.quickType,
          signal: abort.signal,
        },
        settings,
        {
          onDelta: (t) => {
            if (!current()) return;
            text += t;
            this.set({ quickType: { rough: note, result: text, busy: true } });
          },
          onProvider: () => {},
        },
      );
      if (current()) this.set({ quickType: { rough: note, result: text.trim(), busy: false } });
    } catch (error) {
      if (!current()) return;
      this.set({ quickType: { rough: note, result: text.trim(), busy: false }, error: errorMessage(error) || null });
    }
  }

  /** Save the transcript, then write the summary. Always resolves once the transcript is safe. */
  async end(): Promise<Meeting> {
    if (!this.meeting) throw new Error('No meeting is running.');
    if (this.state.phase === 'ended') return this.meeting;
    this.set({ phase: 'ending', suggesting: false });
    this.suggestSeq++;
    this.suggestAbort?.abort();
    this.quickAbort?.abort();

    this.meeting = { ...this.meeting, endedAt: this.deps.now() };
    this.saveDraft();
    await this.saving;

    let error: string | null = null;
    if (this.meeting.transcript.length > 0) {
      try {
        this.meeting = await summarise(this.deps, this.meeting);
      } catch (e) {
        error = `The meeting is saved, but the summary could not be written. ${errorMessage(e)}`.trim();
      }
    }
    this.set({ phase: 'ended', meeting: this.meeting, error });
    return this.meeting;
  }
}
