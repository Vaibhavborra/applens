// End-to-end check for Phase 4 (player sync) in the locally installed Google Chrome.
//
//   npm run build
//   node scripts/e2e-player.mjs <speech-file> [--dev]
//
// <speech-file> should contain a few sentences of speech longer than ~30 s.
// Reuses the e2e browser profile so the Whisper model is already cached.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const speech = args.find((a) => !a.startsWith("--"));
if (!speech) {
  console.error("usage: node scripts/e2e-player.mjs <speech-file> [--dev]");
  process.exit(2);
}
const PORT = 4178;
const BASE = `http://localhost:${PORT}/`;

// A Sun .au tone: Chrome can't play it, so the player must fall back to a WAV.
const dir = mkdtempSync(join(tmpdir(), "lna-player-"));
const au = join(dir, "tone.au");
{
  const rate = 16000;
  const n = rate * 3;
  const buf = Buffer.alloc(24 + n * 2);
  buf.write(".snd", 0);
  buf.writeUInt32BE(24, 4);
  buf.writeUInt32BE(n * 2, 8);
  buf.writeUInt32BE(3, 12);
  buf.writeUInt32BE(rate, 16);
  buf.writeUInt32BE(1, 20);
  for (let i = 0; i < n; i++) buf.writeInt16BE(Math.round(Math.sin(i / 8) * 8000), 24 + i * 2);
  writeFileSync(au, buf);
}

const server = spawn(
  `npx vite ${args.includes("--dev") ? "" : "preview "}--port ${PORT} --strictPort`,
  {
    shell: true,
    stdio: "pipe",
  },
);
let exited = false;
server.on("exit", () => (exited = true));

const results = [];
const check = (name, pass, info = "") => {
  results.push({ name, pass: Boolean(pass), info: String(info) });
};

