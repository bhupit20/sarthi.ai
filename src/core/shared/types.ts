export type ProviderId = 'claude' | 'openai' | 'gemini' | 'nvidia';
export type Job = 'live' | 'summary';

export interface JobChoice {
  provider: ProviderId;
  model: string;
}

export interface Settings {
  keys: Record<ProviderId, string>;
  live: JobChoice;
  summary: JobChoice;
  fallbackOrder: ProviderId[];
  /** How long a speaker must be silent before their sentence counts as finished. */
  pauseMs: number;
  /** The owner's display name in Meet. "You" is always treated as the owner. */
  myMeetName: string;
  /** "questions": skip small talk. "everything": suggest replies for every client remark. */
  replyTo: 'questions' | 'everything';
  /** The owner's own Google OAuth client ID, for Drive and Calendar. Empty = not used. */
  googleClientId: string;
}

export interface Profile {
  text: string;
}

export interface Client {
  id: string;
  name: string;
  notes: string;
  /** Past meeting notes pasted in by the owner (for example Gemini notes). */
  importedNotes: string;
  meetCodes: string[];
  createdAt: number;
  /** Google Drive documents already added to importedNotes. */
  importedDocIds?: string[];
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  at: number;
  own: boolean;
}

export interface Meeting {
  id: string;
  clientId: string;
  meetCode: string;
  startedAt: number;
  /** null while the meeting is running or if it never finished saving. */
  endedAt: number | null;
  transcript: TranscriptLine[];
  summary: string | null;
  /** Short English sentences from this meeting worth practising. */
  practice?: string[];
}

export interface CaptionEvent {
  blockId: string;
  speaker: string;
  text: string;
  at: number;
}

export interface Suggestions {
  short?: string;
  detailed?: string;
  safe?: string;
}

/** What the owner is sharing in Meet. "browser" means a single tab. */
export type ShareSurface = 'monitor' | 'window' | 'browser' | 'unknown';

/** Messages the content script sends to the panel over the "captions" port. */
export type ContentMessage =
  | { type: 'status'; inCall: boolean; captionsFound: boolean; meetCode: string | null; sharing: ShareSurface | null }
  | { type: 'captions'; events: CaptionEvent[] }
  | { type: 'call-ended' }
  | { type: 'markup'; html: string };

/** Messages the panel sends to the content script. */
export type PanelMessage = { type: 'get-markup' };

export const PROVIDER_IDS: ProviderId[] = ['claude', 'openai', 'gemini', 'nvidia'];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  nvidia: 'NVIDIA',
};
