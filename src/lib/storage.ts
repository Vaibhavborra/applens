export interface StorageEstimate {
  usage: number;
  quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota === undefined || e.usage === undefined) return null;
    return { usage: e.usage, quota: e.quota };
  } catch {
    return null;
  }
}

/**
 * Ask the browser not to evict our data under storage pressure. Chrome grants
 * this silently for engaged sites; others may say no. Either way we carry on.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Keep media only if it leaves headroom; IndexedDB writes fail hard at quota. */
export function mediaFits(fileSize: number, est: StorageEstimate | null): boolean {
  if (!est) return true; // unknown: try, the write itself will tell us
  return fileSize < (est.quota - est.usage) * 0.8;
}
