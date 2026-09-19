"use client";
import * as React from "react";

const KEY = "bmus.graph.hideCompleted";
const EVENT = "bmus.graph.changed";
let fallback: boolean | undefined;
function snapshot() {
  try {
    return fallback ?? localStorage.getItem(KEY) !== "false";
  } catch {
    return fallback ?? true;
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
export function useGraphPrefs() {
  const hideCompleted = React.useSyncExternalStore(subscribe, snapshot, () => true);
  const setHideCompleted = React.useCallback((value: boolean) => {
    try {
      localStorage.setItem(KEY, String(value));
      fallback = undefined;
    } catch {
      fallback = value;
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { hideCompleted, setHideCompleted };
}
