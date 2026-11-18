import type { Job, ProviderId, Settings } from '../core/shared/types';
import type { WireError } from './wire';

/** A streamed AI answer, sent from the main process to the window that asked. */
export interface AiEvent {
  id: string;
  type: 'provider' | 'delta' | 'done' | 'error';
  provider?: ProviderId;
  text?: string;
  error?: WireError;
}

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

/** Settings without keys: keys never leave the main process. */
export type PublicSettings = Omit<Settings, 'keys'>;

export type CopilotAction =
  | { type: 'suggestNow' }
  | { type: 'quickType'; text: string }
  | { type: 'end' }
  | { type: 'dismissError' }
  | { type: 'openDashboard' };

export type Shortcut = 'suggest' | 'toggleCopilot';

export interface PermissionStatus {
  /** 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' */
  microphone: string;
  /** Screen & system audio recording, needed to hear the call. */
  screen: string;
}

/** What the preload script exposes to the windows as `window.sarthi`. */
export interface SarthiApi {
  platform: string;
  version: string;
  keys: {
    status(): Promise<Record<ProviderId, boolean>>;
    set(provider: ProviderId, key: string): Promise<WireError | null>;
  };
  ai: {
    start(id: string, job: Job, request: AiRequest, settings: PublicSettings): void;
    cancel(id: string): void;
    onEvent(listener: (event: AiEvent) => void): () => void;
    test(provider: ProviderId, model: string): Promise<WireError | null>;
    models(provider: ProviderId): Promise<{ models?: string[]; error?: WireError }>;
  };
  copilot: {
    show(): void;
    hide(): void;
    toggle(): void;
    /** Dashboard → copilot: the latest session state. */
    publish(state: unknown): void;
    onState(listener: (state: unknown) => void): () => void;
    /** Copilot → dashboard: what the owner pressed. */
    act(action: CopilotAction): void;
    onAction(listener: (action: CopilotAction) => void): () => void;
  };
  permissions: {
    status(): Promise<PermissionStatus>;
    requestMicrophone(): Promise<boolean>;
    openSettings(kind: 'microphone' | 'screen'): void;
  };
  onShortcut(listener: (shortcut: Shortcut) => void): () => void;
  /** Only present in automated tests. */
  test?: { callAudioUrl?: string; modelHost?: string };
}

export const CHANNELS = {
  keysStatus: 'keys:status',
  keysSet: 'keys:set',
  aiStart: 'ai:start',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event',
  aiTest: 'ai:test',
  aiModels: 'ai:models',
  copilotShow: 'copilot:show',
  copilotHide: 'copilot:hide',
  copilotToggle: 'copilot:toggle',
  copilotPublish: 'copilot:publish',
  copilotState: 'copilot:state',
  copilotAct: 'copilot:act',
  copilotAction: 'copilot:action',
  permStatus: 'perm:status',
  permMic: 'perm:mic',
  permOpen: 'perm:open',
  shortcut: 'shortcut',
} as const;
