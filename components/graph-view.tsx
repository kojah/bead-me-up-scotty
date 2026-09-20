"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { GraphCanvas } from "@/components/graph-canvas";
import { ReadableGraph } from "@/components/readable-graph";
import { useGraphDirection, useGraphPresentation } from "@/hooks/use-graph-prefs";
import { useMobile } from "@/hooks/use-mobile";

export function GraphView() {
  const { projectId } = useApp();
  return <GraphWorkspace key={projectId} />;
}

function GraphWorkspace() {
  const mobile = useMobile();
  const { presentation, setPresentation } = useGraphPresentation();
  const { direction, preference, setPreference } = useGraphDirection(presentation === "readable");
  const [epicId, setEpicId] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const changeEpic = (id: string) => {
    setEpicId(id);
    setExpanded(new Set(id ? [id] : []));
    setFocusId(null);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2"
        role="group"
        aria-label="Graph presentation"
      >
        {(["readable", "canvas"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={presentation === mode}
            aria-label={mode === "readable" ? "Readable view" : "Full graph"}
            onClick={() => setPresentation(mode)}
            className="control-button"
            style={
              presentation === mode
                ? {
                    background: "var(--brand-weak)",
                    color: "var(--brand)",
                    borderColor: "var(--brand)",
                  }
                : undefined
            }
          >
            {mode === "readable" ? (mobile ? "Readable" : "Readable view") : "Full graph"}
          </button>
        ))}
        <select
          aria-label="Graph direction"
          className="control-button w-[104px] min-w-0 max-w-full md:ml-auto md:w-auto"
          title="Auto uses top-to-bottom in Readable view; the desktop canvas keeps left-to-right"
          value={preference}
          onChange={(e) => setPreference(e.target.value as "auto" | "right" | "down")}
        >
          <option value="auto">{mobile ? "Auto" : "Auto direction"}</option>
          <option value="down">{mobile ? "↓ Down" : "↓ Top to bottom"}</option>
          <option value="right">{mobile ? "→ Across" : "→ Left to right"}</option>
        </select>
      </div>
      {presentation === "canvas" ? (
        <GraphCanvas epicId={epicId} setEpicId={changeEpic} direction={direction} />
      ) : (
        <ReadableGraph
          direction={direction}
          epicId={epicId}
          setEpicId={changeEpic}
          expanded={expanded}
          setExpanded={setExpanded}
          focusId={focusId}
          setFocusId={setFocusId}
        />
      )}
    </div>
  );
}
