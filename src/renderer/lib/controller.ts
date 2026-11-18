import { MeetingSession, type SessionDeps, type SessionState } from '../../core/meeting/session';
import type { Meeting } from '../../core/shared/types';
import { ListeningEngine, type EngineStatus } from '../audio/engine';
import { Transcriber, type TranscriberStatus } from '../audio/transcriber';
import { sarthi } from './bridge';

export interface LiveSnapshot {
  session: SessionState | null;
  engine: EngineStatus;
  clientName: string;
}

const IDLE_ENGINE = (model: TranscriberStatus): EngineStatus => ({ call: 'off', mic: 'off', model, queued: 0 });

/**
 * One live session at a time: listening (call audio + microphone →
 * transcription) feeding the meeting session (replies, memory, summary).
 * Every change is published to the floating copilot.
 */
export class SessionController {
  readonly transcriber: Transcriber;
  private session: MeetingSession | null = null;
  private engine: ListeningEngine | null = null;
  private stopSession: (() => void) | null = null;
  private snapshot: LiveSnapshot;
  private listeners = new Set<(s: LiveSnapshot) => void>();

  constructor(private readonly deps: SessionDeps) {
    this.transcriber = new Transcriber((model) => {
      this.engine?.modelStatus(model);
      if (!this.engine) this.set({ engine: { ...this.snapshot.engine, model } });
    }, sarthi().test?.modelHost);
    this.snapshot = { session: null, engine: IDLE_ENGINE(this.transcriber.getStatus()), clientName: '' };
  }

  get(): LiveSnapshot {
    return this.snapshot;
  }

  subscribe(fn: (s: LiveSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn(this.snapshot);
    sarthi().copilot.publish(this.snapshot);
  }

  isLive(): boolean {
    const phase = this.snapshot.session?.phase;
    return phase === 'live' || phase === 'ending';
  }

  async start(clientId: string): Promise<void> {
    await this.begin((s) => s.start(clientId, ''), clientId);
  }

  async resume(meeting: Meeting): Promise<void> {
    await this.begin((s) => s.resume(meeting), meeting.clientId);
  }

  private async begin(run: (s: MeetingSession) => Promise<void>, clientId: string): Promise<void> {
    if (this.isLive()) throw new Error('A session is already running.');
    const session = new MeetingSession(this.deps);
    await run(session);
    const settings = await this.deps.getSettings();
    const client = await this.deps.db.getClient(clientId);
    this.session = session;
    this.stopSession?.();
    this.stopSession = session.subscribe((state) => this.set({ session: state }));
    this.set({ session: session.getState(), clientName: client?.name ?? '' });

    const engine = new ListeningEngine({
      transcriber: this.transcriber,
      pauseMs: Math.min(settings.pauseMs, 1200),
      listenToMic: settings.listenToMic,
      testCallAudioUrl: sarthi().test?.callAudioUrl,
      onSpeech: (source, text, at) => session.addSpeech(source, text, at),
      onStatus: (engineStatus) => {
        this.set({ engine: engineStatus });
        session.setListening(engineStatus.call === 'on' || engineStatus.mic === 'on');
      },
    });
    this.engine = engine;
    sarthi().copilot.show();
    await engine.start();
  }

  /** Transcribe what was just said, then ask for replies. */
  async suggestNow(): Promise<void> {
    if (!this.session) return;
    await this.engine?.flush();
    this.session.suggestNow();
  }

  quickType(text: string): void {
    void this.session?.quickType(text);
  }

  dismissError(): void {
    this.session?.dismissError();
  }

  async end(): Promise<void> {
    if (!this.session || !this.isLive()) return;
    await this.engine?.flush();
    this.engine?.stop();
    this.engine = null;
    await this.session.end();
  }

  /** Back to no session, after the summary has been shown. */
  clear(): void {
    this.stopSession?.();
    this.stopSession = null;
    this.session = null;
    this.set({ session: null, clientName: '', engine: IDLE_ENGINE(this.transcriber.getStatus()) });
  }
}
