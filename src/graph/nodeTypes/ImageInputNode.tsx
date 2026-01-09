import type { SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { ImageInputNodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";
import { useParams } from "react-router-dom";
import { supabase } from "@/supabase";

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
  const ui = getNodeUiSize(data);
  const params = useParams();
  const projectId = (params as any)?.projectId as string | undefined;

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
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 240,
        minHeight: 160,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={240} minHeight={160} />

      <div className="font-semibold text-xs shrink-0">{nodeData.label || "Image Input"}</div>

      <label
        className="nodrag inline-flex items-center justify-center w-full px-2 py-1 text-xs border rounded bg-background hover:bg-accent cursor-pointer mt-2 shrink-0"
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
            updateNodeData({ uploading: true, upload_error: "" } as any);
            try {
              // Upload to Supabase Storage (preferred for project persistence).
              if (!projectId) {
                // Fallback: keep data URL (legacy behavior) if not in project route.
                const dataUrl = await readFileAsDataUrl(file);
                updateNodeData({
                  image: dataUrl,
                  filename: file.name,
                  mimeType: file.type,
                  timestamp: Date.now(),
                  uploading: false,
                  upload_error: "",
                } as any);
                return;
              }

              const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.png";
              const path = `${projectId}/uploaded/${id}/${crypto.randomUUID()}-${safeName}`;
              const up = await supabase.storage
                .from("style_builder_assets")
                .upload(path, file, { contentType: file.type || "image/png", upsert: true });
              if (up.error) throw up.error;
              const publicUrl = supabase.storage.from("style_builder_assets").getPublicUrl(path).data.publicUrl;

              // Record asset metadata
              const { data: assetRow, error: insErr } = await supabase
                .from("style_builder_assets")
                .insert({
                  project_id: projectId,
                  kind: "uploaded",
                  storage_bucket: "style_builder_assets",
                  storage_path: path,
                  public_url: publicUrl,
                  node_id: id,
                } as any)
                .select("id")
                .single();
              if (insErr) throw insErr;

              updateNodeData({
                image: publicUrl,
                filename: file.name,
                mimeType: file.type,
                timestamp: Date.now(),
                asset_id: assetRow?.id ?? null,
                uploading: false,
                upload_error: "",
              } as any);
            } catch (err) {
              console.warn("[ImageInputNode] upload failed:", err);
              // Fallback to data URL so the user can still proceed.
              const dataUrl = await readFileAsDataUrl(file);
              updateNodeData({
                image: dataUrl,
                filename: file.name,
                mimeType: file.type,
                timestamp: Date.now(),
                uploading: false,
                upload_error: err instanceof Error ? err.message : String(err),
              } as any);
            } finally {
              // Allow re-uploading the same file by resetting the input.
              e.currentTarget.value = "";
            }
          }}
        />
      </label>

      {nodeData.image ? (
        <div className="mt-2 flex-1 min-h-0 overflow-hidden rounded border border-gray-300 dark:border-gray-600 bg-background">
          <img
            src={nodeData.image}
            alt={nodeData.filename || "Uploaded"}
            className="w-full h-full object-contain"
            style={ui.height ? undefined : { maxHeight: 260 }}
          />
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground mt-2">
          Upload an image, then connect this node into <span className="font-medium">Style Description</span>.
        </div>
      )}

      {!!nodeData.filename && (
        <div className="text-[11px] text-muted-foreground mt-2 truncate shrink-0" title={nodeData.filename}>
          {nodeData.filename}
        </div>
      )}
      {(nodeData as any).uploading ? (
        <div className="text-[11px] text-muted-foreground mt-2 shrink-0">Uploading…</div>
      ) : null}
      {(nodeData as any).upload_error ? (
        <div className="text-[11px] text-destructive mt-1 shrink-0 truncate" title={(nodeData as any).upload_error}>
          Upload failed (using local image)
        </div>
      ) : null}
    </div>
  );
}


