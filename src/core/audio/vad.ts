export interface Utterance {
  audio: Float32Array;
  /** Milliseconds, on the same clock as the frames pushed in. */
  startedAt: number;
  endedAt: number;
}

export interface VoiceDetectorOptions {
  sampleRate: number;
  onUtterance(u: Utterance): void;
  /** Silence that ends an utterance. */
  pauseMs?: number;
  /** Speech needed before it counts as an utterance (drops clicks and coughs). */
  minSpeechMs?: number;
  /** Long speech is cut here so replies are not held back. */
  maxUtteranceMs?: number;
  /** Audio kept from just before speech starts, so first syllables are not lost. */
  prerollMs?: number;
}

const ABSOLUTE_FLOOR = 0.008;
const NOISE_MULTIPLIER = 3;
const TAIL_MS = 200;

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/**
 * Cuts a stream of short frames into utterances using loudness against an
 * adapting noise floor. Simple, fast and predictable; good for one speaker
 * per stream (call audio, or the owner's microphone).
 */
export class VoiceDetector {
  private pauseMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;
  private readonly prerollMs: number;
  private noise = ABSOLUTE_FLOOR / NOISE_MULTIPLIER;
  private preroll: Float32Array[] = [];
  private current: Float32Array[] = [];
  private inSpeech = false;
  private startedAt = 0;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(private readonly options: VoiceDetectorOptions) {
    this.pauseMs = options.pauseMs ?? 700;
    this.minSpeechMs = options.minSpeechMs ?? 160;
    this.maxUtteranceMs = options.maxUtteranceMs ?? 15000;
    this.prerollMs = options.prerollMs ?? 240;
  }

  setPauseMs(ms: number): void {
    this.pauseMs = ms;
  }

  /** `at` is when the frame starts, in milliseconds. */
  push(frame: Float32Array, at: number): void {
    const ms = (frame.length / this.options.sampleRate) * 1000;
    const level = rms(frame);
    const loud = level > Math.max(ABSOLUTE_FLOOR, this.noise * NOISE_MULTIPLIER);

    if (!loud) {
      // Track the noise floor only while quiet, so speech does not raise it.
      this.noise = this.noise * 0.95 + level * 0.05;
    } else if (!this.inSpeech) {
      // A steady sound that never stops is background, not speech.
      this.noise = this.noise * 0.995 + level * 0.005;
    }

    if (!this.inSpeech) {
      this.preroll.push(frame);
      while (this.preroll.length * ms > this.prerollMs) this.preroll.shift();
      if (loud) {
        this.inSpeech = true;
        this.current = [...this.preroll];
        this.preroll = [];
        this.startedAt = at - (this.current.length - 1) * ms;
        this.speechMs = ms;
        this.silenceMs = 0;
      }
      return;
    }

    this.current.push(frame);
    if (loud) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }

    const length = this.current.length * ms;
    if (this.silenceMs >= this.pauseMs || length >= this.maxUtteranceMs) {
      this.finish(at + ms);
    }
  }

  /** Emit speech still in progress (for example when the session ends). */
  flush(at: number): void {
    if (this.inSpeech) this.finish(at);
  }

  private finish(endedAt: number): void {
    // Keep only a short tail of the closing silence.
    const frameMs = this.current.length ? (this.current[0]!.length / this.options.sampleRate) * 1000 : 0;
    const dropFrames = frameMs ? Math.max(0, Math.floor((this.silenceMs - TAIL_MS) / frameMs)) : 0;
    const frames = dropFrames ? this.current.slice(0, this.current.length - dropFrames) : this.current;
    endedAt -= dropFrames * frameMs;
    const speechMs = this.speechMs;
    this.inSpeech = false;
    this.current = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    if (speechMs < this.minSpeechMs) return;
    const total = frames.reduce((n, f) => n + f.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const f of frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    this.options.onUtterance({ audio, startedAt: this.startedAt, endedAt });
  }
}
