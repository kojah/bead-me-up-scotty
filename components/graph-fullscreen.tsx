"use client";
import { Maximize2, Minimize2 } from "lucide-react";
import * as React from "react";

export function useGraphFullscreen() {
  const [fullscreen, setFullscreen] = React.useState(false);
  const graph = React.useRef<HTMLDivElement>(null);
  const fullscreenButton = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    for (
      let node: HTMLElement | null = graph.current;
      node?.parentElement;
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
    }
    document.body.style.overflow = "hidden";
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setFullscreen(false);
      }
    };
    document.addEventListener("keydown", exit);
    return () => {
      document.removeEventListener("keydown", exit);
      document.body.style.overflow = overflow;
      for (const { element, inert } of siblings) element.inert = inert;
      fullscreenButton.current?.focus({ preventScroll: true });
    };
  }, [fullscreen]);
  return { fullscreen, setFullscreen, graph, fullscreenButton };
}

export function GraphFullscreenButton({
  fullscreen,
  setFullscreen,
  fullscreenButton,
}: ReturnType<typeof useGraphFullscreen>) {
  return (
    <button
      ref={fullscreenButton}
      type="button"
      className="control-button"
      aria-pressed={fullscreen}
      aria-label={fullscreen ? "Exit fullscreen graph" : "Fullscreen graph"}
      title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen graph"}
      onClick={() => setFullscreen((current) => !current)}
    >
      {fullscreen ? (
        <Minimize2 size={16} aria-hidden="true" />
      ) : (
        <Maximize2 size={16} aria-hidden="true" />
      )}
      {fullscreen ? "Exit fullscreen" : "Fullscreen"}
    </button>
  );
}
