// End-to-end check for Phase 7 (search) in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-search.mjs <algorithms-lecture.wav>
//
// Expects the 4-topic algorithms lecture fixture (asymptotics, sorting, hash
// tables, graph search) so paraphrased questions have known right answers.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/e2e-search.mjs <algorithms-lecture.wav>");
  process.exit(2);
}
const PORT = 4183;
const BASE = `http://localhost:${PORT}`;

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));
const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${info ? ` (${String(info).slice(0, 110)})` : ""}`);
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

  await page.goto(`${BASE}/`);
  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  const indexStep = page.locator('[data-step="index"]');
  await page.waitForSelector(
    '[data-step="index"][data-status="done"], [data-step="index"][data-status="error"]',
    {
      timeout: 10 * 60_000,
    },
  );
  check(
    "indexing step completes after transcription",
    (await indexStep.getAttribute("data-status")) === "done",
    await indexStep.innerText(),
  );

  await page.getByRole("tab", { name: "Search" }).click();
  const box = page.getByTestId("search-input");
  check(
    "search box is focused when the tab opens",
    await box.evaluate((el) => el === document.activeElement),
  );

  /** Run a query; return the top semantic result's start time and text. */
  async function ask(q) {
    await box.fill(q);
    await page.waitForTimeout(400); // let the 250 ms debounce replace the previous results
    await page
      .locator("[data-testid=semantic-results] li")
      .or(page.getByText("No passage closely matches"))
      .first()
      .waitFor({ timeout: 60_000 });
    const rows = page.locator("[data-testid=semantic-results] li");
    if ((await rows.count()) === 0) return null;
    const first = rows.first();
    return {
      start: Number(await first.locator("[data-start]").getAttribute("data-start")),
      text: (await first.innerText()).replace(/\s+/g, " "),
      count: await rows.count(),
      starts: await rows
        .locator("[data-start]")
        .evaluateAll((els) => els.map((e) => Number(e.dataset.start))),
    };
  }

  // Paraphrases that avoid the lecture's exact wording; section ranges from the fixture.
  const qs = [
    {
      q: "what happens when two keys land in the same bucket?",
      range: [140, 214],
      topic: "hash tables",
    },
    {
      q: "how do I find the shortest route in a graph without weights?",
      range: [205, 265],
      topic: "graph search",
    },
    {
      q: "why can choosing the dividing element badly make sorting slow?",
      range: [100, 150],
      topic: "quicksort pivot",
    },
    {
      q: "describing how running time grows with input size",
      range: [0, 70],
      topic: "asymptotics",
    },
  ];
  // The right passage must rank in the top 3 (users see 5 timestamped results).
  for (const { q, range, topic } of qs) {
    const r = await ask(q);
    const rank = r ? r.starts.findIndex((s) => s >= range[0] && s <= range[1]) + 1 : 0;
    check(
      `semantic: “${q}” → ${topic} (rank ${rank || "none"})`,
      rank >= 1 && rank <= 3,
      r
        ? `top: ${r.start.toFixed(0)}s · all: ${r.starts.map((s) => s.toFixed(0)).join(", ")}`
        : "no result",
    );
  }

  await box.fill("pivot");
  await page.waitForTimeout(400); // debounce
  await page.waitForSelector("[data-testid=keyword-results] li");
  const kw = page.locator("[data-testid=keyword-results] li");
  const marks = await page.locator("[data-testid=keyword-results] mark").allInnerTexts();
  check(
    "keyword search finds every line with the word",
    (await kw.count()) >= 2,
    `${await kw.count()} lines`,
  );
  check(
    "keyword matches are highlighted",
    marks.length >= 2 && marks.every((m) => m.toLowerCase() === "pivot"),
    marks.join(","),
  );

  const target = kw.nth(1);
  const t0 = Number(await target.locator("[data-start]").getAttribute("data-start"));
  await target.locator("button").click();
  await page.waitForTimeout(300);
  const t = await page.getByTestId("media").evaluate((m) => m.currentTime);
  check("clicking a result seeks the player", Math.abs(t - t0) < 0.6, `${t0} → ${t.toFixed(2)}`);
  await page.getByTestId("media").evaluate((m) => m.pause());

  await box.fill("zebra giraffe");
  await page.waitForSelector("text=No line contains these words");
  check("no-match states are shown", true);

  // ---------- old lecture without an index → built on demand ----------
  const lectureId = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`${BASE}/favicon.svg`);
  await page.evaluate(async (id) => {
    const req = indexedDB.open("lecture-notes-ai");
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction(["passages", "lectures"], "readwrite");
    const passages = tx.objectStore("passages");
    const all = await new Promise((r) => {
      const q = passages.getAll();
      q.onsuccess = () => r(q.result);
    });
    for (const p of all) if (p.lectureId === id) passages.delete(p.id);
    const lectures = tx.objectStore("lectures");
    const l = await new Promise((r) => {
      const q = lectures.get(id);
      q.onsuccess = () => r(q.result);
    });
    delete l.searchModel;
    lectures.put(l);
    await new Promise((r) => (tx.oncomplete = r));
    dbh.close();
  }, lectureId);
  await page.goto(`${BASE}/lecture/${lectureId}`);
  await page.getByRole("tab", { name: "Search" }).click();
  const sawProgress = await page
    .getByTestId("index-progress")
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  const r = await ask("what happens when two keys land in the same bucket?");
  check(
    "missing index is rebuilt when the Search tab opens",
    sawProgress && r && r.start >= 140 && r.start <= 214,
    r?.text ?? "no result",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Search" }).click();
  const again = await page
    .getByTestId("index-progress")
    .waitFor({ timeout: 2000 })
    .then(
      () => true,
      () => false,
    );
  check("rebuilt index persists (no re-index after reload)", !again);

  await page.screenshot({ path: join(tmpdir(), "lna-search.png"), fullPage: true });
  check("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
