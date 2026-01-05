import { memo, useMemo, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { compileUpstream, generateJsonPrompt } from "@/graph/compiler";
import { generateImage } from "@/generation/supabaseImageClient";
import { ENV_STATE } from "@/env";
import type { GenerateNodeData, NodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "w-4 h-4 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

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
  const model = (d.model ?? "gpt-image-1").trim() || "gpt-image-1";
  const size = (d.size ?? "1024x1024").trim() || "1024x1024";

  const setNodeData = (updates: Partial<GenerateNodeData>) => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)));
  };

  const canGenerate = Boolean(compileResult.template) && Boolean(subject.trim()) && ENV_STATE.ok && !generating;
  const ui = getNodeUiSize(data);

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
            if (!subject.trim()) {
              setNodeData({
                lastError:
                  "Missing subject. Connect a Subject node into the Compiler (or set Subject override here).",
              });
              return;
            }

            setGenerating(true);
            setNodeData({ lastError: "" });
            try {
              const prompt = generateJsonPrompt(compileResult.template, subject);
              const result = await generateImage(prompt, { model, size });
              const dataUrl = `data:${result.contentType};base64,${result.base64}`;
              setNodeData({
                image: dataUrl,
                lastPrompt: prompt,
                lastGeneratedAt: Date.now(),
                model,
                size,
              });
            } catch (err) {
              setNodeData({ lastError: err instanceof Error ? err.message : String(err) });
            } finally {
              setGenerating(false);
            }
          }}
        >
          {generating ? "Generating..." : "Generate"}
        </button>

        {d.image && (
          <div className="space-y-2">
            <div className="rounded border overflow-hidden bg-background">
              <img
                src={d.image}
                alt={subject || "Generated"}
                className="w-full object-contain"
                style={ui.height ? { maxHeight: "100%" } : { maxHeight: 260 }}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="nodrag flex-1 text-[11px] px-2 py-1 border rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeData({ image: "" });
                }}
              >
                Clear
              </button>
              <button
                className="nodrag flex-1 text-[11px] px-2 py-1 border rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!d.image) return;
                  navigator.clipboard.writeText(d.image);
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


