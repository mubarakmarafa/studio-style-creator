import { memo, useMemo, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream, generateJsonPrompt } from "@/graph/compiler";
import { proxyRefinePrompt } from "@/openaiProxyClient";
import { ENV_STATE } from "@/env";
import type { NodeData, RefineNodeData, FFAStyleTemplate } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "w-4 h-4 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      <Handle id="in" type="target" position={Position.Left} className={common} />
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

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

function truncateForContext(value: unknown, max = 2000): unknown {
  if (typeof value === "string") {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}\n…(truncated, total ${value.length} chars)`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => truncateForContext(v, max));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "image") continue; // never send full data urls as JSON fields
      out[k] = truncateForContext(v, max);
    }
    return out;
  }
  return value;
}

function getConnectedComponentUndirected(
  startId: string,
  edges: Array<{ source: string; target: string }>,
): Set<string> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }

  const visited = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const next = adj.get(cur);
    if (!next) continue;
    for (const n of next) if (!visited.has(n)) queue.push(n);
  }
  return visited;
}

async function downscaleDataUrl(
  dataUrl: string,
  opts?: { maxDim?: number; mime?: "image/jpeg" | "image/png"; quality?: number },
): Promise<string> {
  const maxDim = opts?.maxDim ?? 768;
  const mime = opts?.mime ?? "image/jpeg";
  const quality = opts?.quality ?? 0.85;

  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;
  await img.decode();

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, tw, th);

  try {
    if (mime === "image/jpeg") return canvas.toDataURL("image/jpeg", quality);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

function mkId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function typePriority(type: string | undefined): number {
  // Keep this consistent with compiler merge priority (lower comes first).
  switch (type) {
    case "templateRoot":
      return 0;
    case "subject":
      return 10;
    case "styleDescription":
      return 20;
    case "lineQuality":
      return 30;
    case "colorPalette":
      return 40;
    case "lighting":
      return 50;
    case "perspective":
      return 60;
    case "fillAndTexture":
      return 70;
    case "background":
      return 80;
    case "output":
      return 90;
    default:
      return 1000;
  }
}

function estimateNodeWidth(type: string | undefined, data: unknown): number {
  const ui = getNodeUiSize(data as any);
  if (typeof ui.width === "number" && ui.width > 0) return ui.width;
  switch (type) {
    case "compiler":
      return 380;
    case "generate":
      return 260;
    case "refine":
      return 320;
    default:
      return 220;
  }
}

export const RefineNode = memo(function RefineNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const nodesSnapshot = useStore((s) =>
    s.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
  );
  const edgesSnapshot = useStore((s) => s.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));

  const d = (data ?? {}) as RefineNodeData;
  const label = d.label || "Refine";
  const [refining, setRefining] = useState(false);
  const ui = getNodeUiSize(data);

  const setNodeData = (updates: Partial<RefineNodeData>) => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)));
  };

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of edgesSnapshot) {
      if (e.source === id) ids.add(e.target);
      if (e.target === id) ids.add(e.source);
    }
    return ids;
  }, [edgesSnapshot, id]);

  const imageCandidates = useMemo(() => {
    return nodesSnapshot
      .map((n) => {
        const image = (n.data as any)?.image as unknown;
        if (typeof image !== "string") return null;
        if (!image.startsWith("data:image/")) return null;
        const label = typeof (n.data as any)?.label === "string" ? String((n.data as any).label) : n.type || n.id;
        return { id: n.id, type: n.type ?? "unknown", label, image };
      })
      .filter(Boolean) as Array<{ id: string; type: string; label: string; image: string }>;
  }, [nodesSnapshot]);

  const autoSourceId = useMemo(() => {
    const connected = imageCandidates.filter((c) => connectedNodeIds.has(c.id));
    return connected.find((c) => c.type === "imageInput")?.id ?? connected[0]?.id ?? imageCandidates[0]?.id ?? "";
  }, [connectedNodeIds, imageCandidates]);

  const autoGeneratedId = useMemo(() => {
    const connected = imageCandidates.filter((c) => connectedNodeIds.has(c.id));
    return (
      connected.find((c) => c.type === "generate")?.id ??
      connected.find((c) => c.type === "imageNode")?.id ??
      connected[0]?.id ??
      imageCandidates[0]?.id ??
      ""
    );
  }, [connectedNodeIds, imageCandidates]);

  const sourceImageNodeId = (d.sourceImageNodeId ?? "").trim() || autoSourceId;
  const generatedImageNodeId = (d.generatedImageNodeId ?? "").trim() || autoGeneratedId;

  const upstreamCompilerId = useMemo(() => {
    const incoming = edgesSnapshot.filter((e) => e.target === id);
    for (const e of incoming) {
      const src = nodesSnapshot.find((n) => n.id === e.source);
      if (src?.type === "compiler") return src.id;
    }
    return null;
  }, [edgesSnapshot, id, nodesSnapshot]);

  const compileTargetId = upstreamCompilerId ?? id;

  const compileResult = useMemo(() => {
    return compileUpstream(compileTargetId, nodesSnapshot as any, edgesSnapshot as any);
  }, [compileTargetId, nodesSnapshot, edgesSnapshot]);

  const subject = (compileResult.template?.object_specification?.subject ?? "").trim();
  const model = (d.model ?? "gpt-5.2").trim() || "gpt-5.2";
  const feedback = (d.feedback ?? "").trim();

  const canRefine =
    Boolean(compileResult.template) && Boolean(feedback) && ENV_STATE.ok && !refining && Boolean(subject);

  const upstreamNodeSummaries = useMemo(() => {
    // Walk backwards from compileTargetId collecting upstream nodes.
    const visited = new Set<string>();
    const queue: string[] = [compileTargetId];
    const upstreamIds: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const e of edgesSnapshot) {
        if (e.target === cur && !visited.has(e.source)) {
          queue.push(e.source);
          if (e.source !== compileTargetId) upstreamIds.push(e.source);
        }
      }
    }
    const uniq = Array.from(new Set(upstreamIds));
    return uniq
      .map((nid) => nodesSnapshot.find((n) => n.id === nid))
      .filter(Boolean)
      .map((n: any) => {
        const label = typeof n?.data?.label === "string" ? n.data.label : n?.type || n?.id;
        return {
          id: n.id,
          type: n.type,
          label,
          data: truncateForContext(n.data),
        };
      });
  }, [compileTargetId, edgesSnapshot, nodesSnapshot]);

  const getImageDataUrlByNodeId = (nodeId: string): string => {
    const n = nodesSnapshot.find((x) => x.id === nodeId);
    const image = (n?.data as any)?.image as unknown;
    return typeof image === "string" ? image : "";
  };

  const spawnOrUpdateBranch = useMemo(() => {
    const refineNode = nodesSnapshot.find((n) => n.id === id);
    const refinePos = refineNode?.position ?? { x: 0, y: 0 };

    const excludedTypes = new Set<string>([
      "templateRoot",
      "compiler",
      "generate",
      "refine",
      "imageInput",
      "imageNode",
    ]);

    const getUpstreamNodesToClone = (): Array<{
      id: string;
      type: string;
      data: any;
      position: { x: number; y: number };
    }> => {
      const visited = new Set<string>();
      const queue: string[] = [compileTargetId];
      const out: Array<{ id: string; type: string; data: any; position: { x: number; y: number } }> = [];

      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const e of edgesSnapshot) {
          if (e.target !== cur) continue;
          const srcId = e.source;
          if (!visited.has(srcId)) queue.push(srcId);

          const n = nodesSnapshot.find((x) => x.id === srcId);
          if (!n) continue;
          const t = n.type ?? "unknown";
          if (excludedTypes.has(t)) continue;
          out.push({
            id: n.id,
            type: t,
            data: n.data as any,
            position: n.position ?? { x: 0, y: 0 },
          });
        }
      }

      // Stable ordering
      const uniqById = new Map<string, (typeof out)[number]>();
      for (const n of out) uniqById.set(n.id, n);
      return Array.from(uniqById.values()).sort((a, b) => a.id.localeCompare(b.id));
    };

    const applyImprovedTemplateToNodeData = (
      nodeType: string,
      baseData: Record<string, unknown>,
      improvedTemplate: FFAStyleTemplate,
      nodeFieldEdits: Record<string, unknown>,
    ): Record<string, unknown> => {
      const next: Record<string, unknown> = { ...baseData };

      // Template-derived updates (best-effort)
      if (nodeType === "subject") {
        const s = improvedTemplate?.object_specification?.subject;
        if (typeof s === "string") next.subject = s;
      }
      if (nodeType === "styleDescription") {
        const desc = improvedTemplate?.drawing_style?.description;
        if (typeof desc === "string") next.description = desc;
      }
      if (nodeType === "lineQuality") {
        const t = improvedTemplate?.drawing_style?.line_quality?.type;
        if (typeof t === "string") next.type = t;
      }
      if (nodeType === "colorPalette") {
        const range = improvedTemplate?.drawing_style?.color_palette?.range;
        const hexes = improvedTemplate?.drawing_style?.color_palette?.hexes;
        if (typeof range === "string") next.range = range;
        if (Array.isArray(hexes)) next.hexes = hexes;
      }
      if (nodeType === "lighting") {
        const t = improvedTemplate?.drawing_style?.lighting?.type;
        if (typeof t === "string") next.type = t;
      }
      if (nodeType === "perspective") {
        const p = improvedTemplate?.drawing_style?.perspective;
        if (typeof p === "string") next.perspective = p;
      }
      if (nodeType === "fillAndTexture") {
        const f = improvedTemplate?.drawing_style?.fill_and_texture?.filled_areas;
        if (typeof f === "string") next.filled_areas = f;
      }
      if (nodeType === "background") {
        const t = improvedTemplate?.drawing_style?.background?.type;
        const s = improvedTemplate?.drawing_style?.background?.style;
        if (typeof t === "string") next.type = t;
        if (typeof s === "string") next.style = s;
      }
      if (nodeType === "output") {
        const format = (improvedTemplate as any)?.output?.format;
        const ratio = (improvedTemplate as any)?.output?.canvas_ratio;
        if (typeof format === "string") next.format = format;
        if (typeof ratio === "string") next.canvas_ratio = ratio;
      }

      // nodeFieldEdits overrides (if present)
      const edits = nodeFieldEdits?.[nodeType] as any;
      if (edits && typeof edits === "object" && !Array.isArray(edits)) {
        Object.assign(next, edits);
      }

      return next;
    };

    return (
      improvedTemplate: FFAStyleTemplate,
      nodeFieldEdits: Record<string, unknown>,
      existingNodeIds?: string[],
    ) => {
      const existing = Array.isArray(existingNodeIds) ? existingNodeIds : [];
      const existingNodes = existing
        .map((nid) => nodesSnapshot.find((n) => n.id === nid))
        .filter(Boolean) as Array<{ id: string; type: string | undefined; data: any }>;

      // If we have an existing branch, update it in-place (non-destructive for upstream).
      if (existingNodes.length > 0) {
        const updatedIds: string[] = [];
        rf.setNodes((nds) =>
          nds.map((n) => {
            if (!existing.includes(n.id)) return n;
            const t = n.type ?? "unknown";
            // Only update style nodes; leave compiler as-is; clear generate image for rerun.
            if (t === "generate") {
              updatedIds.push(n.id);
              return { ...n, data: { ...(n.data as any), image: "", lastError: "", lastGeneratedAt: 0 } };
            }
            if (t === "compiler") {
              updatedIds.push(n.id);
              return n;
            }
            const baseData = (n.data ?? {}) as Record<string, unknown>;
            const nextData = applyImprovedTemplateToNodeData(t, baseData, improvedTemplate, nodeFieldEdits);
            updatedIds.push(n.id);
            return { ...n, data: nextData as any };
          }),
        );

        return { createdNodeIds: existing, createdEdgeIds: d.lastResult?.createdEdgeIds ?? [] };
      }

      const toClone = getUpstreamNodesToClone();
      if (toClone.length === 0) {
        throw new Error("No upstream nodes to clone. Connect style nodes (or a Compiler) into Refine first.");
      }

      // Spawn the branch neatly to the right of the refine node (not preserving old layout),
      // and push further right than the current rightmost node to avoid overlaps.
      const sortedToClone = [...toClone].sort((a, b) => {
        const pa = typePriority(a.type);
        const pb = typePriority(b.type);
        if (pa !== pb) return pa - pb;
        return a.id.localeCompare(b.id);
      });

      const marginX = 180;
      const marginRightOfGraph = 160;
      const baseXFromRefine = refinePos.x + (ui.width ?? 320) + marginX;
      const currentMaxRight = nodesSnapshot.reduce((mx, n) => {
        const w = estimateNodeWidth(n.type, n.data);
        const x = (n.position?.x ?? 0) + w;
        return Math.max(mx, x);
      }, 0);

      const baseX = Math.max(baseXFromRefine, currentMaxRight + marginRightOfGraph);
      const spacingY = 140;
      const baseY = refinePos.y - ((sortedToClone.length - 1) * spacingY) / 2;

      const idMap = new Map<string, string>();
      const newNodes: any[] = [];

      for (const [i, n] of sortedToClone.entries()) {
        const newId = mkId(n.type);
        idMap.set(n.id, newId);
        const baseData = (n.data ?? {}) as Record<string, unknown>;
        const nextData = applyImprovedTemplateToNodeData(n.type, baseData, improvedTemplate, nodeFieldEdits);

        newNodes.push({
          id: newId,
          type: n.type as any,
          position: { x: baseX, y: baseY + i * spacingY },
          data: nextData as any,
        });
      }

      // Place new compiler + generate near the refine node.
      const compilerId = mkId("compiler");
      const generateId = mkId("generate");
      const compilerPos = { x: baseX + 420, y: refinePos.y };
      const generatePos = { x: compilerPos.x + 320, y: compilerPos.y };

      newNodes.push({
        id: compilerId,
        type: "compiler",
        position: compilerPos,
        data: { label: "Compiler", showJson: true } as any,
      });
      newNodes.push({
        id: generateId,
        type: "generate",
        position: generatePos,
        data: {
          label: "Generate",
          subjectOverride: "",
          image: "",
          model: "gpt-image-1",
          size: "1024x1024",
        } as any,
      });

      const newEdges: any[] = [];

      // Wire Refine -> branch so the spawned nodes are connected back to this Refine node.
      // This makes it obvious on-canvas what Refine controls and enables "refine again" to
      // update only the connected branch.
      for (const n of newNodes) {
        if (n.type === "compiler" || n.type === "generate") continue;
        const edgeId = `e-${id}-${n.id}`;
        newEdges.push({ id: edgeId, source: id, target: n.id });
      }

      for (const n of newNodes) {
        if (n.type === "compiler" || n.type === "generate") continue;
        const edgeId = `e-${n.id}-${compilerId}`;
        newEdges.push({ id: edgeId, source: n.id, target: compilerId });
      }
      newEdges.push({ id: `e-${compilerId}-${generateId}`, source: compilerId, target: generateId });

      rf.setNodes((nds) => [...nds, ...newNodes]);
      rf.setEdges((eds) => [...eds, ...newEdges]);

      return {
        createdNodeIds: newNodes.map((n) => n.id),
        createdEdgeIds: newEdges.map((e) => e.id),
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compileTargetId, edgesSnapshot, id, nodesSnapshot, rf, ui.width]);

  return (
    <div
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 300,
        minHeight: 220,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={300} minHeight={220} maxWidth={900} maxHeight={900} />

      <div className="font-semibold text-sm shrink-0">{label}</div>

      <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
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

        <textarea
          className="nodrag w-full text-xs border rounded px-2 py-2 bg-background"
          value={d.feedback ?? ""}
          placeholder="Feedback (what to improve)... e.g. Make it more minimal, keep palette, fix proportions, add die-cut border."
          rows={4}
          onChange={(e) => setNodeData({ feedback: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Source image</div>
            <select
              className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
              value={sourceImageNodeId}
              onChange={(e) => setNodeData({ sourceImageNodeId: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">(auto)</option>
              {imageCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.type})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Generated image</div>
            <select
              className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
              value={generatedImageNodeId}
              onChange={(e) => setNodeData({ generatedImageNodeId: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">(auto)</option>
              {imageCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Model</div>
            <input
              className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
              value={model}
              onChange={(e) => setNodeData({ model: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Subject (compiled)</div>
            <div className="text-xs border rounded px-2 py-1 bg-muted/40 truncate" title={subject}>
              {subject || "(missing)"}
            </div>
          </div>
        </div>

        <button
          className={cn(
            "nodrag w-full px-3 py-2 text-xs rounded",
            canRefine
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
          disabled={!canRefine}
          onClick={async (e) => {
            e.stopPropagation();
            if (!ENV_STATE.ok) {
              setNodeData({ lastError: "Missing Supabase configuration. Check your .env.local file." });
              return;
            }
            if (!compileResult.template) {
              setNodeData({ lastError: "Nothing to compile. Connect nodes (or a Compiler) into this Refine node." });
              return;
            }
            if (!subject.trim()) {
              setNodeData({ lastError: "Missing subject. Add/connect a Subject node (or a Compiler that includes it)." });
              return;
            }
            if (!feedback.trim()) {
              setNodeData({ lastError: "Add feedback before refining." });
              return;
            }

            setRefining(true);
            setNodeData({ lastError: "" });
            try {
              const originalPromptJson = generateJsonPrompt(compileResult.template, subject);

              const srcRaw = sourceImageNodeId ? getImageDataUrlByNodeId(sourceImageNodeId) : "";
              const genRaw = generatedImageNodeId ? getImageDataUrlByNodeId(generatedImageNodeId) : "";

              const [src, gen] = await Promise.all([
                srcRaw ? downscaleDataUrl(srcRaw, { maxDim: 768, mime: "image/jpeg", quality: 0.85 }) : Promise.resolve(""),
                genRaw ? downscaleDataUrl(genRaw, { maxDim: 768, mime: "image/jpeg", quality: 0.85 }) : Promise.resolve(""),
              ]);

              const resp = await proxyRefinePrompt({
                originalPromptJson,
                compiledTemplate: compileResult.template,
                upstreamNodes: upstreamNodeSummaries,
                feedback,
                sourceImageDataUrl: src || undefined,
                generatedImageDataUrl: gen || undefined,
                model,
              });

              const parsed = extractJsonObject(resp.text);
              const improvedTemplate = (parsed as any)?.improvedTemplate as FFAStyleTemplate | undefined;
              if (!improvedTemplate || typeof improvedTemplate !== "object") {
                throw new Error("Model did not return valid JSON with improvedTemplate.");
              }

              const nodeFieldEdits = ((parsed as any)?.nodeFieldEdits ?? {}) as Record<string, unknown>;
              // Only update an existing branch if it's still connected to this Refine node.
              // This matches the user's mental model: "Refine again updates what Refine is connected to."
              const lastCreated = Array.isArray(d.lastResult?.createdNodeIds) ? d.lastResult!.createdNodeIds! : [];
              const connected = getConnectedComponentUndirected(id, edgesSnapshot);
              const connectedLastCreated = lastCreated.filter((nid) => connected.has(nid));
              const spawned = spawnOrUpdateBranch(
                improvedTemplate,
                nodeFieldEdits,
                connectedLastCreated.length > 0 ? connectedLastCreated : undefined,
              );

              setNodeData({
                lastResult: {
                  improvedTemplate,
                  nodeFieldEdits,
                  notes: typeof (parsed as any)?.notes === "string" ? (parsed as any).notes : "",
                  createdNodeIds: spawned.createdNodeIds,
                  createdEdgeIds: spawned.createdEdgeIds,
                },
                lastRefinedAt: Date.now(),
              });
            } catch (err) {
              setNodeData({ lastError: err instanceof Error ? err.message : String(err) });
            } finally {
              setRefining(false);
            }
          }}
        >
          {refining ? "Refining..." : "Refine"}
        </button>

        {d.lastResult && (
          <details className="text-[11px]">
            <summary className="cursor-pointer select-none text-muted-foreground">Refinement result</summary>
            {d.lastResult.notes ? (
              <div className="mt-2 p-2 rounded border bg-muted/40 whitespace-pre-wrap">{d.lastResult.notes}</div>
            ) : null}
            {(d.lastResult.createdNodeIds?.length || 0) > 0 && (
              <div className="mt-2 p-2 rounded border bg-muted/40">
                Created branch:{" "}
                <span className="font-medium">{d.lastResult.createdNodeIds?.length ?? 0}</span> nodes,{" "}
                <span className="font-medium">{d.lastResult.createdEdgeIds?.length ?? 0}</span> edges
              </div>
            )}
            <pre className="mt-2 p-2 text-[11px] font-mono bg-muted rounded border overflow-auto max-h-56 whitespace-pre-wrap break-words">
              {JSON.stringify(d.lastResult.improvedTemplate, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
});


