// A tiny stand-in for the Ollama HTTP API (/api/tags, /api/chat) for e2e tests.
// Answers notes prompts with schema-shaped JSON built from the transcript it's given.
import { createServer } from "node:http";

export function startMockOllama(port, { models = ["qwen2.5:3b", "llama3.2:latest"] } = {}) {
  const state = { chats: [], aborted: 0, delayMs: 0 };
  const server = createServer(async (req, res) => {
    // Real Ollama allows localhost origins with CORS; mirror that.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const send = (code, body) =>
      res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));

    if (req.url === "/api/tags") {
      return send(200, { models: models.map((name) => ({ name, size: 1_900_000_000 })) });
    }
    if (req.url === "/api/chat" && req.method === "POST") {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      state.chats.push(body);
      if (!models.includes(body.model))
        return send(404, { error: `model '${body.model}' not found` });
      let closed = false;
      res.on("close", () => {
        if (!res.writableFinished) {
          closed = true;
          state.aborted++;
        }
      });
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (closed) return;
      return send(200, {
        model: body.model,
        message: { role: "assistant", content: JSON.stringify(answer(body)) },
        done: true,
      });
    }
    send(404, { error: "not found" });
  });
  return new Promise((resolve) =>
    server.listen(port, () => resolve({ state, close: () => server.close() })),
  );
}

function answer(body) {
  const user = body.messages.at(-1).content;
  const props = body.format?.properties ?? {};
  if (props.bullets) {
    const lines = [...user.matchAll(/\[(\d+:\d{2})\]\s*([^\n]+)/g)];
    const n = Math.max(props.bullets.minItems ?? 3, 3);
    const pick = (i) => lines[Math.min(lines.length - 1, Math.floor((i * lines.length) / n))];
    const bullets = Array.from({ length: n }, (_, i) => {
      const [, t, text] = pick(i);
      return { text: `Mock point: ${text.split(" ").slice(0, 8).join(" ")}.`, t };
    });
    return {
      title: `Mock part ${lines[0]?.[1] ?? ""}`,
      bullets,
      terms: [{ term: "Mock term", definition: "A term defined by the mock Ollama server." }],
      flashcards: [
        { question: "What wrote these notes?", answer: "The mock Ollama server.", t: bullets[0].t },
        { question: "Which API did it use?", answer: "The Ollama chat API.", t: bullets[1].t },
      ],
    };
  }
  const parts = [...user.matchAll(/^Part (\d+)/gm)].map((m) => Number(m[1]));
  return {
    title: "Mock lecture",
    summary:
      "This summary was written by the mock Ollama server used in end-to-end tests. It covers every part of the lecture in order and lists the main takeaways for revision.",
    ...(props.sections && { sections: [{ heading: "Everything", parts }] }),
  };
}
