import type { KeyValueStore } from '../storage/kv';

/** An answer the owner wrote in advance for something clients often ask. */
export interface PreparedAnswer {
  id: string;
  /** Words or short phrases clients use, separated by commas: "price, cost, how much". */
  keywords: string;
  answer: string;
}

const KEY = 'prepared';

export async function loadPrepared(kv: KeyValueStore): Promise<PreparedAnswer[]> {
  return (await kv.get<PreparedAnswer[]>(KEY)) ?? [];
}

export async function savePrepared(kv: KeyValueStore, list: PreparedAnswer[]): Promise<void> {
  await kv.set(KEY, list);
}

/** Lowercase, with everything that is not a letter or digit turned into one space. */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const keywordList = (keywords: string) => keywords.split(/[,\n]/).map(plain).filter(Boolean);

/** Words that carry no topic on their own ("what is the …"). */
const COMMON = new Set(
  `a an the is are was were be am do does did what when where who why how which much many will would can could
  should shall may might must you your i me my we our us it its this that these those there to of for in on at
  by with about and or but so if then please tell know want like get give`.split(/\s+/),
);

/** "cost" also matches "costs"; "costs" also matches "cost". */
function sameWord(said: string, word: string): boolean {
  return said === word || said === `${word}s` || said === `${word}es` || (word.endsWith('s') && said === word.slice(0, -1));
}

/**
 * Does the client's remark contain this keyword? A single word or a phrase of
 * only common words ("how much") must appear exactly, as whole words. A longer
 * phrase ("what is the project cost") matches when all of its important words
 * appear, in any order ("How much will the project cost?").
 */
function mentions(saidWords: string[], keyword: string): boolean {
  const words = keyword.split(' ');
  const important = words.filter((w) => !COMMON.has(w));
  if (words.length === 1 || important.length === 0) {
    for (let i = 0; i + words.length <= saidWords.length; i++) {
      if (words.every((w, j) => sameWord(saidWords[i + j]!, w))) return true;
    }
    return false;
  }
  return important.every((w) => saidWords.some((said) => sameWord(said, w)));
}

/**
 * The prepared answer whose words the client just used, or null. Matching is
 * on whole words (plurals allowed), so it is instant and predictable: the
 * owner can see exactly why an answer appeared.
 */
export function matchPrepared(text: string, list: PreparedAnswer[]): PreparedAnswer | null {
  const saidWords = plain(text).split(' ').filter(Boolean);
  let best: { entry: PreparedAnswer; hits: number; longest: number } | null = null;
  for (const entry of list) {
    if (!entry.answer.trim()) continue;
    let hits = 0;
    let longest = 0;
    for (const keyword of keywordList(entry.keywords)) {
      if (mentions(saidWords, keyword)) {
        hits++;
        longest = Math.max(longest, keyword.length);
      }
    }
    if (hits === 0) continue;
    if (!best || hits > best.hits || (hits === best.hits && longest > best.longest)) best = { entry, hits, longest };
  }
  return best?.entry ?? null;
}
