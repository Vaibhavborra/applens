// End-to-end transcription check in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-transcribe.mjs <audio-file> [--device=wasm|webgpu] [--model=fast|balanced|best]
//        [--expect=word1,word2,...] [--dev] [--headed]
//
// Uses a persistent profile in the OS temp dir so model weights are downloaded only once.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error(
    "usage: node scripts/e2e-transcribe.mjs <audio-file> [--device=wasm] [--model=fast]",
  );
  process.exit(2);
}
const device = flag("device");
const model = flag("model") ?? "fast";
const expected = (flag("expect") ?? "").split(",").filter(Boolean);
const DEV = args.includes("--dev");
const PORT = 4176;

const server = spawn(`npx vite ${DEV ? "" : "preview "}--port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));
const stop = () =>
  process.platform === "win32"
    ? spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"])
    : server.kill();

try {
  for (let i = 0; ; i++) {
    if (exited || i > 80) throw new Error(`Server failed to start on port ${PORT}`);
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const ctx = await chromium.launchPersistentContext(join(tmpdir(), "lna-e2e-profile"), {
    channel: "chrome",
    headless: !args.includes("--headed"),
    viewport: { width: 1100, height: 1000 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/${device ? `?device=${device}` : ""}`);
  await page.locator(`input[name=model][value=${model}]`).check({ force: true });
  const t0 = Date.now();
  await page.getByTestId("file-input").setInputFiles(file);

  // Log step details while waiting.
  let last = "";
  const ticker = setInterval(async () => {
    const steps = await page
      .locator("[data-step]")
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.dataset.step}:${e.dataset.status} ${e.innerText.split("\n").slice(1).join(" ")}`,
        ),
      )
      .catch(() => []);
    const line = steps.join(" | ");
    if (line !== last) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
    last = line;
  }, 1000);

  const status = await page
    .waitForSelector(
      '[data-testid=transcript-status][data-status="done"], [data-step][data-status="error"]',
      {
        timeout: 15 * 60_000,
      },
    )
    .finally(() => clearInterval(ticker));
  const ok = (await status.getAttribute("data-testid")) === "transcript-status";

  const segments = await page.locator("[data-testid=transcript] li").evaluateAll((lis) =>
    lis.map((li) => ({
      start: Number(li.querySelector("[data-start]")?.dataset.start),
      text: li.innerText.split("\n").slice(1).join(" ").trim(),
    })),
  );
  const steps = await page
    .locator("[data-step]")
    .evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, " ")));
  await page.screenshot({ path: join(tmpdir(), "lna-transcribe.png"), fullPage: true });
  await ctx.close();

  const text = segments
    .map((s) => s.text)
    .join(" ")
    .toLowerCase();
  const monotonic = segments.every((s, i) => i === 0 || s.start >= segments[i - 1].start);
  const hits = expected.filter((w) => text.includes(w.toLowerCase()));

  console.log("\nSteps:\n  " + steps.join("\n  "));
  console.log(`\nTranscript (${segments.length} segments):`);
  for (const s of segments) console.log(`  [${s.start.toFixed(1).padStart(6)}] ${s.text}`);
  console.log(`\nmonotonic timestamps: ${monotonic}`);
  if (expected.length)
    console.log(
      `expected words: ${hits.length}/${expected.length}  missing: ${expected.filter((w) => !hits.includes(w)).join(", ") || "none"}`,
    );
  if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
  console.log(`screenshot: ${join(tmpdir(), "lna-transcribe.png")}`);

  const pass =
    ok && monotonic && hits.length >= Math.ceil(expected.length * 0.8) && errors.length === 0;
  console.log(pass ? "\nPASS" : "\nFAIL");
  process.exitCode = pass ? 0 : 1;
} finally {
  stop();
}
