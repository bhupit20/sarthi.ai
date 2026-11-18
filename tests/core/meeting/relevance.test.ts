import { describe, expect, it } from 'vitest';
import { needsReply } from '../../../src/core/meeting/relevance';

describe('needsReply', () => {
  it.each([
    'When can you deliver the first version?',
    'what is the total price',
    'Can you add a login page',
    'Okay. And how long will that take',
    'Please send me the invoice today',
    'I need the design by Monday',
    "We'd like to change the colours",
    'Let me know your thoughts on this',
    'The checkout page is not working on mobile',
    'That is too expensive for us',
    'I am a bit worried about the deadline',
    'So basically we launched the store last month and the orders are coming in but customers keep asking about delivery times and we are not sure',
    // Statements expect an answer too.
    "I haven't checked the any video free use links or how they handle your data.",
    'Nvidia is now spotted, and your key works with it.',
    'Yes, I saw that yesterday',
    'One second, my dog is barking',
    'We launched the new collection last week',
    'Okay, but the logo looks a bit small',
    'How are you?',
  ])('wants a reply to: %s', (text) => {
    expect(needsReply(text)).toBe(true);
  });

  it.each([
    'Okay that works for me',
    'Thanks, that is great',
    'Hello, good morning',
    'Sounds good to me',
    'Yeah, perfect, thank you so much',
    'Alright, bye, talk soon',
    'No rush, take your time',
    'Okay.',
    'Mm-hmm, right, got it',
    'Great, that makes sense',
    'Hi everyone',
  ])('skips small talk: %s', (text) => {
    expect(needsReply(text)).toBe(false);
  });
});
