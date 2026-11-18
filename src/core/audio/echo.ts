const ECHO_WINDOW_MS = 10_000;
const MIN_WORDS = 4;
const SIMILARITY = 0.6;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);

/**
 * True when the microphone picked up what the client just said (the call
 * playing through speakers). Such lines must not count as the owner's speech.
 */
export function isEcho(micText: string, recentClient: Array<{ text: string; at: number }>, now: number): boolean {
  const mine = words(micText);
  if (mine.length < MIN_WORDS) return false;
  const mineSet = new Set(mine);
  return recentClient.some(({ text, at }) => {
    if (now - at > ECHO_WINDOW_MS) return false;
    const theirs = new Set(words(text));
    let shared = 0;
    for (const w of mineSet) if (theirs.has(w)) shared++;
    return shared / mineSet.size >= SIMILARITY;
  });
}
