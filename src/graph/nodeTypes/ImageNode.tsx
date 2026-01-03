import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { ImageNodeData } from "../schema";

function NodeHandles() {
  const common = "w-3 h-3 border border-white/80 dark:border-black/40";
  const hidden = "opacity-0";

  return (
    <>
      {/* One visible dot per side (source), with an overlapped hidden target for incoming connections */}
      <Handle id="top" type="source" position={Position.Top} className={common} />
      <Handle id="top-t" type="target" position={Position.Top} className={`${common} ${hidden}`} />

      <Handle id="right" type="source" position={Position.Right} className={common} />
      <Handle id="right-t" type="target" position={Position.Right} className={`${common} ${hidden}`} />

      <Handle id="bottom" type="source" position={Position.Bottom} className={common} />
      <Handle id="bottom-t" type="target" position={Position.Bottom} className={`${common} ${hidden}`} />

      <Handle id="left" type="source" position={Position.Left} className={common} />
      <Handle id="left-t" type="target" position={Position.Left} className={`${common} ${hidden}`} />
    </>
  );
}

export function ImageNode({ data, selected }: NodeProps) {
  const nodeData = (data as unknown as ImageNodeData) ?? ({} as ImageNodeData);
  return (
    <div
      className={cn(
        "px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 min-w-[200px]",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <NodeHandles />
      <div className="font-semibold text-xs mb-2">{nodeData.label || "Generated Image"}</div>
      {nodeData.image && (
        <img
          src={nodeData.image}
          alt={nodeData.subject}
          className="w-full rounded border border-gray-300 dark:border-gray-600 mb-2"
        />
      )}
      <div className="text-xs text-gray-600 dark:text-gray-400">
        <div>Subject: {nodeData.subject}</div>
        <div className="text-[10px] mt-1">
          {nodeData.timestamp ? new Date(nodeData.timestamp).toLocaleString() : ""}
        </div>
      </div>
    </div>
  );
}

