"use client";
import * as React from "react";

export function useGraphViewport() {
  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState<number>();
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useLayoutEffect(() => {
    const body = content.current;
    if (!body) return;
    const measure = () => setSize({ width: body.scrollWidth, height: body.scrollHeight });
    const observer = new ResizeObserver(measure);
    const observe = () => {
      observer.disconnect();
      observer.observe(body);
      for (const child of body.querySelectorAll("[data-dependency-levels]"))
        observer.observe(child);
      measure();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(body, { childList: true, subtree: true, characterData: true });
    observe();
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
  const fit = () => {
    const frame = scroller.current,
      body = content.current;
    if (!frame || !body) return;
    setZoom(
      Math.max(
        0.005,
        Math.min(
          1,
          (frame.clientWidth - 24) / body.scrollWidth,
          (frame.clientHeight - 24) / body.scrollHeight,
        ),
      ),
    );
    frame.scrollTo({ top: 0, left: 0 });
  };
  return { scroller, content, width, size, zoom, setZoom, fit };
}
