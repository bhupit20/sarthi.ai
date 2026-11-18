import { describe, expect, it } from 'vitest';
import { isEcho } from '../../../src/core/audio/echo';
import { resample } from '../../../src/core/audio/resample';
import { VoiceDetector, type Utterance } from '../../../src/core/audio/vad';

const RATE = 16000;
const FRAME = 320; // 20 ms

/** Sine "speech" or near-silence, in 20 ms frames. */
function frames(kind: 'speech' | 'silence', ms: number, amp = 0.2): Float32Array[] {
  const out: Float32Array[] = [];
  for (let f = 0; f < ms / 20; f++) {
    const x = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      x[i] = kind === 'speech' ? amp * Math.sin((2 * Math.PI * 220 * (f * FRAME + i)) / RATE) : (Math.random() - 0.5) * 0.002;
    }
    out.push(x);
  }
  return out;
}

function run(chunks: Float32Array[][], options: Partial<ConstructorParameters<typeof VoiceDetector>[0]> = {}) {
  const got: Utterance[] = [];
  const vad = new VoiceDetector({ sampleRate: RATE, onUtterance: (u) => got.push(u), ...options });
  let t = 0;
  for (const chunk of chunks) for (const frame of chunk) {
    vad.push(frame, t);
    t += 20;
  }
  return { got, vad, t };
}

describe('resample', () => {
  it('converts 48 kHz to 16 kHz with the right length and shape', () => {
    const x = new Float32Array(48000).map((_, i) => Math.sin((2 * Math.PI * 100 * i) / 48000));
    const y = resample(x, 48000, 16000);
    expect(y.length).toBe(16000);
    expect(y[40]).toBeCloseTo(Math.sin((2 * Math.PI * 100 * 40) / 16000), 2);
  });
  it('returns the input unchanged when the rate already matches', () => {
    const x = new Float32Array([0.1, 0.2]);
    expect(resample(x, 16000, 16000)).toBe(x);
  });
});

describe('VoiceDetector', () => {
  it('cuts one utterance at the pause and includes a little audio before the speech', () => {
    const { got } = run([frames('silence', 1000), frames('speech', 1500), frames('silence', 1000)]);
    expect(got).toHaveLength(1);
    const seconds = got[0]!.audio.length / RATE;
    expect(seconds).toBeGreaterThan(1.5);
    expect(seconds).toBeLessThan(2.4);
    expect(got[0]!.startedAt).toBeGreaterThanOrEqual(700);
    expect(got[0]!.startedAt).toBeLessThanOrEqual(1000);
  });

  it('keeps a short breath inside one utterance', () => {
    const { got } = run([frames('speech', 1000), frames('silence', 300), frames('speech', 1000), frames('silence', 1000)]);
    expect(got).toHaveLength(1);
  });

  it('splits two sentences separated by a real pause', () => {
    const { got } = run([frames('speech', 1000), frames('silence', 1000), frames('speech', 1000), frames('silence', 1000)]);
    expect(got).toHaveLength(2);
  });

  it('ignores clicks shorter than a syllable', () => {
    const { got } = run([frames('silence', 500), frames('speech', 60), frames('silence', 1500)]);
    expect(got).toHaveLength(0);
  });

  it('cuts very long speech so replies are not delayed for ever', () => {
    const { got } = run([frames('speech', 32000)], { maxUtteranceMs: 15000 });
    expect(got.length).toBe(2);
    expect(got[0]!.audio.length / RATE).toBeLessThanOrEqual(15.3);
  });

  it('adapts to steady background noise', () => {
    const noisy = (ms: number) => frames('speech', ms, 0.01);
    const { got } = run([noisy(3000), frames('speech', 1000, 0.2), noisy(1500)]);
    expect(got).toHaveLength(1);
  });

  it('flush returns speech still in progress', () => {
    const { got, vad, t } = run([frames('speech', 1000)]);
    expect(got).toHaveLength(0);
    vad.flush(t);
    expect(got).toHaveLength(1);
  });

  it('uses a new pause length immediately', () => {
    const { got, vad } = run([]);
    vad.setPauseMs(400);
    let t = 0;
    for (const f of [...frames('speech', 800), ...frames('silence', 500)]) vad.push(f, (t += 20));
    expect(got).toHaveLength(1);
  });
});

describe('isEcho', () => {
  const now = 100_000;
  const recent = [{ text: 'When can you deliver the first version of the store?', at: now - 3000 }];
  it('drops microphone text that repeats what the client just said', () => {
    expect(isEcho('when can you deliver the first version of the store', recent, now)).toBe(true);
    expect(isEcho('can you deliver the first version of store', recent, now)).toBe(true);
  });
  it('keeps the owner\'s own answer', () => {
    expect(isEcho('I can deliver it by Friday', recent, now)).toBe(false);
  });
  it('only compares with the last few seconds', () => {
    expect(isEcho('when can you deliver the first version of the store', recent, now + 20_000)).toBe(false);
  });
  it('keeps very short remarks', () => {
    expect(isEcho('the store', recent, now)).toBe(false);
  });
});
