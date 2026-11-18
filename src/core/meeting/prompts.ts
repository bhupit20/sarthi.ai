import { LIMITS } from '../shared/defaults';
import type { Client, Meeting, Profile, Suggestions, TranscriptLine } from '../shared/types';
import { keywordList, type PreparedAnswer } from './prepared';

export interface Memory {
  profile: Profile;
  client: Client;
  /** Newest first. */
  pastMeetings: Meeting[];
  /** Answers the owner wrote in advance for common questions. */
  prepared?: PreparedAnswer[];
}

/** Keep the end of the text (the newest part), starting at a line break when possible. */
export function trimStart(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const tail = text.slice(text.length - maxChars);
  const lineBreak = tail.indexOf('\n');
  return lineBreak >= 0 && lineBreak < tail.length - 1 ? tail.slice(lineBreak + 1) : tail;
}

/** Keep the start of the text. */
export function trimEnd(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

const EMPTY = '(nothing written yet)';
const orEmpty = (text: string) => (text.trim() ? text.trim() : EMPTY);

function previousMeetings(meetings: Meeting[]): string {
  const parts: string[] = [];
  let used = 0;
  for (const meeting of meetings) {
    if (!meeting.summary?.trim()) continue;
    if (parts.length >= LIMITS.summariesCount) break;
    const part = `### ${new Date(meeting.startedAt).toISOString().slice(0, 10)}\n${meeting.summary.trim()}`;
    if (used + part.length > LIMITS.summariesChars) break;
    parts.push(part);
    used += part.length;
  }
  return parts.length ? parts.join('\n\n') : '(no earlier meetings recorded)';
}

const PREPARED_CHARS = 4000;

function standardAnswers(prepared: PreparedAnswer[] | undefined): string[] {
  const usable = (prepared ?? []).filter((p) => p.answer.trim() && keywordList(p.keywords).length > 0);
  if (usable.length === 0) return [];
  const text = usable.map((p) => `- When the client asks about ${keywordList(p.keywords).join(', ')}: ${p.answer.trim()}`).join('\n');
  return [`## My standard answers\nThese are my own words for questions I get often. When one fits, build the reply on it and keep its facts exactly.\n${trimEnd(text, PREPARED_CHARS)}`];
}

function memorySections(m: Memory): string {
  return [
    `## About me\n${orEmpty(trimEnd(m.profile.text, LIMITS.profileChars))}`,
    ...standardAnswers(m.prepared),
    `## Client: ${m.client.name}`,
    `## Client notes\n${orEmpty(trimEnd(m.client.notes, LIMITS.clientNotesChars))}`,
    `## Past meeting notes\n${orEmpty(trimStart(m.client.importedNotes.trim(), LIMITS.importedNotesChars))}`,
    `## Previous meetings\n${previousMeetings(m.pastMeetings)}`,
  ].join('\n\n');
}

/**
 * The stable part of every live request. It must not contain anything that
 * changes during a meeting (no clock, no transcript), so providers can cache it.
 */
export function buildSystem(m: Memory): string {
  return `I am a professional on a live video call with my client. I understand the client well and I know my own work, but English is my second language, so I am slow to form sentences while the client is waiting. You write what I should say next, and I read it out loud.

How to write a reply:
- Write it as me, in the first person, ready to be spoken as it is.
- Make it sound like a real person talking on a call, not like an email or a chatbot. Use contractions (I'll, we're, that's, don't). Start the way people start when they speak ("Sure,", "Yes,", "Right,", "Good question,") when it fits, but do not open every reply the same way.
- React to the client like a person would: if they shared a worry, acknowledge it in a few words before answering; if they asked something simple, just answer.
- Use short sentences and common, everyday words. If a simpler word works, use it. No idioms that are hard to say.
- Avoid stiff or scripted phrases such as "I would be happy to assist", "Certainly!", "Kindly", "As per", "Please be advised", "I hope this helps", "Rest assured". Do not over-apologise and do not over-thank.
- Answer what the client just said. Use what you know about me, this client and our earlier meetings (below) so the reply fits the real project.
- Never invent a price, a date, a deadline, a number or a promise. Use one only if it appears in the information below or in the conversation. If the reply needs a fact you do not have, leave a blank written as [___] for me to fill in, and let the SAFE reply cover me.
- Do not commit me to new work, discounts or deadlines that I have not agreed to.

When I ask for replies, give exactly three, each on its own line, in this order and with these labels, and nothing else:
SHORT: one sentence.
DETAILED: two or three sentences with a little more explanation.
SAFE: one or two sentences that are polite and honest but commit to nothing, for when I need time to check (for example, saying I will confirm later).

${memorySections(m)}`;
}

function conversation(transcript: TranscriptLine[], maxChars: number): string {
  const text = transcript.map((l) => `${l.own ? 'Me' : l.speaker}: ${l.text}`).join('\n');
  return text ? trimStart(text, maxChars) : '(the call has just started)';
}

export function buildSuggestUser(transcript: TranscriptLine[], lastClientText: string): string {
  return `The conversation so far:
${conversation(transcript, LIMITS.liveTranscriptChars)}

Give me the three replies (SHORT, DETAILED, SAFE) to what the client just said:
${lastClientText}`;
}

export function buildQuickTypeUser(transcript: TranscriptLine[], lastClientText: string, rough: string): string {
  return `The conversation so far:
${conversation(transcript, LIMITS.liveTranscriptChars)}

The client just said:
${lastClientText || '(nothing yet)'}

Below is my own answer to the client. I wrote it in Hindi, in Hindi typed with English letters, in rough English, or in a mix. Translate it into English that I can say to the client right now, and improve how it sounds:
- Keep every point I made, in the same order. Do not shorten a full answer and do not add points of your own.
- Keep every number, price, date and name exactly as I wrote it. Add no new facts or promises.
- Make it sound like a real person talking on a call: friendly, clear and natural, with contractions (I'll, we're, that's). Use short sentences and common words that are easy for me to say out loud. No stiff phrases like "Kindly" or "I would be happy to assist".
- If my answer is only a few rough words, turn them into one complete sentence.
Reply with only the English words to say: no label, no quotation marks, no explanation, no Hindi.

My answer:
${rough}`;
}

export function buildSummaryPrompt(m: Memory, transcript: TranscriptLine[]): { system: string; user: string } {
  const system = `I just finished a video call with my client. Write the notes I will read before our next call. They are also used to prepare replies in future calls, so facts matter more than style.

Use exactly these four headings, each followed by a short list in plain English:
Decided
Open questions
I promised
Client promised

Rules:
- Include only what was actually said in the call. Keep every price, date and number exactly as spoken.
- Lines marked "Me:" are mine. Everything else is the client's side.
- The text comes from automatic captions, so some words may be misheard. If a detail is unclear, say that it is unclear instead of guessing.
- If a heading has nothing, write "None".
- No introduction and no closing remarks.

After the notes, write a line with exactly ${PHRASES_MARKER} and then five short English sentences for me to practise before my next call. Take them from this call: things I said, put into natural spoken English, or things that would have helped me answer the client. One per line, each starting with "- ", at most 15 words, with contractions, the way a person talks. They are for practice only, so they must not add facts to the notes.

${memorySections(m)}`;
  const user = `The full conversation:\n${conversation(transcript, Number.MAX_SAFE_INTEGER)}`;
  return { system, user };
}

export const PHRASES_MARKER = '=== PHRASES ===';

/** Split the model's after-meeting text into the notes and the phrases to practise. */
export function splitSummary(text: string): { summary: string; practice: string[] } {
  const at = text.indexOf(PHRASES_MARKER);
  if (at < 0) return { summary: text.trim(), practice: [] };
  const practice = text
    .slice(at + PHRASES_MARKER.length)
    .split('\n')
    .map((line) => clean(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')))
    .filter(Boolean);
  return { summary: text.slice(0, at).trim(), practice };
}

const LABEL = /^[ \t]*[*_]*[ \t]*(short|detailed|safe)[ \t]*[*_]*[ \t]*:[ \t]*[*_]*/gim;

function clean(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();
}

/** Read the labelled replies out of the model's text, which may still be half written. */
export function parseSuggestions(partial: string): Suggestions {
  const found: { key: keyof Suggestions; start: number; end: number }[] = [];
  for (const match of partial.matchAll(LABEL)) {
    found.push({
      key: match[1]!.toLowerCase() as keyof Suggestions,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  const out: Suggestions = {};
  found.forEach((label, i) => {
    const value = clean(partial.slice(label.end, found[i + 1]?.start ?? partial.length));
    if (value && out[label.key] === undefined) out[label.key] = value;
  });
  return out;
}
