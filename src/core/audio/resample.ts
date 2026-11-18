/** Linear resampling, good enough for speech recognition input. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const length = Math.floor((input.length * to) / from);
  const out = new Float32Array(length);
  const step = from / to;
  for (let i = 0; i < length; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = (input[j] ?? 0) * (1 - frac) + (input[j + 1] ?? input[j] ?? 0) * frac;
  }
  return out;
}

/** Mix a multi-channel buffer down to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]!.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / channels.length;
  return out;
}
