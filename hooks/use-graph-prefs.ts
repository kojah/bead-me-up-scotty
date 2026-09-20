"use client";
import * as React from "react";
import type { GraphDirection } from "@/lib/graph-direction";
import { useMobile } from "./use-mobile";

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

export type GraphPresentation = "readable" | "canvas";
const PRESENTATION_KEY = "bmus.graph.presentation";
let presentationFallback: GraphPresentation | undefined;
function presentationSnapshot(): GraphPresentation {
  if (presentationFallback) return presentationFallback;
  try {
    return localStorage.getItem(PRESENTATION_KEY) === "canvas" ? "canvas" : "readable";
  } catch {
    return "readable";
  }
}

export function useGraphPresentation() {
  const presentation = React.useSyncExternalStore(
    subscribe,
    presentationSnapshot,
    () => "readable" as const,
  );
  const setPresentation = React.useCallback((value: GraphPresentation) => {
    try {
      localStorage.setItem(PRESENTATION_KEY, value);
      presentationFallback = undefined;
    } catch {
      presentationFallback = value;
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { presentation, setPresentation };
}

type DirectionPreference = GraphDirection | "auto";
const DIRECTION_KEY = "bmus.graph.direction";
let directionFallback: DirectionPreference | undefined;
function directionSnapshot(): DirectionPreference {
  if (directionFallback) return directionFallback;
  try {
    const value = localStorage.getItem(DIRECTION_KEY);
    return value === "down" || value === "right" ? value : "auto";
  } catch {
    return "auto";
  }
}
export function useGraphDirection() {
  const mobile = useMobile();
  const preference = React.useSyncExternalStore(
    subscribe,
    directionSnapshot,
    () => "auto" as const,
  );
  const direction: GraphDirection =
    preference === "auto" ? (mobile ? "down" : "right") : preference;
  const setPreference = (value: DirectionPreference) => {
    try {
      localStorage.setItem(DIRECTION_KEY, value);
      directionFallback = undefined;
    } catch {
      directionFallback = value;
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return { direction, preference, setPreference };
}
