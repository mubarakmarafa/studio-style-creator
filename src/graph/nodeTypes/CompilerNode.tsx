import { memo, useMemo, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream } from "@/graph/compiler";
import type { CompilerNodeData, NodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";
import { Modal } from "@/components/Modal";
import { getHistory } from "@/history/historyStore";
import { supabase } from "@/supabase";

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

  const [saveOpen, setSaveOpen] = useState(false);
  const [styleName, setStyleName] = useState("");
  const [styleDescription, setStyleDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);

  const recentImages = useMemo(() => {
    const h = getHistory();
    return h
      .filter((e) => typeof (e as any).image === "string" && (e as any).image.startsWith("data:image/"))
      .slice(0, 12) as any[];
  }, [saveOpen]);

  async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    return new Blob([buf], { type: ct });
  }

  const handleSaveStyle = async () => {
    if (!template) return;
    const name = styleName.trim();
    const description = styleDescription.trim();
    if (!name || !description) {
      setSaveError("Name and description are required.");
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      // Insert style row first
      const { data: styleRow, error } = await supabase
        .from("sticker_styles")
        .insert({
          name,
          description,
          compiled_template: template,
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      let thumbnail_path: string | null = null;
      let thumbnail_url: string | null = null;

      if (thumbnailDataUrl) {
        const blob = await dataUrlToBlob(thumbnailDataUrl);
        const path = `${styleRow.id}/thumbnail.png`;
        const up = await supabase.storage
          .from("sticker_thumbnails")
          .upload(path, blob, { contentType: blob.type || "image/png", upsert: true });
        if (up.error) throw up.error;
        thumbnail_path = path;
        thumbnail_url = supabase.storage.from("sticker_thumbnails").getPublicUrl(path).data.publicUrl;

        const { error: updErr } = await supabase
          .from("sticker_styles")
          .update({ thumbnail_path, thumbnail_url } as any)
          .eq("id", styleRow.id);
        if (updErr) throw updErr;
      }

      setSaveOpen(false);
      setStyleName("");
      setStyleDescription("");
      setThumbnailDataUrl(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

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
            disabled={!template}
            onClick={(e) => {
              e.stopPropagation();
              if (!template) return;
              setSaveError(null);
              setSaveOpen(true);
            }}
          >
            Save Style
          </button>
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
        <pre
          className="mt-2 p-2 text-[11px] font-mono bg-muted rounded border overflow-auto flex-1 min-h-0 whitespace-pre-wrap break-words"
          onWheelCapture={(e) => {
            // React Flow uses wheel events for pan/zoom (we have panOnScroll enabled).
            // When this node is selected, prefer scrolling the JSON window if it's scrollable.
            if (!selected) return;
            const el = e.currentTarget;
            if (el.scrollHeight <= el.clientHeight) return;
            e.stopPropagation();
          }}
        >
          {json}
        </pre>
      )}

      <Modal
        open={saveOpen}
        title="Save style"
        description="Save this compiled style prompt for use in Pack Creator."
        onClose={() => {
          if (saving) return;
          setSaveOpen(false);
        }}
      >
        <div className="space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Name</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              placeholder="e.g. Glossy toy sticker (soft rim light)"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={styleDescription}
              onChange={(e) => setStyleDescription(e.target.value)}
              rows={3}
              placeholder="What is this style used for? Any constraints (transparent BG, die-cut outline, etc.)"
            />
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium">Optional thumbnail</div>
            {recentImages.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {recentImages.map((h) => {
                  const img = (h as any).image as string;
                  const selected = thumbnailDataUrl === img;
                  return (
                    <button
                      key={(h as any).id}
                      className={cn(
                        "border rounded overflow-hidden hover:opacity-90",
                        selected ? "ring-2 ring-primary" : "",
                      )}
                      onClick={() => setThumbnailDataUrl(img)}
                      type="button"
                    >
                      <img src={img} alt={(h as any).subject ?? "thumb"} className="w-full h-20 object-cover" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No recent generated images found. Generate an image first to pick a thumbnail.
              </div>
            )}
            {thumbnailDataUrl ? (
              <button className="text-xs underline text-muted-foreground w-fit" onClick={() => setThumbnailDataUrl(null)}>
                Clear thumbnail
              </button>
            ) : null}
          </div>

          {saveError ? (
            <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">
              {saveError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              className="px-3 py-2 text-sm border rounded hover:bg-accent"
              disabled={saving}
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              disabled={saving || !template}
              onClick={handleSaveStyle}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
});


