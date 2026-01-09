import type { SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { NodeData } from "@/graph/schema";
import { extractPaletteFromDataUrl } from "@/lib/colorPalette";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

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

export function ColorPaletteNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const d = (data ?? {}) as Record<string, unknown>;
  const label = (d.label as string) || "Color Palette";
  const range = (d.range as string) || "";
  const hexes = (d.hexes as string[] | undefined) ?? [];
  const ui = getNodeUiSize(data);

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const updateNodeData = (updates: Record<string, unknown>) => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)),
    );
  };

  const findConnectedImageDataUrl = (): { nodeId: string; image: string } | null => {
    const edges = (rf as any).getEdges?.() as any[] | undefined;
    const nodes = (rf as any).getNodes?.() as any[] | undefined;
    if (!edges || !nodes) return null;

    const incoming = edges.filter((e) => e.target === id);
    const outgoing = edges.filter((e) => e.source === id);
    const candidates: Array<any | undefined> = [
      ...incoming.map((e) => nodes.find((n) => n.id === e.source)),
      ...outgoing.map((e) => nodes.find((n) => n.id === e.target)),
    ];

    const imageNode =
      candidates.find((n) => n?.type === "imageInput" || n?.type === "imageNode") ?? null;
    const imageDataUrl = (imageNode?.data as any)?.image as string | undefined;
    if (!imageNode || !imageDataUrl || !String(imageDataUrl).trim()) return null;

    return { nodeId: imageNode.id as string, image: imageDataUrl };
  };

  const onExtract = async () => {
    const connected = findConnectedImageDataUrl();
    if (!connected) {
      alert(
        "No connected image found. Connect an Image Input (Upload) node (or a generated Image node) to this Color Palette node.",
      );
      return;
    }

    try {
      updateNodeData({ extracting: true });
      const nextHexes = await extractPaletteFromDataUrl(connected.image, { maxColors: 6 });

      const nextRange =
        range.trim().length > 0
          ? range
          : `Use this color palette: ${nextHexes.join(", ")}`;

      updateNodeData({
        hexes: nextHexes,
        range: nextRange,
        extractedAt: Date.now(),
        sourceImageNodeId: connected.nodeId,
        extractionMethod: "image-sampling",
        extracting: false,
      });
    } catch (e) {
      updateNodeData({ extracting: false });
      alert(`Failed to extract palette: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const extracting = Boolean(d.extracting);

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

      <div className="font-semibold text-sm shrink-0">{label}</div>

      <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
        <input
          className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
          value={range}
          placeholder="Range / prompt text (optional)"
          onChange={(e) => updateNodeData({ range: e.target.value })}
          onMouseDown={stop}
          onClick={stop}
        />

        <button
          className="nodrag w-full px-2 py-1 text-xs border rounded hover:bg-accent disabled:opacity-60"
          onMouseDown={stop}
          onClick={(e) => {
            stop(e);
            void onExtract();
          }}
          disabled={extracting}
          title="Extract hex swatches from a connected image (runs locally, no LLM)"
        >
          {extracting ? "Extracting…" : "Extract palette from connected image"}
        </button>

        {hexes.length > 0 ? (
          <div className="grid grid-cols-6 gap-1 pt-1">
            {hexes.map((hex) => (
              <div key={hex} className="flex flex-col items-center gap-1">
                <div
                  className="w-7 h-7 rounded border border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
                <div className="text-[10px] text-muted-foreground select-text">{hex}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Connect an image node, then extract to store a structured palette (hexes) in the compiled JSON.
          </div>
        )}
      </div>
    </div>
  );
}


