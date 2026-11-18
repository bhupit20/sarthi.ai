import { NoApiKeyError, ProviderError } from '../core/ai/providers';
import type { ProviderId } from '../core/shared/types';

/** An error as it travels between the main process and a window. */
export interface WireError {
  kind: 'provider' | 'no-key' | 'abort' | 'other';
  message: string;
  provider?: ProviderId;
  status?: number | null;
}

export function toWire(error: unknown): WireError {
  if (error instanceof ProviderError) return { kind: 'provider', message: error.message, provider: error.provider, status: error.status };
  if (error instanceof NoApiKeyError) return { kind: 'no-key', message: error.message };
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'APIUserAbortError') return { kind: 'abort', message: 'Cancelled' };
  return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
}

export function fromWire(wire: WireError): Error {
  switch (wire.kind) {
    case 'provider':
      return new ProviderError(wire.provider!, wire.status ?? null, wire.message);
    case 'no-key':
      return new NoApiKeyError();
    case 'abort':
      return new DOMException(wire.message, 'AbortError');
    default:
      return new Error(wire.message);
  }
}
