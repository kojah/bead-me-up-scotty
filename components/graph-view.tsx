"use client";
import dynamic from "next/dynamic";
import { useApp } from "@/components/app-context";

const FlowGraph = dynamic(() => import("@/components/flow-graph").then((m) => m.FlowGraph), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-[var(--text-3)]">Opening graph…</div>,
});

export function GraphView() {
  const { projectId } = useApp();
  return <FlowGraph key={projectId} />;
}