try {
  for (let i = 0; ; i++) {
    if (exited || i > 80) throw new Error(`Server failed to start on port ${PORT}`);
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const ctx = await chromium.launchPersistentContext(join(tmpdir(), "lna-e2e-profile"), {
    channel: "chrome",
    headless: !args.includes("--headed"),
    viewport: { width: 1100, height: 1000 },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const media = () => page.getByTestId("media");
  const time = () => media().evaluate((m) => m.currentTime);
  const activeStart = () =>
    page
      .locator("[data-testid=transcript] [aria-current=true] [data-start]")
      .getAttribute("data-start", { timeout: 2000 })
      .then(Number)
      .catch(() => NaN);
  const settle = () => page.waitForTimeout(300);

  // ---------- 1. speech file: click-to-seek, highlight, follow, shortcuts ----------
  await page.goto(`${BASE}`);
  await page.locator("input[name=model][value=fast]").check({ force: true });
  await page.getByTestId("file-input").setInputFiles(speech);
  await page.waitForSelector('[data-testid=transcript-status][data-status="done"]', {
    timeout: 10 * 60_000,
  });
  await media().evaluate((m) =>
    m.readyState >= 1 ? null : new Promise((r) => (m.onloadedmetadata = r)),
  );

  const lines = page.locator("[data-testid=transcript] li button");
  const count = await lines.count();
  check("transcript has lines", count >= 4, `${count} lines`);

  const target = lines.nth(Math.floor(count * 0.7));
  const targetStart = Number(await target.locator("[data-start]").getAttribute("data-start"));
  await target.click();
  await settle();
  const t1 = await time();
  check(
    "clicking a line seeks to its start",
    Math.abs(t1 - targetStart) < 0.6,
    `start ${targetStart.toFixed(2)} → t ${t1.toFixed(2)}`,
  );
  check("clicked line is highlighted", (await activeStart()) === targetStart);
  check("clicking a line starts playback", !(await media().evaluate((m) => m.paused)));

  await page.waitForTimeout(1500);
  const t2 = await time();
  check("playback advances", t2 > t1 + 1, `${t1.toFixed(2)} → ${t2.toFixed(2)}`);

  // Highlight follows playback across a line boundary.
  const next = lines.nth(Math.floor(count * 0.7) + 1);
  const nextStart = Number(await next.locator("[data-start]").getAttribute("data-start"));
  await media().evaluate((m, t) => (m.currentTime = t), nextStart - 0.4);
  await page.waitForTimeout(1200);
  check(
    "highlight moves to the next line during playback",
    (await activeStart()) === nextStart,
    `active ${await activeStart()} expected ${nextStart}`,
  );

  // Keyboard shortcuts with focus on the page body.
  await page.locator("h1").click();
  await page.keyboard.press("Space");
  await settle();
  check("Space pauses", await media().evaluate((m) => m.paused));
  const before = await time();
  await page.keyboard.press("ArrowLeft");
  await settle();
  const after = await time();
  check(
    "← rewinds 5 s",
    Math.abs(before - 5 - after) < 0.3,
    `${before.toFixed(2)} → ${after.toFixed(2)}`,
  );
  await page.keyboard.press("Space");
  await settle();
  check("Space resumes", !(await media().evaluate((m) => m.paused)));
  await media().evaluate((m) => m.pause());

  // Waveform click seeks proportionally and updates the highlight while paused.
  const wave = page.getByTestId("waveform");
  const box = await wave.boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await settle();
  const duration = Number(await page.getByTestId("decode-result").getAttribute("data-duration"));
  const t3 = await time();
  check(
    "waveform click seeks",
    Math.abs(t3 - duration * 0.25) < 0.5,
    `t ${t3.toFixed(2)} of ${duration.toFixed(2)}`,
  );
  const a3 = await activeStart();
  check("highlight updates on seek while paused", a3 <= t3 && a3 >= 0, `active start ${a3}`);
  const headLeft = await wave.locator("div[aria-hidden]").evaluate((d) => parseFloat(d.style.left));
  check(
    "playhead drawn at seek position",
    Math.abs(headLeft - 25) < 1.5,
    `${headLeft.toFixed(1)}%`,
  );
  await page.screenshot({ path: join(tmpdir(), "lna-player.png"), fullPage: true });

  // ---------- 2. unplayable format → WAV fallback ----------
  await page.goto(`${BASE}`);
  await page.getByTestId("file-input").setInputFiles(au);
  await page.waitForSelector('[data-testid=media][data-fallback="true"]', { timeout: 120_000 });
  const fb = await media().evaluate(async (m) => {
    if (m.readyState < 1) await new Promise((r) => (m.onloadedmetadata = r));
    await m.play();
    await new Promise((r) => setTimeout(r, 700));
    m.pause();
    return { tag: m.tagName, duration: m.duration, t: m.currentTime };
  });
  check(
    ".au plays via WAV fallback",
    fb.tag === "AUDIO" && Math.abs(fb.duration - 3) < 0.1 && fb.t > 0.3,
    JSON.stringify(fb),
  );

  // ---------- 3. video vs audio-only containers ----------
  for (const withVideo of [true, false]) {
    await page.goto(`${BASE}`);
    const tag = await page.evaluate(async (withVideo) => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const tracks = [...dest.stream.getAudioTracks()];
      if (withVideo) {
        const c = Object.assign(document.createElement("canvas"), { width: 320, height: 180 });
        const g = c.getContext("2d");
        let f = 0;
        const iv = setInterval(() => {
          g.fillStyle = `hsl(${(f += 10) % 360} 70% 50%)`;
          g.fillRect(0, 0, 320, 180);
        }, 33);
        tracks.push(...c.captureStream(30).getVideoTracks());
        setTimeout(() => clearInterval(iv), 3000);
      }
      const mime = withVideo ? "video/webm;codecs=vp8,opus" : "audio/mp4;codecs=mp4a.40.2";
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      await new Promise((r) => setTimeout(r, 2000));
      rec.stop();
      await done;
      // Deliberately a "video" MIME type for the audio-only case to exercise the switch.
      const file = new File(chunks, withVideo ? "clip.webm" : "audio-only.mp4", {
        type: withVideo ? "video/webm" : "video/mp4",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('[data-testid="file-input"]');
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 15000;
      for (;;) {
        const m = document.querySelector('[data-testid="media"]');
        if (m && m.readyState >= 1) return { tag: m.tagName, w: m.videoWidth ?? 0 };
        if (Date.now() > deadline) return { tag: "timeout" };
        await new Promise((r) => setTimeout(r, 100));
      }
    }, withVideo);
    // The audio-only file starts as <video> and must be swapped to <audio>.
    if (!withVideo)
      await page.waitForSelector("audio[data-testid=media]", { timeout: 5000 }).catch(() => null);
    const finalTag = await media().evaluate((m) => m.tagName);
    if (withVideo)
      check(
        "video file renders <video> with picture",
        tag.tag === "VIDEO" && tag.w > 0,
        JSON.stringify(tag),
      );
    else
      check("audio-only .mp4 labelled video/* switches to <audio>", finalTag === "AUDIO", finalTag);
  }

  check("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  else server.kill();
}

console.table(results);
console.log(`screenshot: ${join(tmpdir(), "lna-player.png")}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
