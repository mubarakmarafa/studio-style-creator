import { useState, type SyntheticEvent } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { proxyStyleFromImage } from "@/openaiProxyClient";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "w-4 h-4 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      {/* Simplified: left=input, right=output */}
      <Handle id="in" type="target" position={Position.Left} className={common} />
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Common case: model returns raw JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  // Strip code fences if present
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // ignore
  }
  // Best-effort: take substring between first { and last }
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

function StyleDescriptionAutofillInline({ styleNodeId }: { styleNodeId: string }) {
  const rf = useReactFlow();
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const [autofilling, setAutofilling] = useState(false);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">Autofill</div>
      <button
        className="nodrag w-full px-3 py-2 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={autofilling}
        onClick={async (e) => {
          e.stopPropagation();

          const styleNode = nodes.find((n) => n.id === styleNodeId);
          if (!styleNode || styleNode.type !== "styleDescription") {
            alert("Select a Style Description node to autofill.");
            return;
          }

          // Find a connected image node (we accept either direction so UX is forgiving).
          const incoming = edges.filter((ed) => ed.target === styleNodeId);
          const outgoing = edges.filter((ed) => ed.source === styleNodeId);

          const candidateNodes: Array<(typeof nodes)[number] | undefined> = [
            ...incoming.map((ed) => nodes.find((n) => n.id === ed.source)),
            ...outgoing.map((ed) => nodes.find((n) => n.id === ed.target)),
          ];

          const imageNode =
            candidateNodes.find((n) => n?.type === "imageInput" || n?.type === "imageNode") ?? null;

          const imageDataUrl = (imageNode?.data as any)?.image as string | undefined;
          if (!imageNode) {
            alert(
              "No image node connected. Connect an Image Input (Upload) node (or a generated Image node) to this Style Description node.",
            );
            return;
          }
          if (!imageDataUrl || !String(imageDataUrl).trim()) {
            alert(
              "Image node is connected, but no image is uploaded yet. Upload an image in the Image Input node first.",
            );
            return;
          }

          // BFS downstream from the style node (so we can optionally fill connected style blocks).
          const reachable = new Set<string>();
          const queue: string[] = [styleNodeId];
          while (queue.length) {
            const cur = queue.shift()!;
            if (reachable.has(cur)) continue;
            reachable.add(cur);
            edges
              .filter((ed) => ed.source === cur)
              .forEach((ed) => {
                if (!reachable.has(ed.target)) queue.push(ed.target);
              });
          }

          setAutofilling(true);
          try {
            const instruction = [
              "You are a style-extraction assistant for an image-generation 'Style Builder'.",
              "Given the image, output a repeatable style description template that can be reused with different subjects.",
              "The description MUST include a [subject] placeholder (exactly bracketed).",
              "Prefer concrete constraints: renderer/tooling, lighting, materials, camera/perspective, background rules, output format, sticker/die-cut border if present.",
              "",
              "Return ONLY valid JSON (no markdown, no code fences) with this shape:",
              "{",
              '  "description": string,',
              '  "lineQualityType": string | null,',
              '  "colorPaletteRange": string | null,',
              '  "lightingType": string | null,',
              '  "perspective": string | null,',
              '  "fillAndTextureFilledAreas": string | null,',
              '  "backgroundType": string | null,',
              '  "backgroundStyle": string | null,',
              '  "outputFormat": string | null,',
              '  "outputCanvasRatio": string | null',
              "}",
              "",
              "Example of the kind of description to write:",
              "Generate a [subject] as a 3D object rendered in Blender or Octane. The design should feature realistic lighting and dimensional shading, and it must be exported as a transparent alpha PNG (no background, no gradients, no checkerboards). Apply a white die-cut border around the object for a sticker-style appearance. Follow this style:",
            ].join("\n");

            const resp = await proxyStyleFromImage(imageDataUrl, {
              model: "gpt-5.2",
              instruction,
            });

            const parsed = extractJsonObject(resp.text);
            if (!parsed || typeof parsed !== "object") {
              throw new Error("Model did not return valid JSON.");
            }

            const nextDescription = typeof parsed.description === "string" ? parsed.description : "";

            rf.setNodes((nds) =>
              nds.map((n) => {
                if (!reachable.has(n.id)) return n;

                if (n.id === styleNodeId) {
                  return { ...n, data: { ...(n.data as any), description: nextDescription } };
                }

                const d = (n.data ?? {}) as any;
                const shouldFill = (key: string) => {
                  const v = d?.[key];
                  return typeof v !== "string" || v.trim().length === 0;
                };

                switch (n.type) {
                  case "lineQuality":
                    return parsed.lineQualityType && shouldFill("type")
                      ? { ...n, data: { ...(n.data as any), type: parsed.lineQualityType } }
                      : n;
                  case "colorPalette":
                    return parsed.colorPaletteRange && shouldFill("range")
                      ? { ...n, data: { ...(n.data as any), range: parsed.colorPaletteRange } }
                      : n;
                  case "lighting":
                    return parsed.lightingType && shouldFill("type")
                      ? { ...n, data: { ...(n.data as any), type: parsed.lightingType } }
                      : n;
                  case "perspective":
                    return parsed.perspective && shouldFill("perspective")
                      ? { ...n, data: { ...(n.data as any), perspective: parsed.perspective } }
                      : n;
                  case "fillAndTexture":
                    return parsed.fillAndTextureFilledAreas && shouldFill("filled_areas")
                      ? {
                          ...n,
                          data: { ...(n.data as any), filled_areas: parsed.fillAndTextureFilledAreas },
                        }
                      : n;
                  case "background": {
                    const next: any = { ...(n.data as any) };
                    if (parsed.backgroundType && shouldFill("type")) next.type = parsed.backgroundType;
                    if (parsed.backgroundStyle && shouldFill("style")) next.style = parsed.backgroundStyle;
                    return next !== n.data ? { ...n, data: next } : n;
                  }
                  case "output": {
                    const next: any = { ...(n.data as any) };
                    if (parsed.outputFormat && shouldFill("format")) next.format = parsed.outputFormat;
                    if (parsed.outputCanvasRatio && shouldFill("canvas_ratio")) next.canvas_ratio = parsed.outputCanvasRatio;
                    return next !== n.data ? { ...n, data: next } : n;
                  }
                  default:
                    return n;
                }
              }),
            );
          } catch (err) {
            alert(`Autofill failed: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setAutofilling(false);
          }
        }}
      >
        {autofilling ? "Autofilling..." : "Autofill from connected image"}
      </button>
      <div className="text-[11px] text-muted-foreground">
        Connect an <span className="font-medium">Image Input (Upload)</span> node into this node, then click autofill.
      </div>
    </div>
  );
}

export function BaseNode({ id, data, selected, type }: NodeProps) {
  const rf = useReactFlow();
  const d = (data ?? {}) as Record<string, unknown>;
  const label = (d.label as string) || "Node";
  const ui = getNodeUiSize(data);

  const updateNodeData = (updates: Record<string, unknown>) => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n))
    );
  };

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const showInlineFields = type !== "templateRoot";
  return (
    <div
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 220,
        minHeight: 120,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={220} minHeight={120} />

      {/* Name (read-only) */}
      <div className="font-semibold text-sm shrink-0">{label}</div>

      {/* Inline metadata (type-specific keys) */}
      {showInlineFields && (
        <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
          <div className="space-y-1">
            {"subject" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.subject as string) || ""}
                placeholder="Subject"
                onChange={(e) => updateNodeData({ subject: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"description" in d && (
              <div className="space-y-2">
                <textarea
                  className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                  value={(d.description as string) || ""}
                  placeholder="Style description"
                  rows={3}
                  onChange={(e) => updateNodeData({ description: e.target.value })}
                  onMouseDown={stop}
                  onClick={stop}
                />

                {type === "styleDescription" && <StyleDescriptionAutofillInline styleNodeId={id} />}
              </div>
            )}

            {"type" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.type as string) || ""}
                placeholder="Type"
                onChange={(e) => updateNodeData({ type: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"range" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.range as string) || ""}
                placeholder="Range"
                onChange={(e) => updateNodeData({ range: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"perspective" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.perspective as string) || ""}
                placeholder="Perspective"
                onChange={(e) => updateNodeData({ perspective: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"filled_areas" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.filled_areas as string) || ""}
                placeholder="Filled areas"
                onChange={(e) => updateNodeData({ filled_areas: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {"style" in d && (
              <input
                className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                value={(d.style as string) || ""}
                placeholder="Style"
                onChange={(e) => updateNodeData({ style: e.target.value })}
                onMouseDown={stop}
                onClick={stop}
              />
            )}

            {("format" in d || "canvas_ratio" in d) && (
              <div className="grid grid-cols-2 gap-2">
                {"format" in d && (
                  <input
                    className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                    value={(d.format as string) || ""}
                    placeholder="Format"
                    onChange={(e) => updateNodeData({ format: e.target.value })}
                    onMouseDown={stop}
                    onClick={stop}
                  />
                )}
                {"canvas_ratio" in d && (
                  <input
                    className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
                    value={(d.canvas_ratio as string) || ""}
                    placeholder="Canvas ratio"
                    onChange={(e) => updateNodeData({ canvas_ratio: e.target.value })}
                    onMouseDown={stop}
                    onClick={stop}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

