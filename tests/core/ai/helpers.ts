/** A streamed HTTP response delivered in the given chunks. */
export function streamResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init });
}

export interface Captured {
  url: string;
  headers: Headers;
  body: any;
}

/** A fetch stand-in that records the request and answers with `respond()`. */
export function fakeFetch(respond: () => Response): { fetchFn: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    calls.push({ url, headers, body: raw ? JSON.parse(String(raw)) : undefined });
    return respond();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const sse = (events: object[]) => events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

export const claudeStream = (parts: string[], stopReason = 'end_turn') =>
  sse([
    {
      type: 'message_start',
      message: {
        id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'm',
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]);

export const openaiStream = (parts: string[]) =>
  parts.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') +
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;

export const geminiStream = (parts: string[]) =>
  parts.map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`).join('');
