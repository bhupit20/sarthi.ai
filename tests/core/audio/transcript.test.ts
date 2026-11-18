import { describe, expect, it } from 'vitest';
import { cleanTranscript } from '../../../src/core/audio/transcript';

describe('cleanTranscript', () => {
  it('keeps real speech and tidies spaces', () => {
    expect(cleanTranscript('  When can you   deliver it? ')).toBe('When can you deliver it?');
  });
  it('removes sound tags Whisper adds', () => {
    expect(cleanTranscript('(mumbling)')).toBe('');
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript('[Music] So what is the price? (laughs)')).toBe('So what is the price?');
    expect(cleanTranscript('♪ ♪')).toBe('');
  });
  it('drops phrases Whisper invents in near-silence', () => {
    for (const ghost of ['Thank you.', 'Thanks for watching!', 'you', 'Bye.', '.', 'Subtitles by the Amara.org community']) {
      expect(cleanTranscript(ghost), ghost).toBe('');
    }
  });
  it('keeps those words when they are part of a real sentence', () => {
    expect(cleanTranscript('Thank you, that works for the launch.')).toBe('Thank you, that works for the launch.');
  });
});
