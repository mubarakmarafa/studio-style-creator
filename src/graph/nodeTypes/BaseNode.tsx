import type { SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

function NodeHandles() {
  const common = "w-3 h-3 border border-white/80 dark:border-black/40";
  const hidden = "opacity-0";

  return (
    <>
      {/* One visible dot per side (source), with an overlapped hidden target for incoming connections */}
      <Handle id="top" type="source" position={Position.Top} className={common} />
      <Handle id="top-t" type="target" position={Position.Top} className={cn(common, hidden)} />

      <Handle id="right" type="source" position={Position.Right} className={common} />
      <Handle id="right-t" type="target" position={Position.Right} className={cn(common, hidden)} />

      <Handle id="bottom" type="source" position={Position.Bottom} className={common} />
      <Handle id="bottom-t" type="target" position={Position.Bottom} className={cn(common, hidden)} />

      <Handle id="left" type="source" position={Position.Left} className={common} />
      <Handle id="left-t" type="target" position={Position.Left} className={cn(common, hidden)} />
    </>
  );
}

export function BaseNode({ id, data, selected, type }: NodeProps) {
  const rf = useReactFlow();
  const d = (data ?? {}) as Record<string, unknown>;
  const label = (d.label as string) || "Node";

  const updateNodeData = (updates: Record<string, unknown>) => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n))
    );
  };

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const showInlineFields = type !== "templateRoot";
  return (
    <div
      className={cn(
        "px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <NodeHandles />

      <div className="space-y-2">
        {/* Name (read-only) */}
        <div className="font-semibold text-sm">{label}</div>

        {/* Inline metadata (type-specific keys) */}
        {showInlineFields && (
          <div className="space-y-1">
            {"subject" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.subject as string) || ""}
                placeholder="Subject"
                onChange={(e) => updateNodeData({ subject: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"description" in d && (
              <textarea
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.description as string) || ""}
                placeholder="Style description"
                rows={3}
                onChange={(e) => updateNodeData({ description: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"type" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.type as string) || ""}
                placeholder="Type"
                onChange={(e) => updateNodeData({ type: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"range" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.range as string) || ""}
                placeholder="Range"
                onChange={(e) => updateNodeData({ range: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"perspective" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.perspective as string) || ""}
                placeholder="Perspective"
                onChange={(e) => updateNodeData({ perspective: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"filled_areas" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.filled_areas as string) || ""}
                placeholder="Filled areas"
                onChange={(e) => updateNodeData({ filled_areas: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"style" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.style as string) || ""}
                placeholder="Style"
                onChange={(e) => updateNodeData({ style: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {("format" in d || "canvas_ratio" in d) && (
              <div className="grid grid-cols-2 gap-2">
                {"format" in d && (
                  <input
                    className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                    value={(d.format as string) || ""}
                    placeholder="Format"
                    onChange={(e) => updateNodeData({ format: e.target.value })}
                    onMouseDown={stop}
                    onClick={stop}
                  />
                )}
                {"canvas_ratio" in d && (
                  <input
                    className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                    value={(d.canvas_ratio as string) || ""}
                    placeholder="Canvas ratio"
                    onChange={(e) => updateNodeData({ canvas_ratio: e.target.value })}
                    onMouseDown={stop}
                    onClick={stop}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

