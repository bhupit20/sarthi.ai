import { describe, expect, it } from 'vitest';
import {
  buildQuickTypeUser, buildSuggestUser, buildSummaryPrompt, buildSystem, parseSuggestions, splitSummary, trimEnd, trimStart, type Memory,
} from '../../../src/core/meeting/prompts';
import type { Meeting, TranscriptLine } from '../../../src/core/shared/types';

const meeting = (n: number): Meeting => ({
  id: `m${n}`, clientId: 'c', meetCode: 'abc-defg-hij',
  startedAt: Date.UTC(2026, 0, n), endedAt: Date.UTC(2026, 0, n) + 1000,
  transcript: [], summary: `Summary number ${n}.`,
});

const memory = (over: Partial<Memory> = {}): Memory => ({
  profile: { text: 'I build Shopify stores. Standard price is $900.' },
  client: { id: 'c', name: 'Acme Co', notes: 'Wants a redesign.', importedNotes: 'Old Gemini notes.', meetCodes: [], createdAt: 1 },
  pastMeetings: [],
  ...over,
});

const line = (speaker: string, text: string, own = false): TranscriptLine => ({ speaker, text, at: 1, own });

describe('parseSuggestions', () => {
  it('reads a reply that is still being written', () => {
    expect(parseSuggestions('SHORT: Yes, by Fri')).toEqual({ short: 'Yes, by Fri' });
  });
  it('reads all three replies', () => {
    expect(parseSuggestions('SHORT: Yes.\nDETAILED: Yes, we can. It takes two days.\nSAFE: Let me check and confirm. ')).toEqual({
      short: 'Yes.', detailed: 'Yes, we can. It takes two days.', safe: 'Let me check and confirm.',
    });
  });
  it('keeps a reply that runs over several lines together', () => {
    expect(parseSuggestions('SHORT: Yes.\nDETAILED: First line.\nSecond line.\nSAFE: Later.').detailed).toBe('First line. Second line.');
  });
  it('ignores chatter before the first label', () => {
    expect(parseSuggestions('Here are your replies:\n\nSHORT: Yes.')).toEqual({ short: 'Yes.' });
  });
  it('accepts lowercase and bold labels', () => {
    expect(parseSuggestions('**Short:** Yes.\n**detailed**: More.\nsafe: Later.')).toEqual({ short: 'Yes.', detailed: 'More.', safe: 'Later.' });
  });
  it('strips quotation marks around a reply', () => {
    expect(parseSuggestions('SHORT: "Yes, we can."')).toEqual({ short: 'Yes, we can.' });
  });
  it('does not show a label that has no words yet', () => {
    expect(parseSuggestions('SHORT: Yes.\nDETAILED:')).toEqual({ short: 'Yes.' });
    expect(parseSuggestions('')).toEqual({});
  });
});

describe('splitSummary', () => {
  it('separates the notes from the phrases to practise', () => {
    const text = 'Decided\n- Ship Friday\n\n=== PHRASES ===\n- I\'ll send it by Friday.\n* Could you confirm the colours?\n1. That works for me.\n';
    expect(splitSummary(text)).toEqual({
      summary: 'Decided\n- Ship Friday',
      practice: ["I'll send it by Friday.", 'Could you confirm the colours?', 'That works for me.'],
    });
  });
  it('keeps everything as the summary when there is no phrases part', () => {
    expect(splitSummary('Decided\n- Ship Friday')).toEqual({ summary: 'Decided\n- Ship Friday', practice: [] });
  });
  it('strips quotation marks and skips empty lines', () => {
    expect(splitSummary('X\n=== PHRASES ===\n\n- "Let me check and get back to you."\n-\n').practice).toEqual(['Let me check and get back to you.']);
  });
});

describe('trimming', () => {
  it('trimStart keeps the end and cuts at a line break when it can', () => {
    expect(trimStart('line one\nline two\nline three', 15)).toBe('line three');
    expect(trimStart('short', 15)).toBe('short');
    expect(trimStart('abcdefghij', 4)).toBe('ghij');
  });
  it('trimEnd keeps the start', () => {
    expect(trimEnd('abcdefghij', 4)).toBe('abcd');
  });
});

