/** Whole outputs Whisper is known to invent from silence or noise. */
const GHOSTS = new Set([
  'thank you',
  'thank you very much',
  'thanks for watching',
  'thanks for watching and see you next time',
  'thank you for watching',
  'you',
  'bye',
  'bye bye',
  'okay',
  'so',
  'subtitles by the amara org community',
]);

/**
 * Tidy one transcribed utterance. Returns '' when it holds no real speech:
 * sound tags such as "(mumbling)" or "[BLANK_AUDIO]", music notes, or a
 * phrase Whisper is known to invent in near-silence.
 */
export function cleanTranscript(text: string): string {
  const stripped = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const plain = stripped.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!plain || GHOSTS.has(plain)) return '';
  return stripped;
}
