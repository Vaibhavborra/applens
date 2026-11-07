import type { EmbedRequest, EmbedResponse } from "@/workers/embed.protocol";

/** Anything that turns texts into L2-normalised vectors (real worker or a test fake). */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

type LoadListener = (loaded: number, total: number) => void;

/** Main-thread handle on the embedding worker; one shared instance per tab. */
class EmbedClient implements Embedder {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
  >();
  private loadListeners = new Set<LoadListener>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e: MessageEvent<EmbedResponse>) => {
        const msg = e.data;
        if (msg.type === "load-progress") {
          for (const l of this.loadListeners) l(msg.loaded, msg.total);
          return;
        }
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === "result") p?.resolve(msg.vectors);
        else p?.reject(new Error(msg.message));
      };
      this.worker.onerror = (e) => {
        const err = new Error(e.message || "Embedding worker crashed");
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: EmbedRequest = { type: "embed", id, texts };
      this.getWorker().postMessage(msg);
    });
  }

  /** Model download progress (first use only). Returns an unsubscribe function. */
  onLoadProgress(l: LoadListener): () => void {
    this.loadListeners.add(l);
    return () => this.loadListeners.delete(l);
  }
}

let shared: EmbedClient | null = null;
export function getEmbedder(): EmbedClient {
  shared ??= new EmbedClient();
  return shared;
}
