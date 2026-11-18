/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

/**
 * Speech to text on this Mac. The model is downloaded once from Hugging Face
 * and then kept in the app's cache; audio never leaves the computer.
 */
export const MODEL = 'onnx-community/whisper-base.en';

type Request = { type: 'load'; modelHost?: string } | { type: 'transcribe'; id: number; audio: Float32Array };
export type WorkerReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'text'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
// The speech engine's own files ship with the app, so no CDN is needed.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = new URL('./', self.location.href).href;

// The library's own overloads are too complex for TypeScript here; this is the one used.
const createPipeline = pipeline as unknown as (
  task: 'automatic-speech-recognition',
  model: string,
  options: { device: string; dtype: string; progress_callback(p: { status: string; file?: string; loaded?: number; total?: number }): void },
) => Promise<AutomaticSpeechRecognitionPipeline>;

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const files = new Map<string, { loaded: number; total: number }>();

async function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  const hasGpu = 'gpu' in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  const device = hasGpu ? 'webgpu' : 'wasm';
  const model = await createPipeline('automatic-speech-recognition', MODEL, {
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      self.postMessage({ type: 'progress', loaded, total } satisfies WorkerReply);
    },
  });
  self.postMessage({ type: 'ready', device } satisfies WorkerReply);
  return model;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    if (message.type === 'load' && message.modelHost) {
      // Automated tests serve the model locally.
      env.remoteHost = message.modelHost;
      env.remotePathTemplate = '{model}/';
      env.useBrowserCache = false;
    }
    asr ??= load();
    const model = await asr;
    if (message.type !== 'transcribe') return;
    const result = await model(message.audio);
    const text = Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text;
    self.postMessage({ type: 'text', id: message.id, text } satisfies WorkerReply);
  } catch (error) {
    if (message.type === 'load') asr = null;
    self.postMessage({
      type: 'error',
      id: message.type === 'transcribe' ? message.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerReply);
  }
};