describe('buildSystem', () => {
  it('contains the profile, the client and the rule against inventing facts', () => {
    const system = buildSystem(memory());
    expect(system).toContain('I build Shopify stores');
    expect(system).toContain('Acme Co');
    expect(system).toContain('Wants a redesign.');
    expect(system).toContain('Old Gemini notes.');
    expect(system).toContain('[___]');
    expect(system).toMatch(/SHORT:[\s\S]*DETAILED:[\s\S]*SAFE:/);
  });

  it('asks for replies that sound like a person talking, not like a letter', () => {
    const system = buildSystem(memory());
    expect(system).toMatch(/contractions/);
    expect(system).toMatch(/I'll/);
    expect(system).toMatch(/happy to assist/); // named as a phrase to avoid
  });

  it('includes my prepared answers so replies agree with them', () => {
    const system = buildSystem(memory({ prepared: [{ id: 'p', keywords: 'price, cost', answer: 'A standard store is $900.' }] }));
    expect(system).toContain('## My standard answers');
    expect(system).toContain('price, cost');
    expect(system).toContain('A standard store is $900.');
    expect(buildSystem(memory())).not.toContain('## My standard answers');
  });

  it('trims huge pasted notes, keeping the newest end', () => {
    const notes = 'OLDEST-MARKER ' + 'filler text '.repeat(5000) + ' NEWEST-MARKER';
    const system = buildSystem(memory({ client: { ...memory().client, importedNotes: notes } }));
    expect(system.length).toBeLessThan(12000 + 4000 + 4000 + 6000 + 2500);
    expect(system).toContain('NEWEST-MARKER');
    expect(system).not.toContain('OLDEST-MARKER');
  });

  it('includes only the five newest meetings that have a summary', () => {
    const pastMeetings = [8, 7, 6, 5, 4, 3, 2, 1].map(meeting);
    pastMeetings[1] = { ...pastMeetings[1]!, summary: null };
    const system = buildSystem(memory({ pastMeetings }));
    for (const n of [8, 6, 5, 4, 3]) expect(system).toContain(`Summary number ${n}.`);
    for (const n of [7, 2, 1]) expect(system).not.toContain(`Summary number ${n}.`);
  });

  it('stops adding meeting summaries at the size limit', () => {
    const big = (n: number) => ({ ...meeting(n), summary: `S${n} ` + 'x'.repeat(2500) });
    const system = buildSystem(memory({ pastMeetings: [5, 4, 3, 2].map(big) }));
    expect(system).toContain('S5 ');
    expect(system).toContain('S4 ');
    expect(system).not.toContain('S3 ');
  });

  it('is identical for the same memory, so it can be cached', () => {
    expect(buildSystem(memory({ pastMeetings: [meeting(2)] }))).toBe(buildSystem(memory({ pastMeetings: [meeting(2)] })));
  });

  it('says so when there is no profile or notes, instead of leaving blanks', () => {
    const system = buildSystem(memory({ profile: { text: '' }, client: { ...memory().client, notes: '', importedNotes: '' } }));
    expect(system).toContain('(nothing written yet)');
  });
});

describe('user prompts', () => {
  const long = Array.from({ length: 400 }, (_, i) => line('Sarah', `This is sentence number ${i}.`));

  it('keeps only the recent conversation and ends with what the client just said', () => {
    const user = buildSuggestUser([...long, line('You', 'Sure.', true)], 'When can you deliver?');
    expect(user.length).toBeLessThan(3600);
    expect(user).toContain('sentence number 399');
    expect(user).not.toContain('sentence number 1.');
    expect(user).toContain('Me: Sure.');
    expect(user.trimEnd().endsWith('When can you deliver?')).toBe(true);
  });

  it('quick-type prompt carries the rough note exactly', () => {
    const user = buildQuickTypeUser([line('Sarah', 'When can you deliver?')], 'When can you deliver?', 'delivery friday, 2 revisions free');
    expect(user).toContain('delivery friday, 2 revisions free');
    expect(user).toContain('When can you deliver?');
  });

  it('quick-type prompt carries a Hindi answer exactly and asks for translation of every point', () => {
    const hindi = 'हाँ, हम शुक्रवार तक पहला version दे देंगे। दो revision free हैं, उसके बाद $50 per revision लगेगा।';
    const user = buildQuickTypeUser([line('Sarah', 'When can you deliver?')], 'When can you deliver?', hindi);
    expect(user).toContain(hindi);
    expect(user).toMatch(/Hindi/);
    expect(user).toMatch(/every point/);
    // A full answer must not be squeezed into one or two sentences.
    expect(user).not.toMatch(/one or two/);
  });

  it('summary prompt asks for the four headings and includes the whole conversation', () => {
    const { system, user } = buildSummaryPrompt(memory(), [line('Sarah', 'We need it Friday.'), line('You', 'I will send it Thursday.', true)]);
    for (const h of ['Decided', 'Open questions', 'I promised', 'Client promised']) expect(system).toContain(h);
    expect(system).toContain('=== PHRASES ===');
    expect(system).toContain('Acme Co');
    expect(user).toContain('Sarah: We need it Friday.');
    expect(user).toContain('Me: I will send it Thursday.');
  });
});
