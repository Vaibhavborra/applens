import { useSyncExternalStore } from "react";

/**
 * Minimal History-API router: two routes don't justify a dependency.
 * Cloudflare Pages (and Vite's dev/preview servers) serve index.html for
 * unknown paths, so deep links like /lecture/<id> work on reload.
 */
export type Route = { name: "home" } | { name: "lecture"; id: string } | { name: "not-found" };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  const m = /^\/lecture\/([\w-]+)$/.exec(path);
  if (m) return { name: "lecture", id: m[1]! };
  return { name: "not-found" };
}

const NAV_EVENT = "lna:navigate";

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}
