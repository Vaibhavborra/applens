// End-to-end check for Phase 2 (decode) in the locally installed Google Chrome.
// Usage: npm run e2e            (production build via `vite preview`)
//        node scripts/e2e-decode.mjs --dev   (against the Vite dev server)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 4174;
const URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(join(tmpdir(), "lna-e2e-"));

// ---------- fixtures ----------
function sine(i, rate, freq) {
  return Math.sin((2 * Math.PI * freq * i) / rate) * 0.5;
}
function writeWav(path, seconds, rate, channels) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * channels * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * channels * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * channels * 2, 40);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < channels; c++)
      buf.writeInt16LE(
        Math.round(sine(i, rate, 220 * (c + 1)) * 32767),
        44 + (i * channels + c) * 2,
      );
  writeFileSync(path, buf);
}
function writeAu(path, seconds, rate) {
  // Sun/NeXT .au: 16-bit big-endian PCM. ffmpeg reads it; Chrome's decoder doesn't.
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(24 + n * 2);
  buf.write(".snd", 0);
  buf.writeUInt32BE(24, 4);
  buf.writeUInt32BE(n * 2, 8);
  buf.writeUInt32BE(3, 12);
  buf.writeUInt32BE(rate, 16);
  buf.writeUInt32BE(1, 20);
  for (let i = 0; i < n; i++) buf.writeInt16BE(Math.round(sine(i, rate, 330) * 32767), 24 + i * 2);
  writeFileSync(path, buf);
}

const stereoWav = join(dir, "stereo-44k.wav");
writeWav(stereoWav, 3, 44100, 2);
const au = join(dir, "tone.au");
writeAu(au, 2, 22050);
const garbage = join(dir, "not-media.mp3");
writeFileSync(garbage, Buffer.from("definitely not audio ".repeat(500)));
const systemWav = "C:/Windows/Media/Alarm01.wav";

// ---------- server ----------
const DEV = process.argv.includes("--dev");
const server = spawn(`npx vite ${DEV ? "" : "preview "}--port ${PORT} --strictPort`, {
  shell: true,
  stdio: "pipe",
});
let exited = false;
server.on("exit", () => (exited = true));
for (let i = 0; i < 60; i++) {
  if (exited) throw new Error(`Server failed to start (is port ${PORT} in use?)`);
  try {
    if ((await fetch(URL_)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let failed = false;

async function run(name, expect, load) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL_);
  const t0 = Date.now();
  await load(page);
  const el = await page.waitForSelector(
    '[data-testid="decode-result"], [data-testid="decode-error"]',
    {
      timeout: 180_000,
      state: "attached",
    },
  );
  const testid = await el.getAttribute("data-testid");
  const got =
    testid === "decode-result"
      ? {
          ok: true,
          method: await el.getAttribute("data-method"),
          duration: Number(await el.getAttribute("data-duration")),
        }
      : { ok: false, message: await page.locator("main").innerText() };
  const pass = expect(got) && errors.length === 0;
  failed ||= !pass;
  results.push({ name, pass, ms: Date.now() - t0, ...got, errors });
  if (name === "stereo wav (native)")
    await page.screenshot({ path: join(dir, "decoded.png"), fullPage: true });
  await page.close();
}

const near = (a, b) => Math.abs(a - b) < 0.05;
const setFile = (path) => (page) => page.getByTestId("file-input").setInputFiles(path);

if (existsSync(systemWav))
  await run(
    "Windows system wav",
    (r) => r.ok && r.method === "native" && r.duration > 0,
    setFile(systemWav),
  );
await run(
  "stereo wav (native)",
  (r) => r.ok && r.method === "native" && near(r.duration, 3),
  setFile(stereoWav),
);
await run(
  "aac mp4 recorded in Chrome",
  (r) => r.ok && r.method === "native" && r.duration > 1.5,
  async (page) => {
    await page.evaluate(async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const mime = "audio/mp4;codecs=mp4a.40.2";
      if (!MediaRecorder.isTypeSupported(mime)) throw new Error("mp4 MediaRecorder unsupported");
      const rec = new MediaRecorder(dest.stream, { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      await new Promise((r) => setTimeout(r, 2000));
      rec.stop();
      await done;
      const file = new File(chunks, "recorded.mp4", { type: "audio/mp4" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('[data-testid="file-input"]');
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  },
);
await run(
  ".au → ffmpeg.wasm fallback",
  (r) => r.ok && r.method === "ffmpeg" && near(r.duration, 2),
  setFile(au),
);
await run(
  "garbage file → error",
  (r) => !r.ok && /Couldn't read/.test(r.message),
  setFile(garbage),
);

await browser.close();
// shell: true means server.pid is the shell; kill the whole tree synchronously.
if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
else server.kill();

console.table(
  results.map(({ errors, message, ...r }) => ({
    ...r,
    note:
      errors[0] ??
      message
        ?.split("\n")
        .find((l) => l.includes("ffmpeg") || l.includes("format") || l.includes("track")) ??
      "",
  })),
);
console.log(`fixtures + screenshot: ${dir}`);
process.exit(failed ? 1 : 0);
