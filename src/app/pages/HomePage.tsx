import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { BrowserSupportBanner } from "@/components/BrowserSupportBanner";
import { DropZone } from "@/components/DropZone";
import { LectureList } from "@/components/LectureList";
import { ModelPicker } from "@/components/ModelPicker";
import { Card } from "@/components/ui";
import { db } from "@/lib/db";
import { detectCapabilities } from "@/lib/env";
import { getNotesModel } from "@/lib/llm-models";
import { formatBytes } from "@/lib/format";
import { estimateStorage, type StorageEstimate } from "@/lib/storage";
import { resolveDevice, resolveModel, useJob } from "../job";
import { navigate } from "../router";
import { updateSettings, useSettings } from "../settings";
import { useDocumentTitle } from "../useDocumentTitle";
import { useGpu } from "../useGpu";

export function HomePage() {
  const [caps] = useState(detectCapabilities);
  const gpu = useGpu();
  const settings = useSettings();
  const { start, busy } = useJob();
  const [error, setError] = useState<string | null>(null);
  const lectures = useLiveQuery(() => db.lectures.orderBy("createdAt").reverse().toArray(), []);
  const storage = useStorageEstimate(lectures?.length);
  useDocumentTitle();

  const device = resolveDevice(gpu?.webgpu ?? false);
  const model = gpu ? resolveModel(settings.model, device, gpu) : settings.model;

  const onFile = (file: File) => {
    setError(null);
    start(file).then(
      (id) => navigate(`/lecture/${id}`),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <>
      <BrowserSupportBanner caps={caps} gpu={gpu} />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Lecture recordings → notes, flashcards, search.
      </h1>
      <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Everything runs on your device. Your audio never leaves the browser.
      </p>

      <div className="mt-8 space-y-5">
        {gpu && (
          <ModelPicker
            value={model}
            onChange={(id) => updateSettings({ model: id })}
            device={device}
            gpu={gpu}
            disabled={busy}
          />
        )}
        <DropZone onFile={onFile} disabled={busy} />
        <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={settings.keepMedia}
            onChange={(e) => updateSettings({ keepMedia: e.target.checked })}
            className="mt-0.5 size-4 accent-indigo-600"
            data-testid="keep-media"
          />
          <span>
            Save the recording for playback later. Uses browser storage roughly the size of the
            file. Transcripts are always saved.
          </span>
        </label>
        {(gpu?.webgpu || settings.notesEngine === "ollama") && (
          <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={settings.autoNotes}
              onChange={(e) => updateSettings({ autoNotes: e.target.checked })}
              className="mt-0.5 size-4 accent-indigo-600"
              data-testid="auto-notes"
            />
            <span>
              Write AI notes and flashcards automatically after transcribing.{" "}
              {settings.notesEngine === "ollama"
                ? `Uses ${settings.ollamaModel} in Ollama.`
                : `The notes model (${formatBytes(getNotesModel(settings.notesModel).sizeMB * 1e6)}) downloads once.`}
            </span>
          </label>
        )}
        {busy && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            A lecture is being transcribed. You can add another when it finishes.
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <section className="mt-12">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Saved lectures</h2>
          {storage && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400" data-testid="storage">
              Site storage: {formatBytes(storage.usage)} of {formatBytes(storage.quota)} (includes
              downloaded models)
            </span>
          )}
        </div>
        {lectures && <LectureList lectures={lectures} />}
      </section>

      <Card className="mt-12">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Browser support</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <Capability
            ok={gpu?.webgpu ?? false}
            label="WebGPU"
            hint={gpu === null ? "checking…" : "fast transcription + AI notes"}
          />
          <Capability
            ok={caps.crossOriginIsolated}
            label="Cross-origin isolated"
            hint="multi-threaded WASM"
          />
          <Capability ok={caps.indexedDB} label="IndexedDB" hint="saved lectures" />
        </ul>
      </Card>
    </>
  );
}

/** Re-estimates whenever the lecture count changes. */
function useStorageEstimate(trigger: unknown): StorageEstimate | null {
  const [est, setEst] = useState<StorageEstimate | null>(null);
  useEffect(() => {
    let alive = true;
    void estimateStorage().then((e) => alive && setEst(e));
    return () => {
      alive = false;
    };
  }, [trigger]);
  return est;
}

function Capability({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <span>
        <span className="font-medium">{label}</span>{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          {ok ? "" : "unavailable · "}
          {hint}
        </span>
      </span>
    </li>
  );
}
