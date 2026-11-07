// End-to-end check for the Ollama notes engine, against a mock Ollama server.
//
//   npm run build
//   node scripts/e2e-ollama.mjs <speech-file> [--real=http://localhost:11434 --model=qwen2.5:3b]
//
// Without --real, a mock Ollama (scripts/mock-ollama.mjs) runs on port 11500.
// With --real, notes are written by your installed Ollama instead.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startMockOllama } from "./mock-ollama.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/e2e-ollama.mjs <speech-file> [--real=URL --model=NAME]");
  process.exit(2);
}
const real = flag("real");
const MOCK_PORT = 11500;
const ollamaUrl = real ?? `http://localhost:${MOCK_PORT}`;
const ollamaModel = flag("model") ?? "qwen2.5:3b";
const PORT = 4185;
const BASE = `http://localhost:${PORT}`;

const mock = real ? null : await startMockOllama(MOCK_PORT);
const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));
const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${info ? ` (${String(info).slice(0, 120)})` : ""}`);
};

try {
  for (let i = 0; ; i++) {
    if (exited || i > 80) throw new Error(`Server failed to start on port ${PORT}`);
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const ctx = await chromium.launchPersistentContext(join(tmpdir(), "lna-e2e-profile"), {
    channel: "chrome",
    serviceWorkers: "block", // always test the fresh build, not a cached one
    headless: !args.includes("--headed"),
    viewport: { width: 1100, height: 1000 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`);
  await page.evaluate((s) => localStorage.setItem("lna.settings", JSON.stringify(s)), {
    model: "fast",
    notesEngine: "ollama",
    ollamaUrl,
    ollamaModel: "not-installed:1b",
  });
  await page.reload();
  check(
    "auto-notes option offered with Ollama selected",
    (await page.getByTestId("auto-notes").count()) === 1,
  );
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
    state: "attached",
    timeout: 10 * 60_000,
  });

  // ---------- settings UI ----------
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByTestId("notes-empty").waitFor();
  const status = page.getByTestId("ollama-status");
  await status.filter({ hasNotText: "Checking" }).waitFor();
  check(
    "missing model is flagged with an install command",
    real || /ollama pull qwen2\.5:3b/.test(await status.innerText()),
    await status.innerText(),
  );
  await page.getByTestId("ollama-model").selectOption(ollamaModel);
  check(
    "connected once an installed model is picked",
    /Connected · \d+ models? installed/.test(await status.innerText()),
    await status.innerText(),
  );

  // ---------- generate ----------
  const t0 = Date.now();
  await page.getByTestId("generate-notes").click();
  await page.waitForSelector("[data-testid=notes], [data-testid=notes-error]", {
    timeout: 20 * 60_000,
  });
  const err = await page.getByTestId("notes-error").count();
  check(
    "notes written by Ollama",
    err === 0,
    err
      ? await page.getByTestId("notes-error").innerText()
      : `${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  if (err) throw new Error("notes failed");
  const footer = await page
    .getByTestId("notes")
    .locator("xpath=following-sibling::div")
    .innerText();
  check("footer credits the Ollama model", footer.includes(`${ollamaModel} (Ollama)`), footer);
  check(
    "notes have sections and a summary",
    (await page.getByTestId("notes-section").count()) >= 1 &&
      (await page.getByTestId("notes").locator("section p").first().innerText()).length > 40,
  );
  check(
    "flashcards saved",
    /\((\d+)\)/.test(await page.getByRole("tab", { name: /Flashcards/ }).innerText()),
  );
  if (mock) {
    const map = mock.state.chats.find((c) => c.format?.properties?.bullets);
    check(
      "map requests use structured output and a big enough context",
      map &&
        map.stream === false &&
        map.options.num_ctx >= 8192 &&
        map.format.required.includes("bullets"),
    );
  }

  // ---------- cancel ----------
  if (mock) {
    mock.state.delayMs = 4000;
    await page.getByRole("button", { name: "Regenerate" }).click();
    await page.getByTestId("notes-progress").waitFor();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByText("Note writing was cancelled.").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    check(
      "cancel aborts the Ollama request",
      mock.state.aborted >= 1,
      `${mock.state.aborted} aborted`,
    );
    check("previous notes kept after cancel", (await page.getByTestId("notes").count()) === 1);
    mock.state.delayMs = 0;
  }

  // ---------- unreachable ----------
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("lna.settings"));
    localStorage.setItem(
      "lna.settings",
      JSON.stringify({ ...s, ollamaUrl: "http://localhost:11599" }),
    );
  });
  await page.reload();
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByRole("button", { name: "Regenerate" }).click();
  const unreachable = await page.getByTestId("notes-error").innerText({ timeout: 10_000 });
  check(
    "unreachable Ollama explained",
    /Couldn't reach Ollama at http:\/\/localhost:11599/.test(unreachable),
    unreachable,
  );
  check("previous notes kept after an error", (await page.getByTestId("notes").count()) === 1);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  await ctx.close();
} finally {
  mock?.close();
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
