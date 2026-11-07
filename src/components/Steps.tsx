import { ProgressBar } from "./ProgressBar";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepView {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string | undefined;
  /** 0–1, or undefined for indeterminate while active. */
  progress?: number | undefined;
}

export function Steps({ steps }: { steps: StepView[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((s) => (
        <li key={s.id} data-step={s.id} data-status={s.status}>
          <div className="flex items-center gap-3">
            <StatusIcon status={s.status} />
            <span
              className={`font-medium ${s.status === "pending" ? "text-zinc-400 dark:text-zinc-500" : ""}`}
            >
              {s.label}
            </span>
            {s.detail && (
              <span
                className={`ml-auto truncate text-right text-sm tabular-nums ${s.status === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}
              >
                {s.detail}
              </span>
            )}
          </div>
          {s.status === "active" && (
            <div className="mt-2 pl-8">
              <ProgressBar label={s.label} value={s.progress} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "done":
      return (
        <span className={`${base} bg-emerald-500 text-white`} aria-label="Done">
          <svg
            viewBox="0 0 16 16"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "error":
      return (
        <span className={`${base} bg-red-500 text-xs font-bold text-white`} aria-label="Failed">
          !
        </span>
      );
    case "active":
      return (
        <span
          className={`${base} animate-spin border-2 border-indigo-500 border-t-transparent`}
          aria-label="In progress"
        />
      );
    case "pending":
      return (
        <span
          className={`${base} border-2 border-zinc-300 dark:border-zinc-700`}
          aria-label="Pending"
        />
      );
  }
}
