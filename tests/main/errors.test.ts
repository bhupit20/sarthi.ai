import { describe, expect, it } from 'vitest';
import { NoApiKeyError, ProviderError } from '../../src/core/ai/providers';
import { errorMessage } from '../../src/core/meeting/session';
import { fromWire, toWire } from '../../src/shared/wire';

describe('AI errors across processes', () => {
  it('keeps provider errors meaningful after crossing from the main process', () => {
    const back = fromWire(toWire(new ProviderError('nvidia', 401, 'bad key')));
    expect(back).toBeInstanceOf(ProviderError);
    expect(errorMessage(back)).toBe('The NVIDIA API key was rejected. Check it in Settings.');
  });
  it('keeps the missing-key and cancelled cases', () => {
    expect(errorMessage(fromWire(toWire(new NoApiKeyError())))).toBe('Add an API key in Settings to get suggestions.');
    expect(errorMessage(fromWire(toWire(new DOMException('x', 'AbortError'))))).toBe('');
  });
  it('turns anything else into a plain error', () => {
    expect(fromWire(toWire(new Error('boom')))).toBeInstanceOf(Error);
  });
});
