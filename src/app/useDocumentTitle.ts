import { useEffect } from "react";

const APP = "Lecture Notes AI";

/** "Recursion · Lecture Notes AI", or just the app name. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
