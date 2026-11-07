import type { Capabilities } from "@/lib/env";
import type { GpuInfo } from "@/lib/models";

/**
 * Explains up front what won't work in this browser. Shown only when something
 * is missing; the full capability list stays at the bottom of the home page.
 */
export function BrowserSupportBanner({ caps, gpu }: { caps: Capabilities; gpu: GpuInfo | null }) {
  const blocking = typeof Worker === "undefined" || typeof WebAssembly === "undefined";
  const messages: { tone: "red" | "amber"; text: string }[] = [];
  if (blocking) {
    messages.push({
      tone: "red",
      text: "This browser is missing Web Workers or WebAssembly, which this app needs to transcribe. Please use a current version of Chrome, Edge, Firefox or Safari.",
    });
  }
  if (!caps.indexedDB) {
    messages.push({
      tone: "red",
      text: "This browser won't let the app save data (private browsing can do this), so lectures will disappear when you close the tab.",
    });
  }
  if (gpu && !gpu.webgpu) {
    messages.push({
      tone: "amber",
      text: "WebGPU isn't available here, so transcription runs on the CPU (slower) and AI notes are unavailable. Search, the player and exports still work. For the full experience use Chrome or Edge 113+ or Safari 26+.",
    });
  }
  if (messages.length === 0) return null;
  return (
    <div className="mb-6 space-y-2" data-testid="support-banner">
      {messages.map((m) => (
        <p
          key={m.text}
          role={m.tone === "red" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            m.tone === "red"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          {m.text}
        </p>
      ))}
    </div>
  );
}
