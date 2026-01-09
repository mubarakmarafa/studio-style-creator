import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream } from "@/graph/compiler";
import type { CompilerNodeData, NodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";
import { Modal } from "@/components/Modal";
import { getHistory } from "@/history/historyStore";
import { supabase } from "@/supabase";
import { proxyChat } from "@/openaiProxyClient";

function NodeHandles() {
  const common =
    "!w-5 !h-5 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const styleNameRef = useRef(styleName);
  const styleDescRef = useRef(styleDescription);

  useEffect(() => {
    styleNameRef.current = styleName;
  }, [styleName]);
  useEffect(() => {
    styleDescRef.current = styleDescription;
  }, [styleDescription]);

  const suggestNameAndDescription = async (opts: { overwrite: boolean }) => {
    if (!template) return;

    // "Fill" mode is safe: only populate empty fields.
    if (!opts.overwrite) {
      const hasName = styleNameRef.current.trim().length > 0;
      const hasDesc = styleDescRef.current.trim().length > 0;
      if (hasName && hasDesc) {
        setSuggestError("Name and description are already filled. Use Regenerate to overwrite.");
        return;
      }
    }

    setSuggestError(null);
    setSuggesting(true);
    try {
      const instruction = [
        "You are helping a user save a reusable style preset for a sticker/content generator.",
        "Given the compiled style template JSON, propose:",
        "- a short, descriptive style name (3–7 words)",
        "- a super short description (1–2 sentences) focusing on constraints and intended look (mention transparent background/die-cut if present).",
        "",
        "Return ONLY valid JSON (no markdown, no code fences) with this exact shape:",
        '{ "name": string, "description": string }',
        "",
        "COMPILED_TEMPLATE_JSON:",
        JSON.stringify(template),
      ].join("\n");

      const resp = await proxyChat(instruction, { model: "gpt-4.1-mini" });
      const parsed = extractJsonObject(resp.text);
      const nextName = typeof parsed?.name === "string" ? parsed.name.trim() : "";
      const nextDesc = typeof parsed?.description === "string" ? parsed.description.trim() : "";

      if (!nextName && !nextDesc) {
        throw new Error("AI did not return a valid {name, description} JSON object.");
      }

      if (opts.overwrite) {
        if (nextName) setStyleName(nextName);
        if (nextDesc) setStyleDescription(nextDesc);
      } else {
        if (nextName) setStyleName((prev) => (prev.trim() ? prev : nextName));
        if (nextDesc) setStyleDescription((prev) => (prev.trim() ? prev : nextDesc));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSuggestError(msg);
      console.warn("[CompilerNode] suggestion failed:", e);
    } finally {
      setSuggesting(false);
    }
  };

  function extractJsonObject(text: string): any | null {
    if (!text) return null;
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore
    }
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(unfenced);
    } catch {
      // ignore
    }
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const slice = unfenced.slice(first, last + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // ignore
      }
    }
    return null;
  }

  const recentImages = useMemo(() => {
    if (!saveOpen) return [] as Array<{ id: string; image: string; label?: string }>;

    const out: Array<{ id: string; image: string; label?: string }> = [];
    const seen = new Set<string>();

    // 1) History (panel-generated, stored in localStorage)
    for (const h of getHistory() as any[]) {
      const img = h?.image;
      if (typeof img !== "string") continue;
      if (!img.trim()) continue;
      if (!(img.startsWith("data:image/") || img.startsWith("http"))) continue;
      if (seen.has(img)) continue;
      seen.add(img);
      out.push({ id: String(h?.id ?? crypto.randomUUID()), image: img, label: h?.subject });
      if (out.length >= 12) return out;
    }

    // 2) GenerateNode outputs + Image nodes on canvas (this fixes the “no recent images found” bug)
    for (const n of nodesSnapshot as any[]) {
      const t = String(n?.type ?? "");
      const d = (n?.data ?? {}) as any;

      const add = (img: any, label?: string) => {
        if (typeof img !== "string") return;
        if (!img.trim()) return;
        if (!(img.startsWith("data:image/") || img.startsWith("http"))) return;
        if (seen.has(img)) return;
        seen.add(img);
        out.push({ id: `${t}:${String(n?.id ?? crypto.randomUUID())}:${out.length}`, image: img, label });
      };

      if (t === "generate") {
        if (Array.isArray(d.images)) {
          for (const it of d.images) {
            add(it?.image, it?.subject);
            if (out.length >= 12) return out;
          }
        }
        add(d.image, d.subjectOverride);
        if (out.length >= 12) return out;
      }

      if (t === "imageNode" || t === "imageInput") {
        add(d.image, d.subject || d.filename);
        if (out.length >= 12) return out;
      }
    }

    return out.slice(0, 12);
  }, [saveOpen, nodesSnapshot]);

  // Note: AI suggestions are manual via "Fill with AI" / "Regenerate" so we don't
  // surprise users or silently fail when proxy config isn't set up yet.

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
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">Name</label>
              <button
                type="button"
                className="text-xs px-2 py-1 border rounded hover:bg-accent disabled:opacity-50"
                disabled={suggesting || !template}
                onClick={() => suggestNameAndDescription({ overwrite: false })}
                title="Fill empty fields with an AI suggestion"
              >
                Fill with AI
              </button>
            </div>
            <input
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              placeholder="e.g. Glossy toy sticker (soft rim light)"
            />
            {suggesting ? (
              <div className="text-[11px] text-muted-foreground">Suggesting name + description…</div>
            ) : null}
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
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted-foreground">AI suggestions are optional—you can edit freely.</div>
              <button
                type="button"
                className="text-xs underline text-muted-foreground disabled:opacity-50"
                disabled={suggesting || !template}
                onClick={async () => {
                  await suggestNameAndDescription({ overwrite: true });
                }}
              >
                Regenerate
              </button>
            </div>
            {suggestError ? (
              <div className="text-[11px] text-destructive">{suggestError}</div>
            ) : null}
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
                      <img
                        src={img}
                        alt={(h as any).label ?? (h as any).subject ?? "thumb"}
                        className="w-full h-20 object-cover"
                      />
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


