import { useEffect, useState } from "react";
import { updateSettings, useSettings } from "@/app/settings";
import { formatBytes } from "@/lib/format";
import {
  listOllamaModels,
  normalizeOllamaUrl,
  OLLAMA_SUGGESTED_MODEL,
  sameOllamaModel,
  type OllamaModel,
} from "@/lib/ollama";
import { Button } from "./ui";

type Status =
  | { url: string; attempt: number; state: "ok"; models: OllamaModel[] }
  | { url: string; attempt: number; state: "error"; error: string };

/** Server URL + model picker for the Ollama notes engine, with a live connection check. */
export function OllamaSettings() {
  const settings = useSettings();
  const url = normalizeOllamaUrl(settings.ollamaUrl);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [draftUrl, setDraftUrl] = useState(settings.ollamaUrl);

  useEffect(() => {
    const ac = new AbortController();
    listOllamaModels(url, { signal: ac.signal }).then(
      (models) => setStatus({ url, attempt, state: "ok", models }),
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setStatus({
          url,
          attempt,
          state: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      },
    );
    return () => ac.abort();
  }, [url, attempt]);

  // A result for an older URL/attempt counts as "checking".
  const current = status && status.url === url && status.attempt === attempt ? status : null;
  const models = current?.state === "ok" ? current.models : [];
  const hasModel = models.some((m) => sameOllamaModel(m.name, settings.ollamaModel));

  return (
    <div className="space-y-3 text-sm" data-testid="ollama-settings">
      <p className="text-zinc-500 dark:text-zinc-400">
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className="text-indigo-600 underline dark:text-indigo-400"
        >
          Ollama
        </a>{" "}
        is a free app that runs language models on your computer (CPU or any GPU). Notes are written
        there; nothing leaves your machine.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Server</span>
          <input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onBlur={() => updateSettings({ ollamaUrl: normalizeOllamaUrl(draftUrl) })}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateSettings({ ollamaUrl: normalizeOllamaUrl(draftUrl) });
            }}
            spellCheck={false}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-xs dark:border-zinc-700"
            data-testid="ollama-url"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Model</span>
          {models.length > 0 ? (
            <select
              value={
                hasModel
                  ? models.find((m) => sameOllamaModel(m.name, settings.ollamaModel))!.name
                  : ""
              }
              onChange={(e) => updateSettings({ ollamaModel: e.target.value })}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              data-testid="ollama-model"
            >
              {!hasModel && (
                <option value="" disabled>
                  {settings.ollamaModel} (not installed)
                </option>
              )}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={settings.ollamaModel}
              onChange={(e) => updateSettings({ ollamaModel: e.target.value })}
              spellCheck={false}
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-xs dark:border-zinc-700"
              data-testid="ollama-model"
            />
          )}
        </label>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="ollama-status"
        aria-live="polite"
      >
        {!current ? (
          <span className="text-zinc-500 dark:text-zinc-400">Checking Ollama…</span>
        ) : current.state === "error" ? (
          <span className="text-amber-700 dark:text-amber-300">{current.error}</span>
        ) : models.length === 0 ? (
          <span className="text-amber-700 dark:text-amber-300">
            Ollama is running but has no models. Install one with{" "}
            <code className="font-mono">ollama pull {OLLAMA_SUGGESTED_MODEL}</code>
          </span>
        ) : hasModel ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            Connected · {models.length} model{models.length === 1 ? "" : "s"} installed
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">
            Pick an installed model, or install the suggested one with{" "}
            <code className="font-mono">ollama pull {OLLAMA_SUGGESTED_MODEL}</code>
          </span>
        )}
        <Button variant="ghost" className="text-xs" onClick={() => setAttempt((a) => a + 1)}>
          Check again
        </Button>
      </div>
    </div>
  );
}
