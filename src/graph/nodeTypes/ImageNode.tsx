import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { ImageNodeData } from "../schema";

export function ImageNode({ data, selected }: NodeProps) {
  const nodeData = (data as { data: ImageNodeData }).data;
  return (
    <div
      className={cn(
        "px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 min-w-[200px]",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
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
          {new Date(nodeData.timestamp).toLocaleString()}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

