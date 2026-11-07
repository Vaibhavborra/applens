// End-to-end check for Phase 5 (persistence) in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-persist.mjs <short-speech-file> <long-speech-file (≥ 2 min)>
//
// Clears this app's IndexedDB in the shared e2e profile first (model cache is kept).
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [short, long] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!short || !long) {
  console.error("usage: node scripts/e2e-persist.mjs <short-speech-file> <long-speech-file>");
  process.exit(2);
}
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));

const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass), info: String(info) });
  // Stream progress so a hang shows where it stopped.
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${info ? ` (${String(info).slice(0, 80)})` : ""}`);
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
    headless: !process.argv.includes("--headed"),
    viewport: { width: 1100, height: 1000 },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Clear the app DB from a static file on the same origin (no app connection open).
  await page.goto(`${BASE}/favicon.svg`);
  await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const r = indexedDB.deleteDatabase("lecture-notes-ai");
        r.onsuccess = res;
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error("delete blocked"));
      }),
  );

  const lines = () => page.locator("[data-testid=transcript] li");
  const waitDone = () =>
    page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
      state: "attached", // the heading can be visually empty (screen-reader text only)
      timeout: 10 * 60_000,
    });
  const waitList = (count) =>
    count === 0
      ? page.getByText("No saved lectures yet").waitFor({ timeout: 10_000 })
      : page.waitForFunction(
          (c) => document.querySelectorAll("[data-testid=lecture-list] li").length === c,
          count,
          { timeout: 10_000 },
        );
  const listTitles = () => page.locator("[data-testid=lecture-list] li a").allInnerTexts();

  // ---------- 1. transcribe → saved, survives reload ----------
  await page.goto(`${BASE}/`);
  check(
    "empty state on first visit",
    await waitList(0).then(
      () => true,
      () => false,
    ),
  );
  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(short);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  const lectureUrl = page.url();
  check("navigates to the lecture page", /\/lecture\//.test(lectureUrl), lectureUrl);
  await waitDone();
  const n = await lines().count();
  const firstText = await lines().first().innerText();

  await page.reload();
  await waitDone();
  check("transcript survives reload", (await lines().count()) === n, `${n} lines`);
  check("same first line after reload", (await lines().first().innerText()) === firstText);
  await page
    .getByTestId("media")
    .evaluate((m) => (m.readyState >= 1 ? 0 : new Promise((r) => (m.onloadedmetadata = r))));
  check(
    "stored media plays back after reload",
    (await page.getByTestId("media").evaluate((m) => m.duration)) > 30,
  );
  check("waveform restored from stored peaks", await page.getByTestId("waveform").isVisible());
  const target = lines().nth(3).locator("button");
  const start = Number(await target.locator("[data-start]").getAttribute("data-start"));
  await target.click();
  await page.waitForTimeout(300);
  const t = await page.getByTestId("media").evaluate((m) => m.currentTime);
  check(
    "click-to-seek works on a reopened lecture",
    Math.abs(t - start) < 0.6,
    `${start} → ${t.toFixed(2)}`,
  );
  await page.getByTestId("media").evaluate((m) => m.pause());

  // ---------- 2. rename → shows in list ----------
  await page.getByLabel("Rename lecture").click();
  await page.getByLabel("Lecture title").fill("Recursion — week 3");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "← All lectures" }).click();
  await page.waitForURL(`${BASE}/`);
  await waitList(1);
  const titles = await listTitles();
  check(
    "renamed title appears in the list",
    titles.includes("Recursion — week 3"),
    titles.join(" | "),
  );
  check(
    "list shows Transcribed status",
    await page.locator("[data-testid=lecture-list]").getByText("Transcribed").isVisible(),
  );
  check("storage usage shown", await page.getByTestId("storage").isVisible());

  // ---------- 3. remove media → transcript only; re-attach ----------
  await page.goto(lectureUrl);
  await waitDone();
  await page.getByRole("button", { name: /Free up .* by removing the recording/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByTestId("no-media").waitFor();
  await page.reload();
  await waitDone();
  check(
    "media removal persists; transcript kept",
    (await page.getByTestId("no-media").isVisible()) && (await lines().count()) === n,
  );
  await page.getByTestId("attach-input").setInputFiles(short);
  await page.getByTestId("media").waitFor({ timeout: 10_000 });
  check("re-attached media plays", (await page.getByTestId("media").count()) === 1);

  // ---------- 4. interrupted by reload → "Transcribe again" completes ----------
  await page.goto(`${BASE}/`);
  await page.getByTestId("file-input").setInputFiles(long);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  const longUrl = page.url();
  await page.waitForSelector("[data-step=transcribe] >> text=/[1-9]\\d?%/", {
    timeout: 5 * 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-testid=transcript] li").length > 0,
  );
  await page.reload();
  await page.getByTestId("status-banner").waitFor({ timeout: 10_000 });
  const banner = await page.getByTestId("status-banner").innerText();
  const partial = await lines().count();
  check(
    "reload mid-transcription marks it interrupted",
    /interrupted/i.test(banner),
    banner.split("\n")[0],
  );
  check("partial transcript kept", partial > 0, `${partial} lines`);
  await page.getByRole("button", { name: "Transcribe again" }).click();
  await waitDone();
  const full = await lines().count();
  const starts = await lines()
    .locator("[data-start]")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.start)));
  const dupes = starts.length - new Set(starts.map((s) => s.toFixed(2))).size;
  check("re-run completes with full transcript", full > partial, `${partial} → ${full} lines`);
  check(
    "re-run replaced (not appended to) the old transcript",
    dupes === 0 && starts[0] < 1,
    `dupes ${dupes}, first ${starts[0]}`,
  );
  await page.reload();
  await waitDone();
  check("re-run result persisted", (await lines().count()) === full);

  // ---------- 5. keep-media off → transcript-only lecture ----------
  await page.goto(`${BASE}/`);
  await page.getByTestId("keep-media").uncheck();
  await page.getByTestId("file-input").setInputFiles(short);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  await waitDone();
  await page.reload();
  await waitDone();
  check(
    "keep-media off stores transcript only",
    (await page.getByTestId("no-media").isVisible()) && (await lines().count()) > 0,
  );
  await page.goto(`${BASE}/`);
  await page.getByTestId("keep-media").check();
  await waitList(3);
  check(
    "list shows 3 lectures, newest first",
    (await listTitles()).length === 3 && (await listTitles()).at(-1) === "Recursion — week 3",
    (await listTitles()).join(" | "),
  );

  // ---------- 6. delete ----------
  const row = page.locator("[data-testid=lecture-list] li", { hasText: "Recursion — week 3" });
  await row.getByRole("button", { name: /^Delete / }).click();
  await row.getByRole("button", { name: /^Confirm delete/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-testid=lecture-list] li").length === 2,
  );
  check("delete from list removes it", !(await listTitles()).includes("Recursion — week 3"));
  await page.goto(lectureUrl);
  check(
    "deleted lecture deep link shows not-found",
    await page.getByText("doesn't exist").isVisible(),
  );

  await page.goto(longUrl);
  await waitDone();
  await page.getByRole("button", { name: "Delete lecture" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(`${BASE}/`);
  await waitList(1).catch(() => undefined);
  check("delete from lecture page returns home", (await listTitles()).length === 1);
  await page.screenshot({ path: join(tmpdir(), "lna-persist-home.png"), fullPage: true });

  check("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
