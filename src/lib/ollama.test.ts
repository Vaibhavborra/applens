import { describe, expect, it } from "vitest";
import {
  listOllamaModels,
  normalizeOllamaUrl,
  ollamaChatBody,
  OllamaNotes,
  OllamaUnreachable,
  ollamaUnreachableMessage,
  sameOllamaModel,
} from "./ollama";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ollama helpers", () => {
  it("normalizes the server URL", () => {
    expect(normalizeOllamaUrl(" localhost:11434/ ")).toBe("http://localhost:11434");
    expect(normalizeOllamaUrl("https://box:1/")).toBe("https://box:1");
    expect(normalizeOllamaUrl("")).toBe("http://localhost:11434");
  });

  it("treats a bare model name as :latest", () => {
    expect(sameOllamaModel("qwen2.5", "qwen2.5:latest")).toBe(true);
    expect(sameOllamaModel("qwen2.5:3b", "qwen2.5:latest")).toBe(false);
  });

  it("explains CORS only when the page isn't on localhost", () => {
    expect(ollamaUnreachableMessage("http://localhost:11434", "http://localhost:5173")).not.toMatch(
      /OLLAMA_ORIGINS/,
    );
    expect(ollamaUnreachableMessage("http://localhost:11434", "https://notes.pages.dev")).toContain(
      "OLLAMA_ORIGINS=https://notes.pages.dev",
    );
  });

  it("builds a structured-output chat request", () => {
    const body = ollamaChatBody("m", [{ role: "user", content: "hi" }], {
      schema: '{"type":"object"}',
      maxTokens: 50,
    });
    expect(body).toMatchObject({
      model: "m",
      stream: false,
      format: { type: "object" },
      options: { num_predict: 50, temperature: 0.2 },
    });
    expect("format" in ollamaChatBody("m", [], { maxTokens: 1 })).toBe(false);
  });
});

describe("listOllamaModels", () => {
  it("returns installed models sorted by name", async () => {
    const fetchImpl = (async () =>
      json({
        models: [{ name: "qwen2.5:3b", size: 5 }, { name: "llama3.2:latest" }, { bad: 1 }],
      })) as typeof fetch;
    expect(await listOllamaModels("localhost:11434", { fetchImpl })).toEqual([
      { name: "llama3.2:latest", sizeBytes: 0 },
      { name: "qwen2.5:3b", sizeBytes: 5 },
    ]);
  });

  it("reports an unreachable server", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(listOllamaModels("x", { fetchImpl })).rejects.toBeInstanceOf(OllamaUnreachable);
  });
});

describe("OllamaNotes", () => {
  it("checks the model is installed", async () => {
    const fetchImpl = (async () => json({ models: [{ name: "qwen2.5:3b" }] })) as typeof fetch;
    await expect(new OllamaNotes("u", "qwen2.5:3b", fetchImpl).check()).resolves.toBeUndefined();
    await expect(new OllamaNotes("u", "phi3", fetchImpl).check()).rejects.toThrow(
      /ollama pull phi3/,
    );
  });

  it("returns the message content and surfaces API errors", async () => {
    let sent: unknown;
    const ok = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ message: { role: "assistant", content: '{"a":1}' } });
    }) as typeof fetch;
    const llm = new OllamaNotes("u", "m", ok);
    expect(await llm.complete([{ role: "user", content: "x" }], { maxTokens: 9 })).toBe('{"a":1}');
    expect(sent).toMatchObject({ model: "m", options: { num_predict: 9 } });

    const bad = (async () => json({ error: "model not found" }, 404)) as typeof fetch;
    await expect(new OllamaNotes("u", "m", bad).complete([], { maxTokens: 1 })).rejects.toThrow(
      "Ollama error 404: model not found",
    );
  });

  it("aborts the request in flight on interrupt", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    const llm = new OllamaNotes("u", "m", hang);
    const p = llm.complete([], { maxTokens: 1 });
    llm.interrupt();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
