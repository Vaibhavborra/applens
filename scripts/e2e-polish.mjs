// End-to-end check for Phase 8 (exports, study mode, theme, support banner).
//
//   npm run build
//   node scripts/e2e-polish.mjs
//
// Runs on the e2e-notes origin (port 4181): needs a lecture that already has
// AI notes and flashcards, i.e. run scripts/e2e-notes.mjs first.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 4181;
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
    acceptDownloads: true,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`);
  await page.evaluate(() =>
    localStorage.setItem("lna.settings", JSON.stringify({ theme: "system" })),
  );
  await page.reload();
  check("home document title", (await page.title()) === "Lecture Notes AI");

  // Open the newest lecture that has notes.
  const links = page.locator("[data-testid=lecture-list] li a");
  await links.first().waitFor();
  let opened = false;
  for (let i = 0; i < (await links.count()) && !opened; i++) {
    await page.goto(`${BASE}/`);
    await links.nth(i).click();
    await page.waitForURL(/\/lecture\//);
    opened = await page
      .getByTestId("notes")
      .waitFor({ timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
  }
  if (!opened) throw new Error("No lecture with notes on this origin; run e2e-notes.mjs first.");
  const title = await page.getByTestId("lecture-title").innerText();
  check(
    "lecture document title",
    (await page.title()) === `${title} · Lecture Notes AI`,
    await page.title(),
  );

  // ---------- exports ----------
  const segCount = await page.locator("[data-testid=transcript] li").count();
  const cardCount = Number(
    /\((\d+)\)/.exec(await page.getByRole("tab", { name: /Flashcards/ }).innerText())?.[1] ?? 0,
  );
  async function exportFile(id) {
    await page.getByTestId("export-button").click();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId(`export-${id}`).click(),
    ]);
    const path = await dl.path();
    return {
      name: dl.suggestedFilename(),
      text: readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
    };
  }
  const md = await exportFile("notes");
  check(
    "notes export is Markdown with headings",
    md.name.endsWith(" - notes.md") &&
      /^# .+\n/.test(md.text) &&
      /\n## /.test(md.text) &&
      /\[\d+:\d{2}\]/.test(md.text),
    md.name,
  );
  const csv = await exportFile("flashcards");
  const rows = csv.text.trim().split("\r\n");
  check(
    "flashcards export is a 2-column CSV, one row per card",
    csv.name.endsWith(".csv") &&
      rows.length === cardCount &&
      rows.every((r) => /^".*","[\s\S]*\(\d+:\d{2}\)"$/.test(r)),
    `${rows.length} rows / ${cardCount} cards`,
  );
  const txt = await exportFile("transcript");
  const txtLines = txt.text
    .trim()
    .split("\n")
    .filter((l) => /^\[\d+:\d{2}\] /.test(l));
  check(
    "transcript export has one timestamped line per segment",
    txtLines.length === segCount && txt.text.startsWith(title),
    `${txtLines.length} / ${segCount}`,
  );
  const srt = await exportFile("srt");
  const cues = srt.text.trim().split(/\r?\n\r?\n/);
  const cueOk = cues.every((c, i) => {
    const [n, times] = c.split("\n");
    return Number(n) === i + 1 && /^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/.test(times);
  });
  check(
    "SRT export is well-formed",
    srt.name.endsWith(".srt") && cues.length === segCount && cueOk,
    `${cues.length} cues`,
  );

  // ---------- study mode ----------
  await page.getByRole("tab", { name: /Flashcards/ }).click();
  await page.getByTestId("study-start").click();
  await page.getByTestId("study").waitFor();
  const mediaPaused = () => page.getByTestId("media").evaluate((m) => m.paused);
  await page.keyboard.press("Space");
  check("Space reveals the answer", await page.getByTestId("study-answer").isVisible());
  check("Space in study mode doesn't start the player", await mediaPaused());
  await page.keyboard.press("1"); // again
  check(
    "'Again' doesn't count as learned",
    (await page.getByTestId("study-progress").innerText()).startsWith("0 of"),
  );
  for (let i = 0; i < cardCount + 3 && !(await page.getByTestId("study-done").isVisible()); i++) {
    await page.keyboard.press("Space");
    await page.keyboard.press("2");
  }
  const doneText = await page
    .getByTestId("study-done")
    .innerText()
    .catch(() => "");
  check(
    "study session completes with a summary",
    /All \d+ cards learned/.test(doneText) && /1 card needed another look/.test(doneText),
    doneText.replace(/\n/g, " "),
  );
  await page.getByRole("button", { name: /Review the 1 missed/ }).click();
  check(
    "can review only the missed cards",
    (await page.getByTestId("study-progress").innerText()).includes("of 1 learned"),
  );
  await page.keyboard.press("Escape");
  check("Esc leaves study mode", await page.getByTestId("flashcards").isVisible());

  // ---------- theme ----------
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const toggle = page.getByTestId("theme-toggle");
  await toggle.click(); // system → light
  const light = !(await isDark());
  await toggle.click(); // light → dark
  const dark = await isDark();
  check(
    "theme toggle switches light/dark",
    light && dark && (await toggle.getAttribute("data-theme")) === "dark",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  check("dark theme applied before React renders after reload", await isDark());
  await page.getByTestId("theme-toggle").click(); // dark → system
  check(
    "theme back to system",
    (await page.getByTestId("theme-toggle").getAttribute("data-theme")) === "system",
  );

  // ---------- support banner without WebGPU ----------
  const p2 = await ctx.newPage();
  await p2.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined }),
  );
  await p2.goto(`${BASE}/`);
  const banner = await p2
    .getByTestId("support-banner")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  check(
    "browser-support banner explains missing WebGPU",
    /WebGPU isn't available/.test(banner),
    banner,
  );
  await p2.close();
  const p3 = await ctx.newPage();
  await p3.goto(`${BASE}/`);
  await p3.waitForTimeout(1000);
  check(
    "no banner when everything is supported",
    (await p3.getByTestId("support-banner").count()) === 0,
  );
  await p3.close();

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: join(tmpdir(), "lna-polish.png"), fullPage: true });
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
