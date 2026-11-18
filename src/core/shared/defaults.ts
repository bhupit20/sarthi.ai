import type { Job, ProviderId, Settings } from './types';

/**
 * Starting model for each provider and job. These are only defaults: the
 * Settings view can load the provider's live model list and the owner can
 * pick or type any model.
 *
 * Checked 2026-11-14. The Claude IDs are current. The OpenAI and Gemini IDs
 * could not be confirmed against official documentation from the build
 * environment, so they are long-lived IDs/aliases; use "Test" in Settings.
 */
export const DEFAULT_MODELS: Record<ProviderId, Record<Job, string>> = {
  claude: { live: 'claude-haiku-5-5', summary: 'claude-opus-5-5' },
  openai: { live: 'gpt-5-nano', summary: 'gpt-5-mini' },
  gemini: { live: 'gemini-flash-latest', summary: 'gemini-flash-latest' },
  // Tested with a real key on 2026-11-17: Lightning answered in about 0.25 s with
  // thinking off; Gemma 4 wrote the best English but can take seconds to start.
  nvidia: { live: 'nvidia/nemotron-3.5-lightning-30b-a3b', summary: 'google/gemma-4-31b-it' },
};

export const DEFAULT_SETTINGS: Settings = {
  keys: { claude: '', openai: '', gemini: '', nvidia: '' },
  live: { provider: 'claude', model: DEFAULT_MODELS.claude.live },
  summary: { provider: 'claude', model: DEFAULT_MODELS.claude.summary },
  fallbackOrder: ['claude', 'gemini', 'openai', 'nvidia'],
  pauseMs: 1200,
  myMeetName: '',
  replyTo: 'questions',
  googleClientId: '',
};

/** Size limits (characters) for each part of the prompt. */
export const LIMITS = {
  importedNotesChars: 12000,
  summariesChars: 6000,
  summariesCount: 5,
  liveTranscriptChars: 3000,
  profileChars: 4000,
  clientNotesChars: 4000,
};

/** If a provider has not started answering after this long, try the next one. */
export const FIRST_TOKEN_TIMEOUT_MS = 4000;

/** A client sentence shorter than this waits for more words before it triggers replies. */
export const MIN_UTTERANCE_WORDS = 3;

export const PAUSE_MS_MIN = 600;
export const PAUSE_MS_MAX = 2500;
