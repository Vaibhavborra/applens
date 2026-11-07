const NETWORK_ERROR =
  /failed to fetch|networkerror|network error|load failed|err_internet_disconnected|could not locate file|unable to (get|load|fetch)/i;

/**
 * User-facing message for an error. When the browser is offline and the error
 * looks like a failed download, say so: models download on first use, so a
 * model that was never used can't run offline.
 */
export function errorMessage(
  e: unknown,
  online = typeof navigator === "undefined" || navigator.onLine,
): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!online && NETWORK_ERROR.test(msg)) {
    return "You're offline and this needs a download that hasn't happened yet. Models download the first time they're used, then work offline. Connect to the internet and try again.";
  }
  return msg;
}
