// End-to-end check for Phase 6 (AI notes) in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-notes.mjs <speech-file> [--model=fast|better] [--expect=word,word] [--hp]
//   --hp: force Chrome onto the high-performance (discrete) GPU
//
// Needs WebGPU. The first run downloads the notes model (~0.9–1.7 GB) into the e2e profile.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/e2e-notes.mjs <speech-file> [--model=fast|better]");
  process.exit(2);
}
const notesModel = flag("model") ?? "fast";
const expected = (flag("expect") ?? "").split(",").filter(Boolean);
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));
const results = [];
const check = (name, pass, info = "") =>
  results.push({ name, pass: Boolean(pass), info: String(info).slice(0, 90) });

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
    args: [
      "--autoplay-policy=no-user-gesture-required",
      // Dual-GPU machines: Chrome on Windows ignores powerPreference; this picks the dGPU.
      ...(args.includes("--hp") ? ["--force-high-performance-gpu"] : []),
    ],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`${BASE}/`);
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  await page.reload();
  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
    state: "attached",
    timeout: 10 * 60_000,
  });
  const duration = Number(
    await page
      .getByTestId("media")
      .evaluate((m) =>
        m.readyState >= 1
          ? m.duration
          : new Promise((r) => (m.onloadedmetadata = () => r(m.duration))),
      ),
  );

  // ---------- generate ----------
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByTestId("notes-empty").waitFor();
  await page.locator(`input[name=notes-model][value=${notesModel}]`).check({ force: true });
  const t0 = Date.now();
  await page.getByTestId("generate-notes").click();
  let last = "";
  const ticker = setInterval(async () => {
    const s = await page
      .locator("[data-testid=notes-progress] [data-step]")
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.dataset.step}:${e.dataset.status} ${e.innerText.split("\n").slice(1).join(" ")}`,
        ),
      )
      .catch(() => []);
    const line = s.join(" | ");
    if (line && line !== last) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
    last = line;
  }, 2000);
  await page
    .waitForSelector("[data-testid=notes], [data-testid=notes-error]", { timeout: 30 * 60_000 })
    .finally(() => clearInterval(ticker));
  const genSec = (Date.now() - t0) / 1000;
  const err = await page.getByTestId("notes-error").count();
  check(
    "notes generated without error",
    err === 0,
    err ? await page.getByTestId("notes-error").innerText() : `${genSec.toFixed(0)} s`,
  );

  if (err) {
    console.log("NOTES ERROR:", await page.getByTestId("notes-error").innerText());
    console.log("page errors:", errors.join(" | "));
    throw new Error("notes generation failed");
  }
  const notes = await page.getByTestId("notes").evaluate((el) => {
    const sections = [...el.querySelectorAll("[data-testid=notes-section]")].map((s) => ({
      heading: s.querySelector("h3")?.childNodes[0]?.textContent ?? "",
      bullets: [...s.querySelectorAll("li")].map((li) => ({
        text: li.innerText.replace(/\s*\d+:\d{2}\s*$/, ""),
        t: Number(li.querySelector("[data-start]")?.dataset.start),
      })),
    }));
    const summary = el.querySelector("section p")?.textContent ?? "";
    const terms = [...el.querySelectorAll("[data-testid=key-terms] dt")].map((d) => d.textContent);
    return { summary, sections, terms };
  });
  const bullets = notes.sections.flatMap((s) => s.bullets);
  check("summary written", notes.summary.split(/\s+/).length >= 15, notes.summary);
  check(
    "has sections with bullets",
    notes.sections.length >= 1 && bullets.length >= 4,
    `${notes.sections.length} sections, ${bullets.length} bullets`,
  );
  check(
    "bullet timestamps lie within the lecture",
    bullets.every((b) => b.t >= 0 && b.t <= duration + 1),
    `max ${Math.max(...bullets.map((b) => b.t)).toFixed(0)} of ${duration.toFixed(0)}`,
  );
  check(
    "timestamps spread across the lecture",
    new Set(bullets.map((b) => Math.round(b.t))).size >= Math.min(4, bullets.length),
    `${new Set(bullets.map((b) => Math.round(b.t))).size} distinct`,
  );
  if (expected.length) {
    const text = (
      notes.summary +
      " " +
      bullets.map((b) => b.text).join(" ") +
      " " +
      notes.terms.join(" ")
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    // Compare without spaces/hyphens: "MergeSort", "merge-sort" and "merge sort" all count.
    const hits = expected.filter((w) => text.includes(w.toLowerCase().replace(/[^a-z0-9]+/g, "")));
    check(
      "notes mention the lecture's topics",
      hits.length >= Math.ceil(expected.length * 0.75),
      `${hits.length}/${expected.length} missing: ${expected.filter((w) => !hits.includes(w)).join(", ")}`,
    );
  }

  // Timestamp chip seeks the player.
  const chip = page
    .locator("[data-testid=notes-section] li button[data-start]")
    .nth(Math.min(3, bullets.length - 1));
  const chipT = Number(await chip.getAttribute("data-start"));
  await chip.click();
  await page.waitForTimeout(300);
  const t = await page.getByTestId("media").evaluate((m) => m.currentTime);
  check(
    "notes timestamp chip seeks the player",
    Math.abs(t - chipT) < 0.6,
    `${chipT} → ${t.toFixed(2)}`,
  );
  await page.getByTestId("media").evaluate((m) => m.pause());

  // Flashcards tab.
  await page.getByRole("tab", { name: /Flashcards/ }).click();
  const cards = page.locator("[data-testid=flashcards] li");
  const nCards = await cards.count();
  check("flashcards created", nCards >= 2, `${nCards} cards`);
  const firstQ = await cards.first().locator("button[aria-pressed]").innerText();
  await cards.first().locator("button[aria-pressed]").click();
  const firstA = await cards.first().locator("button[aria-pressed]").innerText();
  check(
    "flashcard flips to its answer",
    firstQ !== firstA && /answer/i.test(firstA),
    firstA.replace(/\n/g, " "),
  );

  // ---------- persistence ----------
  await page.reload();
  await page
    .getByTestId("notes")
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  check(
    "notes persist and Notes tab is default after reload",
    await page.getByTestId("notes").isVisible(),
  );
  await page.screenshot({ path: join(tmpdir(), "lna-notes.png"), fullPage: true });

  // ---------- cancel a regeneration keeps the old notes ----------
  await page.getByRole("button", { name: "Regenerate" }).click();
  await page.getByTestId("notes-progress").waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId("notes-progress").getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("notes").waitFor({ timeout: 60_000 });
  check(
    "cancelling a regeneration keeps the previous notes",
    await page.getByText("Note writing was cancelled").isVisible(),
  );

  check("no page errors", errors.length === 0, errors.join(" | "));

  console.log(
    `\n=== Notes (${notesModel}, ${genSec.toFixed(0)} s for ${duration.toFixed(0)} s of audio) ===`,
  );
  console.log(`Summary: ${notes.summary}\n`);
  for (const s of notes.sections) {
    console.log(`## ${s.heading}`);
    for (const b of s.bullets) console.log(`  - [${b.t.toFixed(0)}s] ${b.text}`);
  }
  console.log(`Key terms: ${notes.terms.join(", ")}`);
  const lectureId = new URL(page.url()).pathname.split("/").pop();
  const cardTexts = await page.evaluate(async (lectureId) => {
    const req = indexedDB.open("lecture-notes-ai");
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction("flashcards");
    const all = await new Promise((r) => {
      const q = tx.objectStore("flashcards").getAll();
      q.onsuccess = () => r(q.result);
    });
    return all
      .filter((c) => c.lectureId === lectureId)
      .map((c) => `Q: ${c.question} | A: ${c.answer} [${Math.round(c.sourceStart)}s]`);
  }, lectureId);
  console.log(`Flashcards:\n  ${cardTexts.join("\n  ")}`);
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
