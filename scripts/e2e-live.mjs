// End-to-end check for live microphone mode in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-live.mjs <speech.wav> [--expect=word,word]
//
// Chrome's fake capture device "speaks" the WAV into the microphone in real
// time, so this takes about as long as the file.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/e2e-live.mjs <speech.wav> [--expect=word,word]");
  process.exit(2);
}
const expected = (args.find((a) => a.startsWith("--expect="))?.split("=")[1] ?? "")
  .split(",")
  .filter(Boolean);
const PORT = 4187;
const BASE = `http://localhost:${PORT}`;
const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${info ? ` (${String(info).slice(0, 140)})` : ""}`);
};

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
try {
  for (let i = 0; ; i++) {
    if (i > 80) throw new Error(`Server failed to start on port ${PORT}`);
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
    permissions: ["microphone"],
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${resolve(file)}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---------- blocked microphone ----------
  const denied = await ctx.newPage();
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await denied.goto(`${BASE}/`);
  await denied.getByTestId("record-live").click();
  const deniedMsg = await denied
    .getByText(/Microphone access was blocked/)
    .first()
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check("blocked microphone is explained", deniedMsg);
  check("no lecture page opened when the mic is blocked", !/\/lecture\//.test(denied.url()));
  await denied.close();

  // ---------- record ----------
  await page.goto(`${BASE}/`);
  await page.evaluate(() =>
    localStorage.setItem("lna.settings", JSON.stringify({ model: "fast" })),
  );
  await page.reload();
  const t0 = Date.now();
  await page.getByTestId("record-live").click();
  await page.waitForURL(/\/lecture\/[\w-]+$/, { timeout: 20_000 });
  await page.getByTestId("live-recording").waitFor();
  check("lecture page shows the recording", true);
  check(
    "status badge says Live",
    (await page.locator("header").getByText("Live", { exact: true }).count()) === 1,
  );

  // Text should appear while still recording.
  const firstLine = await page
    .locator("[data-testid=transcript] li")
    .first()
    .waitFor({ timeout: 60_000 })
    .then(
      () => (Date.now() - t0) / 1000,
      () => null,
    );
  check(
    "transcript appears while recording",
    firstLine !== null && (await page.getByTestId("live-recording").isVisible()),
    firstLine === null ? "no text after 60 s" : `first line after ${firstLine.toFixed(0)} s`,
  );
  let maxMeter = 0;
  for (let i = 0; i < 10; i++) {
    const v = Number(await page.getByRole("meter").getAttribute("aria-valuenow"));
    maxMeter = Math.max(maxMeter, v);
    await page.waitForTimeout(300);
  }
  check("level meter moves", maxMeter > 0.05, maxMeter);
  // In-app navigation keeps the recording going.
  const lectureUrl = page.url();
  await page.getByText("← All lectures").click();
  await page.getByTestId("record-live").waitFor();
  check(
    "home page blocks new files while recording",
    (await page.getByTestId("record-live").isDisabled()) &&
      /live recording is running/.test(await page.locator("main").innerText()),
  );
  await page
    .locator(`[data-testid=lecture-list] a[href="${new URL(lectureUrl).pathname}"]`)
    .click();
  await page.getByTestId("live-recording").waitFor();

  // Let the file finish playing into the mic, then stop.
  const fileSec = 67;
  const waitMs = Math.max(0, (fileSec + 3) * 1000 - (Date.now() - t0));
  await page.waitForTimeout(waitMs);
  await page.getByTestId("live-stop").click();
  await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
    state: "attached",
    timeout: 3 * 60_000,
  });
  const stopToDone = (Date.now() - t0) / 1000 - (fileSec + 3);
  check("finishes soon after Stop", stopToDone < 60, `${stopToDone.toFixed(0)} s after stop`);

  const segs = await page.locator("[data-testid=transcript] li").evaluateAll((lis) =>
    lis.map((li) => ({
      t: Number(li.querySelector("[data-start]")?.getAttribute("data-start") ?? NaN),
      text: li.innerText.replace(/^\d+:\d{2}\s*/, ""),
    })),
  );
  const text = segs.map((s) => s.text).join(" ");
  check(
    "timestamps increase and lie within the recording",
    segs.every(
      (s, i) => !Number.isNaN(s.t) && (i === 0 || s.t >= segs[i - 1].t) && s.t < fileSec + 10,
    ),
    segs.map((s) => s.t.toFixed(0)).join(","),
  );
  const missing = expected.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
  check(
    "transcript has the expected words",
    segs.length >= 5 && missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")} | ${text}` : `${segs.length} lines`,
  );

  const media = page.getByTestId("media");
  await media.waitFor({ state: "attached", timeout: 10_000 });
  const dur = await media.evaluate((m) =>
    m.readyState >= 1 ? m.duration : new Promise((r) => (m.onloadedmetadata = () => r(m.duration))),
  );
  check(
    "recording saved and playable",
    dur > fileSec - 2 && dur < fileSec + 30,
    `${dur.toFixed(1)} s`,
  );
  await page.locator("[data-testid=transcript] li").nth(2).locator("[data-start]").click();
  const seekT = await media.evaluate((m) => m.currentTime);
  check("click-to-seek works on the recording", seekT > 0, seekT.toFixed(1));
  await media.evaluate((m) => m.pause());

  await page.getByRole("tab", { name: /Search/ }).click();
  await page.getByTestId("search-input").fill(segs[1]?.text.split(" ").slice(0, 5).join(" ") ?? "");
  const found = await page
    .locator("[data-testid=semantic-results] li")
    .first()
    .waitFor({ timeout: 60_000 })
    .then(
      () => true,
      () => false,
    );
  check("recording is searchable", found);

  await page.reload();
  await page.locator("[data-testid=transcript] li").first().waitFor({ state: "attached" });
  check(
    "saved after reload",
    (await page.locator("[data-testid=transcript] li").count()) === segs.length &&
      (await page.locator("header").getByText("Transcribed").count()) === 1,
  );

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: join(tmpdir(), "lna-live.png"), fullPage: true });
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
