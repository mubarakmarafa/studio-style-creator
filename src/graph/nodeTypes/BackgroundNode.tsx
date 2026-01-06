import type { SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { BackgroundNodeData } from "../schema";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

type BackgroundMode = "scene" | "solidColor" | "dieCutStickerOutline" | "transparent";

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

function isMode(v: unknown): v is BackgroundMode {
  return v === "scene" || v === "solidColor" || v === "dieCutStickerOutline" || v === "transparent";
}

export function BackgroundNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const d = (data as unknown as BackgroundNodeData) ?? ({} as BackgroundNodeData);
  const ui = getNodeUiSize(data);

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const updateNodeData = (updates: Partial<BackgroundNodeData>) => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)),
    );
  };

  const label = d.label || "Background";
  const mode: BackgroundMode = isMode(d.type) ? d.type : "scene";

  const color = (typeof (d as any).color === "string" && (d as any).color) || "#ffffff";
  const outlineWidthPxRaw = (d as any).outlineWidthPx;
  const outlineWidthPx =
    typeof outlineWidthPxRaw === "number" && Number.isFinite(outlineWidthPxRaw)
      ? outlineWidthPxRaw
      : 24;

  const setMode = (next: BackgroundMode) => {
    // Keep `type` as the single source of truth so compiler/autofill continues to work.
    if (next === "solidColor") {
      updateNodeData({
        type: next,
        color,
        style: `Solid background color ${color}.`,
      } as any);
      return;
    }
    if (next === "dieCutStickerOutline") {
      updateNodeData({
        type: next,
        outlineWidthPx,
        style: `Transparent background (alpha). Die-cut sticker outline around the subject; outline width ${outlineWidthPx}px.`,
      } as any);
      return;
    }
    if (next === "transparent") {
      updateNodeData({
        type: next,
        // Clear mode-specific fields so switching modes doesn't leave confusing stale values in node data.
        color: undefined,
        outlineWidthPx: undefined,
        style: "Transparent background (alpha). No background elements, no gradients, no checkerboards.",
      } as any);
      return;
    }
    // scene
    updateNodeData({
      type: next,
      // Clear mode-specific fields so node data reflects what this mode actually uses.
      color: undefined,
      outlineWidthPx: undefined,
      style:
        d.style?.trim() ||
        "Create a coherent scene background that complements the subject. Keep the subject clear and centered; avoid clutter.",
    });
  };

  return (
    <div
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 260,
        minHeight: 170,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={260} minHeight={170} />

      <div className="font-semibold text-sm shrink-0">{label}</div>

      <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">Mode</div>
          <select
            className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
            value={mode}
            onChange={(e) => setMode(e.target.value as BackgroundMode)}
            onMouseDown={stop}
            onClick={stop}
          >
            <option value="scene">Allow the LLM to make a scene around the subject</option>
            <option value="solidColor">Solid colour</option>
            <option value="dieCutStickerOutline">Die Cut sticker outline (transparent BG)</option>
            <option value="transparent">Transparent BG</option>
          </select>
        </div>

        {mode === "solidColor" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="nodrag h-9 w-12 border rounded bg-background p-1"
                value={color}
                onChange={(e) => {
                  const next = e.target.value;
                  updateNodeData({ color: next, style: `Solid background color ${next}.` } as any);
                }}
                onMouseDown={stop}
                onClick={stop}
                title="Background color"
              />
              <input
                className="nodrag flex-1 text-xs border rounded px-2 py-1 bg-background font-mono"
                value={color}
                onChange={(e) => {
                  const next = e.target.value;
                  updateNodeData({ color: next, style: `Solid background color ${next}.` } as any);
                }}
                onMouseDown={stop}
                onClick={stop}
                placeholder="#ffffff"
              />
            </div>
            <div className="text-[11px] text-muted-foreground">
              This writes <span className="font-medium">drawing_style.background.color</span> into the compiled JSON.
            </div>
          </div>
        )}

        {mode === "dieCutStickerOutline" && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Outline width (px)</div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={2}
                max={80}
                step={1}
                className="nodrag flex-1"
                value={outlineWidthPx}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  updateNodeData({
                    outlineWidthPx: next,
                    style: `Transparent background (alpha). Die-cut sticker outline around the subject; outline width ${next}px.`,
                  } as any);
                }}
                onMouseDown={stop}
                onClick={stop}
              />
              <input
                type="number"
                min={0}
                max={200}
                step={1}
                className="nodrag w-20 text-xs border rounded px-2 py-1 bg-background"
                value={outlineWidthPx}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  updateNodeData({
                    outlineWidthPx: next,
                    style: `Transparent background (alpha). Die-cut sticker outline around the subject; outline width ${next}px.`,
                  } as any);
                }}
                onMouseDown={stop}
                onClick={stop}
              />
            </div>
            <div className="text-[11px] text-muted-foreground">
              Background stays transparent; ensure your <span className="font-medium">Output</span> format is PNG if you
              want alpha preserved.
            </div>
          </div>
        )}

        {mode === "scene" && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">Scene guidance (optional)</div>
            <textarea
              className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
              value={d.style ?? ""}
              placeholder="e.g., cozy studio interior, soft bokeh, shallow depth of field…"
              rows={3}
              onChange={(e) => updateNodeData({ style: e.target.value })}
              onMouseDown={stop}
              onClick={stop}
            />
          </div>
        )}

        {mode === "transparent" && (
          <div className="text-[11px] text-muted-foreground">
            Generates with a fully transparent background (as a prompt constraint). For best results, pair with an Output
            node set to PNG.
          </div>
        )}
      </div>
    </div>
  );
}


