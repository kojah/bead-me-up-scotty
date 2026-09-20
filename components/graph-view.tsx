"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { ReadableGraph } from "@/components/readable-graph";
import { useGraphDirection } from "@/hooks/use-graph-prefs";
import { useMobile } from "@/hooks/use-mobile";

export function GraphView() {
  const { projectId } = useApp();
  return <GraphWorkspace key={projectId} />;
}

function GraphWorkspace() {
  const mobile = useMobile();
  const { direction, preference, setPreference } = useGraphDirection();
  const [epicId, setEpicId] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const changeEpic = (id: string) => {
    setEpicId(id);
    setExpanded(new Set(id ? [id] : []));
    setFocusId(null);
  };
  return (
    <ReadableGraph
      direction={direction}
      epicId={epicId}
      setEpicId={changeEpic}
      expanded={expanded}
      setExpanded={setExpanded}
      focusId={focusId}
      setFocusId={setFocusId}
      directionControl={
        <select
          aria-label="Graph direction"
          className="control-button min-w-0 max-w-full"
          title="Auto uses top-to-bottom at every screen size"
          value={preference}
          onChange={(e) => setPreference(e.target.value as "auto" | "right" | "down")}
        >
          <option value="auto">{mobile ? "Auto" : "Auto direction"}</option>
          <option value="down">{mobile ? "↓ Down" : "↓ Top to bottom"}</option>
          <option value="right">{mobile ? "→ Across" : "→ Left to right"}</option>
        </select>
      }
    />
  );
}
