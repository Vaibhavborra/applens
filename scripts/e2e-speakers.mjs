// End-to-end check for speaker labels in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-speakers.mjs <dialog.wav> <dialog.truth.json> <one-speaker.wav>...
//
// truth.json: [{ speaker, start, end }] per spoken line of the dialog.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [dialog, truthFile, ...singles] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dialog || !truthFile || singles.length === 0) {
  console.error(
    "usage: node scripts/e2e-speakers.mjs <dialog.wav> <truth.json> <one-speaker.wav>...",
  );
  process.exit(2);
}
const truth = JSON.parse(readFileSync(truthFile, "utf8"));
const PORT = 4188;
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
    headless: !process.argv.includes("--headed"),
    viewport: { width: 1100, height: 1000 },
    acceptDownloads: true,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  async function transcribeAndIdentify(file) {
    await page.goto(`${BASE}/`);
    await page.evaluate(() =>
      localStorage.setItem("lna.settings", JSON.stringify({ model: "fast" })),
    );
    await page.reload();
    await page.getByTestId("file-input").setInputFiles(file);
    await page.waitForURL(/\/lecture\/[\w-]+$/);
    await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
      state: "attached",
      timeout: 10 * 60_000,
    });
    await page.getByRole("tab", { name: "Transcript" }).click();
    const t0 = Date.now();
    await page.getByTestId("identify-speakers").click();
    await page
      .locator("[data-testid=speaker-count], [data-testid=speakers-error]")
      .first()
      .waitFor({ timeout: 5 * 60_000 });
    const err = await page.getByTestId("speakers-error").count();
    if (err) throw new Error(await page.getByTestId("speakers-error").innerText());
    return {
      count: await page.getByTestId("speaker-count").innerText(),
      sec: (Date.now() - t0) / 1000,
    };
  }

  // ---------- two speakers ----------
  const two = await transcribeAndIdentify(dialog);
  check(
    "dialog: 2 speakers found",
    two.count === "2 speakers found",
    `${two.count}, ${two.sec.toFixed(0)} s`,
  );
  const lines = await page.locator("[data-testid=transcript] li").evaluateAll((lis) =>
    lis.map((li) => ({
      speaker: Number(li.dataset.speaker),
      start: Number(li.querySelector("[data-start]")?.getAttribute("data-start")),
    })),
  );
  // Ground truth for a line: the truth turn containing its start (or the nearest one).
  const truthAt = (t) =>
    truth.reduce(
      (best, u) => {
        const d = t < u.start ? u.start - t : t > u.end ? t - u.end : 0;
        return d < best.d ? { d, s: u.speaker } : best;
      },
      { d: Infinity, s: "?" },
    ).s;
  const firstSpeaker = truth[0].speaker;
  const correct = lines.filter(
    (l) => (l.speaker === 0) === (truthAt(l.start + 0.3) === firstSpeaker),
  ).length;
  check(
    "dialog: lines attributed to the right speaker",
    correct / lines.length >= 0.9,
    `${correct}/${lines.length} correct`,
  );
  const labelCount = await page.getByTestId("speaker-label").count();
  const turns = truth.filter((u, i) => i === 0 || u.speaker !== truth[i - 1].speaker).length;
  check(
    "dialog: a name is shown at each change of speaker",
    Math.abs(labelCount - turns) <= 1,
    `${labelCount} labels, ${turns} turns`,
  );

  await page.getByTestId("speaker-name-0").fill("Professor");
  await page.getByTestId("speaker-name-0").press("Enter");
  await page.waitForTimeout(300);
  check(
    "renaming a speaker updates the transcript",
    (await page.getByTestId("speaker-label").first().innerText()) === "Professor",
  );
  await page.getByTestId("export-button").click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-transcript").click(),
  ]);
  const txt = readFileSync(await dl.path(), "utf8");
  check(
    "transcript export includes speaker names",
    /\] Professor: /.test(txt) && /\] Speaker 2: /.test(txt),
    txt.split("\n").slice(2, 5).join(" | "),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Transcript" }).click();
  check(
    "speaker names saved",
    (await page.getByTestId("speaker-label").first().innerText()) === "Professor",
  );

  // ---------- one speaker ----------
  for (const f of singles) {
    const one = await transcribeAndIdentify(f);
    const name = f.split(/[\\/]/).pop();
    check(
      `${name}: one speaker found`,
      one.count === "1 speaker found",
      `${one.count}, ${one.sec.toFixed(0)} s`,
    );
    check(
      `${name}: no speaker labels shown`,
      (await page.getByTestId("speaker-label").count()) === 0,
    );
  }

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
