import { cleanTranscript } from '../../core/audio/transcript';
import { VoiceDetector, type Utterance } from '../../core/audio/vad';
import type { Transcriber, TranscriberStatus } from './transcriber';

export type Source = 'client' | 'me';
type StreamState = 'off' | 'starting' | 'on' | 'error';

export interface EngineStatus {
  call: StreamState;
  mic: StreamState;
  callError?: string;
  micError?: string;
  model: TranscriberStatus;
  /** Utterances waiting to be transcribed. */
  queued: number;
}

export interface EngineOptions {
  transcriber: Transcriber;
  onSpeech(source: Source, text: string, at: number): void;
  onStatus(status: EngineStatus): void;
  pauseMs: number;
  listenToMic: boolean;
  /** Automated tests only: play this file as the call instead of the Mac's audio. */
  testCallAudioUrl?: string;
}

const RATE = 16000;
const FRAME = 320; // 20 ms at 16 kHz

export const CALL_PERMISSION_HELP =
  'SARTHI cannot hear the call. In System Settings → Privacy & Security → Screen & System Audio Recording, turn SARTHI on, then press Start again.';
export const MIC_PERMISSION_HELP =
  'SARTHI cannot hear your microphone. In System Settings → Privacy & Security → Microphone, turn SARTHI on.';

/**
 * Listens to the call (the Mac's audio output: the client) and the
 * microphone (the owner), cuts each into utterances at pauses, and
 * transcribes them on this Mac. Client speech is transcribed first.
 */
export class ListeningEngine {
  private context: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private detectors = new Map<Source, VoiceDetector>();
  private queue: Array<{ source: Source; utterance: Utterance }> = [];
  private working = false;
  private idle: Array<() => void> = [];
  private stopped = false;
  private status: EngineStatus;

  constructor(private readonly options: EngineOptions) {
    this.status = { call: 'off', mic: 'off', model: options.transcriber.getStatus(), queued: 0 };
  }

  private set(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.options.onStatus(this.status);
  }

  modelStatus(model: TranscriberStatus): void {
    this.set({ model });
  }

  async start(): Promise<void> {
    this.stopped = false;
    void this.options.transcriber.load().catch(() => {});
    this.context = new AudioContext({ sampleRate: RATE });
    await this.context.audioWorklet.addModule(new URL('./capture.worklet.js', document.baseURI).href);
    await Promise.all([this.startCall(), this.options.listenToMic ? this.startMic() : Promise.resolve()]);
  }

  setPauseMs(ms: number): void {
    for (const detector of this.detectors.values()) detector.setPauseMs(ms);
  }

  private now(): number {
    return performance.timeOrigin + performance.now();
  }

  /** Feed a node into a voice detector for one source. */
  private attach(source: Source, node: AudioNode): void {
    const context = this.context!;
    const detector = new VoiceDetector({
      sampleRate: RATE,
      pauseMs: this.options.pauseMs,
      onUtterance: (utterance) => this.enqueue(source, utterance),
    });
    this.detectors.set(source, detector);
    const capture = new AudioWorkletNode(context, 'sarthi-capture');
    let pending = new Float32Array(0);
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const joined = new Float32Array(pending.length + event.data.length);
      joined.set(pending);
      joined.set(event.data, pending.length);
      let offset = 0;
      while (joined.length - offset >= FRAME) {
        detector.push(joined.slice(offset, offset + FRAME), this.now());
        offset += FRAME;
      }
      pending = joined.slice(offset);
    };
    node.connect(capture);
    // A worklet only runs when connected onward; a muted gain keeps it silent.
    const mute = context.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(context.destination);
  }

  private async startCall(): Promise<void> {
    this.set({ call: 'starting', callError: undefined });
    try {
      if (this.options.testCallAudioUrl) {
        await this.playTestCall(this.options.testCallAudioUrl);
      } else {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) throw new Error('no call audio');
        this.streams.push(stream);
        this.attach('client', this.context!.createMediaStreamSource(stream));
      }
      this.set({ call: 'on' });
    } catch {
      this.set({ call: 'error', callError: CALL_PERMISSION_HELP });
    }
  }

  private async startMic(): Promise<void> {
    this.set({ mic: 'starting', micError: undefined });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.streams.push(stream);
      this.attach('me', this.context!.createMediaStreamSource(stream));
      this.set({ mic: 'on' });
    } catch {
      this.set({ mic: 'error', micError: MIC_PERMISSION_HELP });
    }
  }

  /** Tests: play a recording, followed by silence, as if the client said it. */
  private async playTestCall(url: string): Promise<void> {
    const context = this.context!;
    const data = await (await fetch(url)).arrayBuffer();
    const decoded = await context.decodeAudioData(data);
    const padded = context.createBuffer(1, decoded.length + RATE * 2, RATE);
    padded.copyToChannel(decoded.getChannelData(0), 0);
    const player = context.createBufferSource();
    player.buffer = padded;
    this.attach('client', player);
    player.start();
  }

  private enqueue(source: Source, utterance: Utterance): void {
    this.queue.push({ source, utterance });
    this.set({ queued: this.queue.length });
    void this.work();
  }

  private async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        // The client's words matter most: transcribe them first.
        const index = Math.max(0, this.queue.findIndex((item) => item.source === 'client'));
        const [item] = this.queue.splice(index, 1);
        this.set({ queued: this.queue.length });
        try {
          const text = cleanTranscript(await this.options.transcriber.transcribe(item!.utterance.audio));
          if (text && !this.stopped) this.options.onSpeech(item!.source, text, item!.utterance.endedAt);
        } catch {
          // One failed utterance must not stop listening.
        }
      }
    } finally {
      this.working = false;
      this.idle.splice(0).forEach((resolve) => resolve());
    }
  }

  /** Finish speech in progress and wait until everything heard is transcribed. */
  async flush(): Promise<void> {
    for (const detector of this.detectors.values()) detector.flush(this.now());
    if (!this.working && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idle.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    for (const detector of this.detectors.values()) detector.flush(this.now());
    this.detectors.clear();
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    void this.context?.close();
    this.context = null;
    this.set({ call: 'off', mic: 'off' });
  }
}
