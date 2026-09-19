"use client";
import * as React from "react";

const QUERY = "(max-width: 767px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
/** Matches the shared md layout breakpoint, with a stable server snapshot. */
export function useMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
