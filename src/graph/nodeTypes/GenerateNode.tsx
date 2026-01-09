import { memo, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream, generateJsonPrompt } from "@/graph/compiler";
import { generateImage } from "@/generation/supabaseImageClient";
import { ENV_STATE } from "@/env";
import type { GenerateNodeData, NodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";
import { useParams } from "react-router-dom";
import { supabase } from "@/supabase";

function normalizeImageSize(size: string): string {
  const allowed = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);
  const s = (size ?? "").trim();
  if (allowed.has(s)) return s;
  return "1024x1024";
}

function NodeHandles() {
  const common =
    "!w-5 !h-5 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      {/* Make direction obvious: inputs come in on the left */}
      <Handle id="in" type="target" position={Position.Left} className={common} />
      {/* Keep an output for future chaining (optional) */}
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

export const GenerateNode = memo(function GenerateNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  // Same reasoning as CompilerNode: derive snapshots so upstream edits always trigger updates.
  const nodesSnapshot = useStore((s) => s.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })));
  const edgesSnapshot = useStore((s) => s.edges.map((e) => ({ source: e.source, target: e.target })));
  const d = (data ?? {}) as GenerateNodeData;
  const label = d.label || "Generate";
  const [generating, setGenerating] = useState(false);
  const abortControllersRef = useRef<AbortController[]>([]);
  const runControlRef = useRef<{ runId: string; stopped: boolean } | null>(null);
  const params = useParams();
  const projectId = (params as any)?.projectId as string | undefined;

  async function uploadGeneratedImage(dataUrl: string, subject: string): Promise<{ publicUrl: string; assetId?: string }> {
    if (!projectId) return { publicUrl: dataUrl };
    // Convert data URL to blob
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "image/png";
    const blob = new Blob([buf], { type: ct });
    const safeSubject = subject.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "subject";
    const path = `${projectId}/generated/${id}/${crypto.randomUUID()}-${safeSubject}.png`;
    const up = await supabase.storage
      .from("style_builder_assets")
      .upload(path, blob, { contentType: blob.type || "image/png", upsert: true });
    if (up.error) throw up.error;
    const publicUrl = supabase.storage.from("style_builder_assets").getPublicUrl(path).data.publicUrl;
    const { data: assetRow, error } = await supabase
      .from("style_builder_assets")
      .insert({
        project_id: projectId,
        kind: "generated",
        storage_bucket: "style_builder_assets",
        storage_path: path,
        public_url: publicUrl,
        node_id: id,
        subject,
      } as any)
      .select("id")
      .single();
    if (error) throw error;

    // Make the most recently generated image the project thumbnail (projects list cards).
    // Non-blocking: if this fails due to RLS or transient issues, generation should still succeed.
    try {
      if (assetRow?.id) {
        const { error: thumbErr } = await supabase
          .from("style_builder_projects")
          .update({ thumbnail_asset_id: assetRow.id } as any)
          .eq("id", projectId);
        if (thumbErr) console.warn("[GenerateNode] failed to set project thumbnail:", thumbErr.message);
      }
    } catch (e) {
      console.warn("[GenerateNode] failed to set project thumbnail:", e);
    }
    return { publicUrl, assetId: assetRow?.id };
  }

  const upstreamCompilerId = useMemo(() => {
    const incoming = edgesSnapshot.filter((e) => e.target === id);
    for (const e of incoming) {
      const src = nodesSnapshot.find((n) => n.id === e.source);
      if (src?.type === "compiler") return src.id;
    }
    return null;
  }, [id, nodesSnapshot, edgesSnapshot]);

  const compileResult = useMemo(() => {
    return compileUpstream(upstreamCompilerId ?? id, nodesSnapshot as any, edgesSnapshot as any);
  }, [id, upstreamCompilerId, nodesSnapshot, edgesSnapshot]);

  const subject = (d.subjectOverride ?? "").trim() || compileResult.template?.object_specification?.subject || "";
  const subjects = useMemo(() => {
    const upstreamSubjects = (compileResult as any).subjects as string[] | undefined;
    if (Array.isArray(upstreamSubjects) && upstreamSubjects.length > 1) return upstreamSubjects;
    return subject.trim() ? [subject.trim()] : [];
  }, [compileResult, subject]);

  const model = (d.model ?? "gpt-image-1").trim() || "gpt-image-1";
  const qualityPreset = (d.qualityPreset ?? "balanced") as "fast" | "balanced" | "high";
  const size = normalizeImageSize((d.size ?? "").trim() || "1024x1024");
  const quality: "low" | "medium" | "high" =
    qualityPreset === "fast" ? "low" : qualityPreset === "high" ? "high" : "medium";
  const concurrency = Math.max(1, Math.min(4, Number.isFinite(d.concurrency as any) ? Number(d.concurrency) : 2));

  const setNodeData = (updates: Partial<GenerateNodeData>) => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)));
  };

  const canGenerate = Boolean(compileResult.template) && subjects.length > 0 && ENV_STATE.ok && !generating;
  const ui = getNodeUiSize(data);
  const updateImageItem = (runId: string, subject: string, patch: Partial<NonNullable<GenerateNodeData["images"]>[number]>) => {
    rf.setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const cur = (n.data ?? {}) as GenerateNodeData;
        if (cur.lastRunId !== runId) return n;
        const curImages = (cur.images ?? []).map((it) => (it.subject === subject ? { ...it, ...patch } : it));
        return { ...n, data: { ...(n.data as any), images: curImages } };
      }),
    );
  };

  return (
    <div
      style={{
        width: ui.width,
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
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={260} minHeight={160} />

      <div className="font-semibold text-sm shrink-0">{label}</div>

      <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
        <input
          className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
          value={d.subjectOverride ?? ""}
          placeholder="Subject override (optional)"
          onChange={(e) => setNodeData({ subjectOverride: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
            value={qualityPreset}
            onChange={(e) => setNodeData({ qualityPreset: e.target.value as any, size: "" })}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            title="Quality preset (maps to output size)"
          >
            <option value="fast">Fast</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
          <select
            className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
            value={String(concurrency)}
            onChange={(e) => setNodeData({ concurrency: Number(e.target.value) })}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            title="How many images to generate in parallel"
          >
            <option value="1">1× parallel</option>
            <option value="2">2× parallel</option>
            <option value="3">3× parallel</option>
            <option value="4">4× parallel</option>
          </select>
        </div>

        {!ENV_STATE.ok && (
          <div className="text-[11px] text-destructive">
            Missing Supabase config. Add <code className="font-mono">.env.local</code> and restart dev server.
          </div>
        )}

        {compileResult.errors.length > 0 && (
          <div className="p-2 rounded border text-[11px] bg-destructive/10 border-destructive/20 text-destructive">
            {compileResult.errors[0]?.message}
          </div>
        )}

        {d.lastError && (
          <div className="p-2 rounded border text-[11px] bg-destructive/10 border-destructive/20 text-destructive">
            {d.lastError}
          </div>
        )}

        <button
          className={cn(
            "nodrag w-full px-3 py-2 text-xs rounded",
            canGenerate
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
          disabled={!canGenerate}
          onClick={async (e) => {
            e.stopPropagation();
            if (!ENV_STATE.ok) {
              setNodeData({ lastError: "Missing Supabase configuration. Check your .env.local file." });
              return;
            }
            if (!compileResult.template) {
              setNodeData({ lastError: "Nothing to compile. Connect nodes into a Compiler node (or into this node)." });
              return;
            }
            if (subjects.length === 0) {
              setNodeData({
                lastError:
                  "Missing subject. Connect a Subject node into the Compiler (or set Subject override here).",
              });
              return;
            }

            setGenerating(true);
            setNodeData({ lastError: "" });
            try {
              const runId = crypto.randomUUID();
              runControlRef.current = { runId, stopped: false };
              setNodeData({
                lastRunId: runId,
                images: subjects.map((s) => ({ subject: s, status: "queued" as const })),
                image: "",
              });

              // Clear any previous controllers.
              abortControllersRef.current.forEach((c) => c.abort());
              abortControllersRef.current = [];

              let nextIndex = 0;
              const worker = async () => {
                while (nextIndex < subjects.length) {
                  const ctl = runControlRef.current;
                  if (!ctl || ctl.runId !== runId || ctl.stopped) break;
                  const i = nextIndex++;
                  const subj = subjects[i]!;

                  updateImageItem(runId, subj, { status: "generating" });

                  const controller = new AbortController();
                  abortControllersRef.current.push(controller);

                  try {
                    const prompt = generateJsonPrompt(compileResult.template!, subj);
                    const result = await generateImage(prompt, { model, size, quality, signal: controller.signal });
                    const dataUrl = `data:${result.contentType};base64,${result.base64}`;
                    let finalUrl = dataUrl;
                    let assetId: string | undefined = undefined;
                    try {
                      const uploaded = await uploadGeneratedImage(dataUrl, subj);
                      finalUrl = uploaded.publicUrl;
                      assetId = uploaded.assetId;
                    } catch (e) {
                      // If upload fails (e.g. storage policy), keep data URL so the user still sees results.
                      console.warn("[GenerateNode] upload failed; using data URL:", e);
                    }
                    // Guard: if a newer run started, don't clobber.
                    rf.setNodes((nds) =>
                      nds.map((n) => {
                        if (n.id !== id) return n;
                        const cur = (n.data ?? {}) as GenerateNodeData;
                        if (cur.lastRunId !== runId) return n;
                        const curImages = (cur.images ?? []).map((it) =>
                          it.subject === subj ? { ...it, status: "ready", image: finalUrl, asset_id: assetId } : it,
                        );
                        return {
                          ...n,
                          data: {
                            ...(n.data as any),
                            images: curImages,
                            lastPrompt: prompt,
                            lastGeneratedAt: Date.now(),
                            model,
                            size,
                            qualityPreset,
                          },
                        };
                      }),
                    );
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const cancelled = msg.toLowerCase().includes("aborted");
                    rf.setNodes((nds) =>
                      nds.map((n) => {
                        if (n.id !== id) return n;
                        const cur = (n.data ?? {}) as GenerateNodeData;
                        if (cur.lastRunId !== runId) return n;
                        const curImages = (cur.images ?? []).map((it) =>
                          it.subject === subj
                            ? { ...it, status: cancelled ? "cancelled" : "error", error: cancelled ? undefined : msg }
                            : it,
                        );
                        return { ...n, data: { ...(n.data as any), images: curImages, lastError: cancelled ? "" : msg } };
                      }),
                    );
                  }
                }
              };

              const pool = Array.from({ length: Math.min(concurrency, subjects.length) }, () => worker());
              await Promise.all(pool);
            } catch (err) {
              setNodeData({ lastError: err instanceof Error ? err.message : String(err) });
            } finally {
              setGenerating(false);
            }
          }}
        >
          {generating ? "Generating..." : "Generate"}
        </button>

        {generating && (
          <button
            className="nodrag w-full px-3 py-2 text-xs rounded border hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              const ctl = runControlRef.current;
              if (ctl) ctl.stopped = true;
              abortControllersRef.current.forEach((c) => c.abort());
              abortControllersRef.current = [];
              rf.setNodes((nds) =>
                nds.map((n) => {
                  if (n.id !== id) return n;
                  const cur = (n.data ?? {}) as GenerateNodeData;
                  const curImages = (cur.images ?? []).map((it) =>
                    it.status === "ready" ? it : { ...it, status: "cancelled" as const },
                  );
                  return { ...n, data: { ...(n.data as any), images: curImages } };
                }),
              );
              setGenerating(false);
            }}
          >
            Stop
          </button>
        )}

        {(generating || (d.images && d.images.length > 0) || d.image) && (
          <div className="space-y-2">
            {d.images && d.images.length > 1 ? (
              <div className="grid grid-cols-2 gap-2">
                {d.images.map((it) => (
                  <div key={it.subject} className="rounded border overflow-hidden bg-background">
                    {it.status !== "ready" ? (
                      <div className="w-full aspect-square flex items-center justify-center bg-muted/40">
                        <div className="text-[11px] text-muted-foreground">
                          {it.status === "queued" ? "Queued…" : it.status === "generating" ? "Generating…" : it.status}
                        </div>
                      </div>
                    ) : (
                      <img src={it.image} alt={it.subject} className="w-full object-cover" />
                    )}
                    <div className="px-2 py-1 text-[11px] border-t truncate" title={it.subject}>
                      {it.subject}
                    </div>
                  </div>
                ))}
              </div>
            ) : d.images && d.images.length === 1 ? (
              <div className="rounded border overflow-hidden bg-background">
                {d.images[0]?.status !== "ready" ? (
                  <div className="w-full aspect-square flex items-center justify-center bg-muted/40">
                    <div className="text-[11px] text-muted-foreground">
                      {d.images[0]?.status === "queued"
                        ? "Queued…"
                        : d.images[0]?.status === "generating"
                          ? "Generating…"
                          : d.images[0]?.status}
                    </div>
                  </div>
                ) : (
                  <img src={d.images[0].image} alt={d.images[0].subject} className="w-full aspect-square object-cover" />
                )}
                <div className="px-2 py-1 text-[11px] border-t truncate" title={d.images[0]?.subject}>
                  {d.images[0]?.subject}
                </div>
              </div>
            ) : (
              <div className="rounded border overflow-hidden bg-background">
                {generating && !d.image ? (
                  <div className="w-full aspect-square flex items-center justify-center bg-muted/40">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                      Generating…
                    </div>
                  </div>
                ) : (
                  <img
                    src={d.image}
                    alt={subject || "Generated"}
                    className="w-full object-contain"
                    style={ui.height ? { maxHeight: "100%" } : { maxHeight: 260 }}
                  />
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="nodrag flex-1 text-[11px] px-2 py-1 border rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeData({ image: "", images: [] });
                }}
              >
                Clear
              </button>
              <button
                className="nodrag flex-1 text-[11px] px-2 py-1 border rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  const firstReady = d.images?.find((it) => it.status === "ready" && it.image)?.image || d.image;
                  if (!firstReady) return;
                  navigator.clipboard.writeText(firstReady);
                }}
              >
                Copy data URL
              </button>
            </div>
          </div>
        )}

        {d.lastPrompt && (
          <details className="text-[11px]">
            <summary className="cursor-pointer select-none text-muted-foreground">Prompt</summary>
            <pre className="mt-2 p-2 text-[11px] font-mono bg-muted rounded border overflow-auto max-h-32 whitespace-pre-wrap">
              {d.lastPrompt}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
});


