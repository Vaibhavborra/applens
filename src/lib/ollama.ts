import type { NotesLLM } from "./notes/run";
import type { ChatMessage } from "./prompts";

/**
 * Ollama (https://ollama.com) as an optional notes engine: a free, local LLM
 * server on the user's own computer. Useful where in-browser WebGPU can't run
 * the model (no WebGPU, or an integrated GPU that times out).
 */
export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
/** Suggested model: same family as the in-browser one, good at JSON schemas. */
export const OLLAMA_SUGGESTED_MODEL = "qwen2.5:3b";
/** Our prompts need ~4K tokens; Ollama's default context can be smaller. */
const NUM_CTX = 8192;

export interface OllamaModel {
  name: string;
  sizeBytes: number;
}

/** Thrown when Ollama can't be reached (not running, wrong URL, or CORS). */
export class OllamaUnreachable extends Error {
  constructor(url: string) {
    super(ollamaUnreachableMessage(url, typeof location === "undefined" ? "" : location.origin));
    this.name = "OllamaUnreachable";
  }
}

const isLocalOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

export function ollamaUnreachableMessage(url: string, pageOrigin: string): string {
  const cors = isLocalOrigin(pageOrigin)
    ? ""
    : ` Ollama only accepts requests from localhost by default; to allow this site, set the ` +
      `environment variable OLLAMA_ORIGINS=${pageOrigin} and restart Ollama.`;
  return `Couldn't reach Ollama at ${url}. Make sure Ollama is installed and running.${cors}`;
}

export function normalizeOllamaUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  if (!u) return OLLAMA_DEFAULT_URL;
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

async function ollamaFetch(
  base: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new OllamaUnreachable(base);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(`Ollama error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

/** Installed models (`ollama list`). Throws OllamaUnreachable if Ollama isn't running. */
export async function listOllamaModels(
  url: string,
  { signal, fetchImpl }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<OllamaModel[]> {
  const res = await ollamaFetch(
    normalizeOllamaUrl(url),
    "/api/tags",
    signal ? { signal } : {},
    fetchImpl,
  );
  const body = (await res.json()) as { models?: { name?: unknown; size?: unknown }[] };
  return (body.models ?? [])
    .filter((m): m is { name: string; size?: unknown } => typeof m.name === "string")
    .map((m) => ({ name: m.name, sizeBytes: typeof m.size === "number" ? m.size : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `qwen2.5` and `qwen2.5:latest` are the same model to Ollama. */
export function sameOllamaModel(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(":") ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

export function ollamaChatBody(
  model: string,
  messages: ChatMessage[],
  { schema, maxTokens }: { schema?: string; maxTokens: number },
) {
  return {
    model,
    messages,
    stream: false,
    // Structured outputs: Ollama accepts a JSON schema as `format`.
    ...(schema ? { format: JSON.parse(schema) as unknown } : {}),
    options: { temperature: 0.2, num_predict: maxTokens, num_ctx: NUM_CTX },
  };
}

export class OllamaNotes implements NotesLLM {
  private controller = new AbortController();
  private readonly url: string;

  constructor(
    url: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.url = normalizeOllamaUrl(url);
  }

  /** Check Ollama is up and the model is installed. */
  async check(): Promise<void> {
    const models = await listOllamaModels(this.url, {
      signal: this.controller.signal,
      fetchImpl: this.fetchImpl,
    });
    if (!models.some((m) => sameOllamaModel(m.name, this.model))) {
      throw new Error(
        `Ollama doesn't have the model "${this.model}". Install it with: ollama pull ${this.model}`,
      );
    }
  }

  async complete(messages: ChatMessage[], opts: { schema?: string; maxTokens: number }) {
    const res = await ollamaFetch(
      this.url,
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaChatBody(this.model, messages, opts)),
        signal: this.controller.signal,
      },
      this.fetchImpl,
    );
    const body = (await res.json()) as { message?: { content?: unknown } };
    return typeof body.message?.content === "string" ? body.message.content : "";
  }

  /** Abort the request in flight (Ollama stops generating when the client disconnects). */
  interrupt(): void {
    this.controller.abort();
    this.controller = new AbortController();
  }
}
