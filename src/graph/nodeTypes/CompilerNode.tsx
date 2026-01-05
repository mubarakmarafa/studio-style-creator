import { memo, useMemo } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream } from "@/graph/compiler";
import type { CompilerNodeData, NodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "w-4 h-4 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      {/* Make direction obvious: inputs come in on the left, output goes out on the right */}
      <Handle id="in" type="target" position={Position.Left} className={common} />
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

export const CompilerNode = memo(function CompilerNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  // IMPORTANT: React Flow can mutate arrays in-place; derive a lightweight snapshot so updates
  // always trigger rerenders when upstream node data changes.
  const nodesSnapshot = useStore((s) => s.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })));
  const edgesSnapshot = useStore((s) => s.edges.map((e) => ({ source: e.source, target: e.target })));
  const d = (data ?? {}) as CompilerNodeData;
  const label = d.label || "Compiler";
  const showJson = d.showJson ?? true;

  const incomingSources = useMemo(
    () => edgesSnapshot.filter((e) => e.target === id).map((e) => e.source),
    [edgesSnapshot, id],
  );

  const incomingSummary = useMemo(() => {
    const items = incomingSources
      .map((sid) => nodesSnapshot.find((n) => n.id === sid))
      .filter(Boolean)
      .map((n: any) => {
        const name = typeof n?.data?.label === "string" ? n.data.label : n?.type || "node";
        return `${name} (${n?.type || "unknown"})`;
      });
    return items;
  }, [incomingSources, nodesSnapshot]);

  const { template, errors } = useMemo(() => {
    return compileUpstream(id, nodesSnapshot as any, edgesSnapshot as any);
  }, [id, nodesSnapshot, edgesSnapshot]);

  const json = useMemo(() => (template ? JSON.stringify(template, null, 2) : ""), [template]);

  const hasIncoming = useMemo(
    () => edgesSnapshot.some((e) => e.target === id),
    [edgesSnapshot, id],
  );
  const ui = getNodeUiSize(data);

  return (
    <div
      style={{
        width: ui.width ?? 380,
        height: ui.height,
        minWidth: 260,
        minHeight: 160,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={260} minHeight={160} maxWidth={900} maxHeight={900} />

      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="font-semibold text-sm">{label}</div>
        <div className="flex items-center gap-2">
          <button
            className="nodrag text-[11px] px-2 py-1 border rounded hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === id ? { ...n, data: { ...(n.data as any), showJson: !(showJson ?? true) } } : n,
                ),
              );
            }}
          >
            {showJson ? "Hide JSON" : "Show JSON"}
          </button>
          <button
            className="nodrag text-[11px] px-2 py-1 border rounded hover:bg-accent"
            disabled={!template}
            onClick={(e) => {
              e.stopPropagation();
              if (!template) return;
              navigator.clipboard.writeText(JSON.stringify(template, null, 2));
            }}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Inputs: <span className="font-medium">{incomingSources.length}</span>
        {incomingSummary.length > 0 ? (
          <span className="ml-1">— {incomingSummary.join(", ")}</span>
        ) : null}
      </div>

      {!hasIncoming && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Connect nodes <span className="font-medium">into</span> this node to compile them.
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-2 p-2 rounded border text-[11px] bg-destructive/10 border-destructive/20 text-destructive">
          <div className="font-semibold mb-1">Inputs</div>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {showJson && (
        <pre className="mt-2 p-2 text-[11px] font-mono bg-muted rounded border overflow-auto flex-1 min-h-0 whitespace-pre-wrap break-words">
          {json}
        </pre>
      )}
    </div>
  );
});


