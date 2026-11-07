// Renders the PWA icons in public/ from the logo, using the installed Chrome.
//   node scripts/make-icons.mjs
import { chromium } from "playwright-core";

const lines = `<path d="M9 10h14M9 16h14M9 22h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
// "any": rounded tile. "maskable": full-bleed, content inside the 80% safe zone.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f46e5"/>${lines}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#4f46e5"/><g transform="translate(16 16) scale(0.7) translate(-16 -16)">${lines}</g></svg>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const [name, svg, size] of [
  ["pwa-192.png", any, 192],
  ["pwa-512.png", any, 512],
  ["pwa-maskable-512.png", maskable, 512],
  ["apple-touch-icon.png", maskable, 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  console.log(name);
}
await browser.close();
