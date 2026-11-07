// End-to-end check for offline support (PWA) in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-offline.mjs <speech-file>
//
// Phase 1 (online): install the service worker, transcribe + index a lecture.
// Phase 2 (offline): stop the server, relaunch Chrome with every hostname
// except localhost unresolvable and the network emulated offline, then check
// the app, saved lectures, search and transcription still work.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/e2e-offline.mjs <speech-file>");
  process.exit(2);
}
const headless = !process.argv.includes("--headed");
const PORT = 4186;
const BASE = `http://localhost:${PORT}`;
const PROFILE = join(tmpdir(), "lna-e2e-profile");
const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${info ? ` (${String(info).slice(0, 120)})` : ""}`);
};

let server = null;
const stopServer = () => {
  if (!server) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
  server = null;
};

try {
  server = spawn(`npx vite preview --port ${PORT} --strictPort`, { shell: true, stdio: "pipe" });
  for (let i = 0; ; i++) {
    if (i > 80) throw new Error(`Server failed to start on port ${PORT}`);
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ---------- phase 1: online ----------
  let ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless,
    viewport: { width: 1100, height: 1000 },
  });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${BASE}/`);
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  // Start clean: drop a service worker and app precache left by an earlier build.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (k.startsWith("workbox-")) await caches.delete(k);
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  check(
    "service worker controls the page",
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  );
  check(
    "still cross-origin isolated under the service worker",
    await page.evaluate(() => crossOriginIsolated),
  );
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector("link[rel=manifest]")?.getAttribute("href");
    return href ? (await fetch(href)).json() : null;
  });
  check(
    "web app manifest with icons",
    manifest?.name === "Lecture Notes AI" && manifest.icons.length >= 3,
  );

  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  const lectureUrl = page.url();
  await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
    state: "attached",
    timeout: 10 * 60_000,
  });
  await page.locator('[data-step="index"][data-status="done"]').waitFor({ timeout: 5 * 60_000 });
  const segCount = await page.locator("[data-testid=transcript] li").count();
  const cdn = await page.evaluate(async () =>
    (await (await caches.open("cdn")).keys()).map((r) => r.url),
  );
  check(
    "CDN runtime files cached (onnxruntime)",
    cdn.some((u) => u.includes("onnxruntime-web")),
    `${cdn.length} files`,
  );
  await ctx.close();
  stopServer();

  // ---------- phase 2: offline ----------
  ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless,
    viewport: { width: 1100, height: 1000 },
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"],
  });
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`);
  check("app loads with no server and no network", (await page.title()) === "Lecture Notes AI");
  check("offline badge shown", await page.getByTestId("offline-badge").isVisible());
  check(
    "saved lecture listed",
    await page
      .locator("[data-testid=lecture-list] li")
      .first()
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      ),
  );

  await page.goto(lectureUrl);
  await page.locator("[data-testid=transcript] li").first().waitFor({ timeout: 10_000 });
  check(
    "deep link to a lecture opens offline with its transcript",
    (await page.locator("[data-testid=transcript] li").count()) === segCount,
  );
  const played = await page.getByTestId("media").evaluate(async (m) => {
    m.muted = true;
    await m.play();
    await new Promise((r) => setTimeout(r, 700));
    m.pause();
    return m.currentTime > 0.2;
  });
  check("saved recording plays offline", played);

  await page.getByRole("tab", { name: /Search/ }).click();
  const firstWords = (await page.locator("[data-testid=transcript] li").nth(1).innerText())
    .replace(/^\d+:\d{2}\s*/, "")
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  await page.getByTestId("search-input").fill(firstWords);
  const semantic = await page
    .locator("[data-testid=semantic-results] li")
    .first()
    .waitFor({ timeout: 60_000 })
    .then(
      () => true,
      () => false,
    );
  check("semantic search works offline (cached embedding model)", semantic, firstWords);

  await page.goto(`${BASE}/`);
  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL(/\/lecture\/[\w-]+$/);
  const status = await page
    .waitForSelector('[data-testid=transcript-status][data-status="done"]', {
      state: "attached",
      timeout: 5 * 60_000,
    })
    .then(
      () => "done",
      async () => (await page.locator("main").innerText()).slice(0, 200),
    );
  check("transcribes a new file offline (cached Whisper model)", status === "done", status);

  // A model that was never downloaded: the error should say why.
  await page.goto(`${BASE}/`);
  const balanced = page.locator("input[name=model][value=balanced]");
  await balanced.waitFor({ state: "attached" });
  for (let i = 0; i < 60 && (await balanced.isDisabled()); i++) await page.waitForTimeout(500);
  if (await balanced.isDisabled()) {
    check("'balanced' model selectable", false, await page.locator("fieldset").first().innerText());
  } else {
    await balanced.check({ force: true });
    await page.getByTestId("file-input").setInputFiles(file);
    await page.waitForURL(/\/lecture\/[\w-]+$/);
    const offlineMsg = await page
      .getByText(/You're offline and this needs a download/)
      .first()
      .waitFor({ timeout: 60_000 })
      .then(
        () => true,
        () => false,
      );
    check("never-downloaded model explains it needs a connection", offlineMsg);
  }

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.evaluate(() => localStorage.removeItem("lna.settings"));
  await ctx.close();
} finally {
  stopServer();
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
