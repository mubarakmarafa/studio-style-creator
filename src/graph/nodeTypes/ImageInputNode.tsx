import type { SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { ImageInputNodeData } from "../schema";

function NodeHandles() {
  const common = "w-3 h-3 border border-white/80 dark:border-black/40";
  const hidden = "opacity-0";

  return (
    <>
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export function ImageInputNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const nodeData = (data as unknown as ImageInputNodeData) ?? ({} as ImageInputNodeData);

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const updateNodeData = (updates: Partial<ImageInputNodeData>) => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)),
    );
  };

  return (
    <div
      className={cn(
        "px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 min-w-[220px]",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />

      <div className="font-semibold text-xs mb-2">{nodeData.label || "Image Input"}</div>

      <label
        className="nodrag inline-flex items-center justify-center w-full px-2 py-1 text-xs border rounded bg-background hover:bg-accent cursor-pointer"
        onMouseDown={stop}
        onClick={stop}
      >
        Upload image…
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const dataUrl = await readFileAsDataUrl(file);
            updateNodeData({
              image: dataUrl,
              filename: file.name,
              mimeType: file.type,
              timestamp: Date.now(),
            });
          }}
        />
      </label>

      {nodeData.image ? (
        <img
          src={nodeData.image}
          alt={nodeData.filename || "Uploaded"}
          className="w-full rounded border border-gray-300 dark:border-gray-600 mt-2"
        />
      ) : (
        <div className="text-[11px] text-muted-foreground mt-2">
          Upload an image, then connect this node into <span className="font-medium">Style Description</span>.
        </div>
      )}

      {!!nodeData.filename && (
        <div className="text-[11px] text-muted-foreground mt-2 truncate" title={nodeData.filename}>
          {nodeData.filename}
        </div>
      )}
    </div>
  );
}


