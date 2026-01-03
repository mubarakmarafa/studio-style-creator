import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export function BaseNode({ data, selected }: NodeProps) {
  const label = (data as { label?: string })?.label || "Node";
  return (
    <div
      className={cn(
        "px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <div className="font-semibold text-sm">{label}</div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

