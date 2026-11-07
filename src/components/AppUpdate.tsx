import { useRegisterSW } from "virtual:pwa-register/react";
import { useJob } from "@/app/job";
import { useNotes } from "@/app/notes";
import { Button } from "./ui";

/**
 * Registers the service worker and shows a small toast when the app is ready
 * offline, or when a new version is waiting. Updating is never automatic: a
 * reload would cut off a running transcription.
 */
export function AppUpdate() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const { busy } = useJob();
  const { notesBusy } = useNotes();
  if (!offlineReady && !needRefresh) return null;
  const working = busy || notesBusy;

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
      data-testid="app-update"
    >
      <span className="min-w-0 flex-1">
        {needRefresh
          ? working
            ? "A new version is ready. Reload once the current job finishes."
            : "A new version of the app is ready."
          : "The app is ready to work offline."}
      </span>
      {needRefresh && (
        <Button
          variant="primary"
          disabled={working}
          onClick={() => void updateServiceWorker(true)}
          data-testid="app-update-reload"
        >
          Reload
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          setOfflineReady(false);
          setNeedRefresh(false);
        }}
      >
        {needRefresh ? "Later" : "OK"}
      </Button>
    </div>
  );
}
