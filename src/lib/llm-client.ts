import {
  CreateWebWorkerMLCEngine,
  type ChatCompletionRequestNonStreaming,
  type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import type { NotesLLM } from "./notes/run";
import type { ChatMessage } from "./prompts";

export interface LoadProgress {
  /** 0–1 */
  progress: number;
  text: string;
}

/** WebLLM (WebGPU) implementation of the notes model, running in llm.worker.ts. */
export class WebLlmNotes implements NotesLLM {
  private engine: WebWorkerMLCEngine | null = null;
  private worker: Worker | null = null;
  private loaded = "";

  async load(mlcId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    const report = (r: { progress: number; text: string }) =>
      onProgress?.({ progress: r.progress, text: r.text });
    if (!this.engine) {
      this.worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), {
        type: "module",
      });
      this.engine = await CreateWebWorkerMLCEngine(
        this.worker,
        mlcId,
        { initProgressCallback: report },
        { context_window_size: 4096 },
      );
    } else if (this.loaded !== mlcId) {
      this.engine.setInitProgressCallback(report);
      await this.engine.reload(mlcId, { context_window_size: 4096 });
    }
    this.loaded = mlcId;
  }

  async complete(
    messages: ChatMessage[],
    { schema, maxTokens }: { schema?: string; maxTokens: number },
  ) {
    if (!this.engine) throw new Error("Notes model not loaded");
    const request: ChatCompletionRequestNonStreaming = {
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: false,
    };
    if (schema) request.response_format = { type: "json_object", schema };
    const res = await this.engine.chat.completions.create(request);
    return res.choices[0]?.message.content ?? "";
  }

  interrupt(): void {
    this.engine?.interruptGenerate();
  }

  /** Drop the engine and its worker (e.g. after the GPU device was lost). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.loaded = "";
  }
}
