import { useEffect } from "react";
import { Card } from "@/components/ui";
import { markInterrupted } from "@/lib/db";
import { lectureLockName } from "./job";
import { JobProvider } from "./JobProvider";
import { NotesProvider } from "./NotesProvider";
import { Link } from "./Link";
import { HomePage } from "./pages/HomePage";
import { LecturePage } from "./pages/LecturePage";
import { useRoute } from "./router";

export function App() {
  return (
    <NotesProvider>
      <JobProvider>
        <Shell />
      </JobProvider>
    </NotesProvider>
  );
}

/**
 * Lectures left "processing" by a closed tab or crash become "interrupted".
 * A job in any tab holds (or is requesting) a Web Lock named after its lecture.
 */
async function sweepInterrupted() {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const snapshot = await locks?.query().catch(() => undefined);
  const names = new Set(
    [...(snapshot?.held ?? []), ...(snapshot?.pending ?? [])].map((l) => l.name),
  );
  await markInterrupted((id) => names.has(lectureLockName(id)));
}

function Shell() {
  const route = useRoute();

  useEffect(() => {
    void sweepInterrupted();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="font-semibold tracking-tight">Lecture Notes AI</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {route.name === "home" && <HomePage />}
        {route.name === "lecture" && <LecturePage key={route.id} id={route.id} />}
        {route.name === "not-found" && (
          <Card>
            <p className="font-medium">Page not found.</p>
            <Link
              to="/"
              className="mt-2 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ← Back to all lectures
            </Link>
          </Card>
        )}
      </main>
    </div>
  );
}
