import { describe, expect, it } from 'vitest';
import { sseData } from '../../../src/core/ai/sse';
import { streamResponse } from './helpers';

const collect = async (res: Response) => {
  const out: string[] = [];
  for await (const d of sseData(res)) out.push(d);
  return out;
};

describe('sseData', () => {
  it('joins a payload that arrives split across chunks', async () => {
    const res = streamResponse(['data: {"a"', ':1}\n\nda', 'ta: {"b":2}\n\n']);
    expect(await collect(res)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('skips the [DONE] marker, comments and event names', async () => {
    const res = streamResponse([': ping\n\nevent: x\ndata: one\n\ndata: [DONE]\n\n']);
    expect(await collect(res)).toEqual(['one']);
  });

  it('handles CRLF line endings and a last line with no newline', async () => {
    const res = streamResponse(['data: one\r\n\r\ndata: two']);
    expect(await collect(res)).toEqual(['one', 'two']);
  });
});
