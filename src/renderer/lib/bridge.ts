import type { runJob } from '../../core/ai/run';
import type { SarthiApi } from '../../shared/api';
import { fromWire } from '../../shared/wire';

declare global {
  interface Window {
    sarthi: SarthiApi;
  }
}

export const sarthi = (): SarthiApi => window.sarthi;

let counter = 0;

/**
 * Same contract as runJob, but the request runs in the main process, where
 * the API keys are. Text streams back as events.
 */
export const remoteRun: typeof runJob = (job, req, settings, cb) => {
  const api = sarthi();
  const id = `${Date.now()}-${++counter}`;
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      finished = true;
      off();
    };
    const off = api.ai.onEvent((event) => {
      if (event.id !== id || finished) return;
      if (event.type === 'delta') cb.onDelta(event.text ?? '');
      else if (event.type === 'provider' && event.provider) cb.onProvider(event.provider);
      else if (event.type === 'done') {
        finish();
        resolve();
      } else if (event.type === 'error') {
        finish();
        reject(fromWire(event.error!));
      }
    });
    req.signal?.addEventListener('abort', () => {
      if (finished) return;
      finish();
      api.ai.cancel(id);
      reject(new DOMException('Cancelled', 'AbortError'));
    });
    const { keys: _keys, ...publicSettings } = settings;
    api.ai.start(id, job, { system: req.system, user: req.user, maxTokens: req.maxTokens }, publicSettings);
  });
};
