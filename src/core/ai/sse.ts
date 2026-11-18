/**
 * Yields the payload of every `data:` line in a server-sent-event response.
 * Skips comments, event names and the `[DONE]` marker.
 */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const take = function* (line: string): Generator<string> {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload && payload !== '[DONE]') yield payload;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) yield* take(line);
    }
    buffer += decoder.decode();
    yield* take(buffer);
  } finally {
    reader.releaseLock();
  }
}
