import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Last-resort UI for render crashes; saved lectures in IndexedDB are unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40"
      >
        <p className="font-semibold text-red-800 dark:text-red-200">
          Something went wrong on this page.
        </p>
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">
          Your saved lectures are safe. Reloading usually fixes this.
        </p>
        <pre className="mt-3 overflow-x-auto text-xs whitespace-pre-wrap text-red-700/80 dark:text-red-300/80">
          {this.state.error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            Reload
          </button>
          <a
            href="/"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
          >
            Go to all lectures
          </a>
        </div>
      </div>
    );
  }
}
