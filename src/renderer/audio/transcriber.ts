import type { WorkerReply } from './asr.worker';

export interface TranscriberStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  /** 0..1 while the model downloads. */
  progress: number;
  device?: string;
  error?: string;
}

/** Talks to the speech worker. Transcriptions run one at a time, in order. */
export class Transcriber {
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();
  private status: TranscriberStatus = { state: 'idle', progress: 0 };
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly onStatus: (status: TranscriberStatus) => void = () => {},
    private readonly modelHost?: string,
  ) {}

  getStatus(): TranscriberStatus {
    return this.status;
  }

  private set(status: Partial<TranscriberStatus>): void {
    this.status = { ...this.status, ...status };
    this.onStatus(this.status);
  }

  load(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.set({ state: 'loading', progress: 0, error: undefined });
    this.worker = new Worker(new URL('./asr.worker.js', document.baseURI), { type: 'module' });
    this.loaded = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (reply.type === 'progress') {
          this.set({ progress: reply.total ? reply.loaded / reply.total : 0 });
        } else if (reply.type === 'ready') {
          this.set({ state: 'ready', progress: 1, device: reply.device });
          resolve();
        } else if (reply.type === 'text') {
          this.waiting.get(reply.id)?.resolve(reply.text);
          this.waiting.delete(reply.id);
        } else if (reply.type === 'error') {
          if (reply.id !== undefined) {
            this.waiting.get(reply.id)?.reject(new Error(reply.message));
            this.waiting.delete(reply.id);
          } else {
            this.set({ state: 'error', error: reply.message });
            this.loaded = null;
            reject(new Error(reply.message));
          }
        }
      };
      this.worker!.postMessage({ type: 'load', modelHost: this.modelHost });
    });
    return this.loaded;
  }

  async transcribe(audio: Float32Array): Promise<string> {
    await this.load();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    });
  }
}
