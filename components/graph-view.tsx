"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { GraphCanvas } from "@/components/graph-canvas";
import { ReadableGraph } from "@/components/readable-graph";
import { useGraphPresentation } from "@/hooks/use-graph-prefs";

export function GraphView() {
  const { projectId } = useApp();
  return <GraphWorkspace key={projectId} />;
}

function GraphWorkspace() {
  const { presentation, setPresentation } = useGraphPresentation();
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
        className="flex shrink-0 gap-2 border-b border-border px-4 py-2"
        role="group"
        aria-label="Graph presentation"
      >
        {(["readable", "canvas"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={presentation === mode}
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
            {mode === "readable" ? "Readable view" : "Full graph"}
          </button>
        ))}
      </div>
      {presentation === "canvas" ? (
        <GraphCanvas epicId={epicId} setEpicId={changeEpic} />
      ) : (
        <ReadableGraph
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
