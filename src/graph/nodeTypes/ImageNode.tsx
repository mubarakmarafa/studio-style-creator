import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { ImageNodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "!w-5 !h-5 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      {/* Simplified: left=input, right=output */}
      <Handle id="in" type="target" position={Position.Left} className={common} />
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

export function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = (data as unknown as ImageNodeData) ?? ({} as ImageNodeData);
  const ui = getNodeUiSize(data);
  const isGenerating = nodeData.status === "generating" || !nodeData.image;
  return (
    <div
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 220,
        minHeight: 160,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={220} minHeight={160} />

      <div className="font-semibold text-xs shrink-0">{nodeData.label || "Generated Image"}</div>

      <div className="mt-2 flex-1 min-h-0 overflow-hidden rounded border border-gray-300 dark:border-gray-600 bg-background">
        {isGenerating ? (
          <div className="w-full h-full min-h-40 flex items-center justify-center bg-muted/40">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
              Generating…
            </div>
          </div>
        ) : (
          <img
            src={nodeData.image}
            alt={nodeData.subject}
            className="w-full h-full object-contain"
            style={ui.height ? undefined : { maxHeight: 260 }}
          />
        )}
      </div>

      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 shrink-0">
        <div>Subject: {nodeData.subject}</div>
        <div className="text-[10px] mt-1">
          {nodeData.timestamp ? new Date(nodeData.timestamp).toLocaleString() : ""}
        </div>
      </div>
    </div>
  );
}

