import type { ProviderId } from '../shared/types';

export interface ChatRequest {
  /** Stable instructions and memory. Sent in a form the provider can cache. */
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  /** True for live replies: prefer the quickest answer the model can give. */
  fast: boolean;
  signal?: AbortSignal;
}

export interface Provider {
  id: ProviderId;
  stream(req: ChatRequest, apiKey: string, onDelta: (text: string) => void, fetchFn?: typeof fetch): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class NoApiKeyError extends Error {
  constructor() {
    super('No API key is configured');
    this.name = 'NoApiKeyError';
  }
}

export function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/** Never let a key travel inside an error message. */
export function scrub(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join('[key hidden]') : message;
}

/** Build a ProviderError from a failed HTTP response, using the provider's own message. */
export async function httpError(provider: ProviderId, res: Response, apiKey: string): Promise<ProviderError> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } | string } | Array<{ error?: { message?: string } }>;
    const error = Array.isArray(body) ? body[0]?.error : body.error;
    const text = typeof error === 'string' ? error : error?.message;
    if (text) message = text;
  } catch {
    // Body was not JSON; the status code is enough.
  }
  return new ProviderError(provider, res.status, scrub(message, apiKey));
}
