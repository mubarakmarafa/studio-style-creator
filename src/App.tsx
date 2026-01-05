import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./graph/nodeTypes";
import { compileGraph, generateJsonPrompt } from "./graph/compiler";
import type { NodeData, ImageNodeData, FFAStyleTemplate } from "./graph/schema";
import { generateImage } from "./generation/supabaseImageClient";
import { saveHistoryEntry, getHistory, deleteHistoryEntry } from "./history/historyStore";
import type { HistoryEntry } from "./history/historyTypes";
import { ENV_STATE } from "./env";
import { cn } from "./lib/utils";
import { proxyStyleFromImage } from "./openaiProxyClient";
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "./graph/workspacePersistence";

type PanelTab = "inspector" | "generate" | "history";

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("generate");
  const [subject, setSubject] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory());
  const [autofillingNodeId, setAutofillingNodeId] = useState<string | null>(null);
  const lastSavedRef = useRef<string>("");

  // Rehydrate workspace from local storage once on mount.
  useEffect(() => {
    const snap = loadWorkspaceSnapshot();
    if (!snap) return;

    setNodes(snap.nodes);
    setEdges(snap.edges);
    if (typeof snap.subject === "string") setSubject(snap.subject);
    setSelectedNode(null);
  }, [setEdges, setNodes]);

  // Compile graph
  const compileResult = useMemo(() => compileGraph(nodes, edges), [nodes, edges]);

  // Ensure a Template Root node always exists
  useEffect(() => {
    setNodes((nds) => {
      const hasRoot = nds.some((n) => n.type === "templateRoot");

      // If a root already exists, ensure it's hidden/non-interactive.
      if (hasRoot) {
        return nds.map((n) =>
          n.type === "templateRoot"
            ? {
                ...n,
                hidden: true,
                selectable: false,
                draggable: false,
                connectable: true, // still allow programmatic edge creation
              }
            : n
        );
      }

      // Otherwise, create one (hidden).
      return [
        ...nds,
        {
          id: `templateRoot-${Date.now()}`,
          type: "templateRoot",
          position: { x: 40, y: 40 },
          data: { label: "Template Root", category: "Images" } as any,
          hidden: true,
          selectable: false,
          draggable: false,
          connectable: true,
        },
      ];
    });
  }, [setNodes]);

  // Persist workspace locally (debounced) so refreshes don't lose work.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const payload = { nodes, edges, subject };
      const json = JSON.stringify(payload);
      if (json === lastSavedRef.current) return;
      lastSavedRef.current = json;
      saveWorkspaceSnapshot(payload);
    }, 250);

    return () => window.clearTimeout(t);
  }, [nodes, edges, subject]);

  // Handle node selection
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
    setPanelTab("inspector");
  }, []);

  // Handle edge connections
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges]
  );

  // Add node from palette
  const addNode = useCallback(
    (type: string, label: string, defaultData: Partial<NodeData> = {}) => {
      const newId = `${type}-${Date.now()}`;
      const newNode: Node<NodeData> = {
        id: newId,
        type: type as any,
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label, ...defaultData } as NodeData,
      };
      setNodes((nds) => [...nds, newNode]);

      // For non-root nodes, auto-connect from Template Root (keeps compile simple)
      // NOTE: Do NOT auto-connect into pipeline nodes (compiler/generate). They should compile ONLY
      // what the user explicitly wires in, otherwise Template Root becomes a confusing "phantom input".
      if (type !== "templateRoot" && type !== "compiler" && type !== "generate") {
        const root = nodes.find((n) => n.type === "templateRoot");
        if (root) {
          setEdges((eds) => [
            ...eds,
            {
              id: `e-${root.id}-${newId}`,
              source: root.id,
              target: newId,
            },
          ]);
        }
      }
    },
    [setEdges, setNodes, nodes]
  );

  // Update selected node data
  const updateNodeData = useCallback(
    (updates: Partial<NodeData>) => {
      if (!selectedNode) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id ? { ...n, data: { ...n.data, ...updates } as NodeData } : n
        )
      );
      setSelectedNode((prev) =>
        prev ? { ...prev, data: { ...prev.data, ...updates } as NodeData } : null
      );
    },
    [selectedNode, setNodes]
  );

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

  const autofillStyleFromImage = useCallback(
    async (styleNodeId: string) => {
      const styleNode = nodes.find((n) => n.id === styleNodeId);
      if (!styleNode || styleNode.type !== "styleDescription") {
        alert("Select a Style Description node to autofill.");
        return;
      }

      // Find a connected image node (we accept either direction so UX is forgiving).
      const incoming = edges.filter((e) => e.target === styleNodeId);
      const outgoing = edges.filter((e) => e.source === styleNodeId);

      const candidateNodes: Array<Node<NodeData> | undefined> = [
        ...incoming.map((e) => nodes.find((n) => n.id === e.source)),
        ...outgoing.map((e) => nodes.find((n) => n.id === e.target)),
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
        alert("Image node is connected, but no image is uploaded yet. Upload an image in the Image Input node first.");
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
          .filter((e) => e.source === cur)
          .forEach((e) => {
            if (!reachable.has(e.target)) queue.push(e.target);
          });
      }

      setAutofillingNodeId(styleNodeId);
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
          // You can change this to a newer model you have access to.
          model: "gpt-5.2",
          instruction,
        });

        const parsed = extractJsonObject(resp.text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Model did not return valid JSON.");
        }

        const nextDescription = typeof parsed.description === "string" ? parsed.description : "";

        setNodes((nds) =>
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
                if (parsed.outputCanvasRatio && shouldFill("canvas_ratio"))
                  next.canvas_ratio = parsed.outputCanvasRatio;
                return next !== n.data ? { ...n, data: next } : n;
              }
              default:
                return n;
            }
          }),
        );
      } catch (e) {
        alert(`Autofill failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setAutofillingNodeId(null);
      }
    },
    [edges, nodes, setNodes],
  );

  // Generate image
  const handleGenerate = useCallback(async () => {
    if (!compileResult.template) return;
    if (!ENV_STATE.ok) {
      alert("Missing Supabase configuration. Check your .env.local file.");
      return;
    }

    const effectiveSubject =
      subject.trim().length > 0 ? subject.trim() : compileResult.template.object_specification.subject || "";
    if (!effectiveSubject.trim()) return;

    setGenerating(true);
    try {
      const finalPrompt = generateJsonPrompt(compileResult.template, effectiveSubject);
      const result = await generateImage(finalPrompt, {
        model: "gpt-image-1",
        size: compileResult.template.output?.canvas_ratio === "1:1" ? "1024x1024" : "1024x1024",
      });

      const dataUrl = `data:${result.contentType};base64,${result.base64}`;
      setGeneratedImage(dataUrl);

      // Save to history
      const entry = saveHistoryEntry({
        subject: effectiveSubject,
        compiledJson: compileResult.template,
        finalPrompt,
        generationParams: {
          model: "gpt-image-1",
          size: "1024x1024",
        },
        image: dataUrl,
      });
      setHistory((h) => [entry, ...h]);
    } catch (e) {
      alert(`Failed to generate image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [compileResult.template, subject]);

  // Add generated image to canvas
  const addImageToCanvas = useCallback(
    (entry: HistoryEntry) => {
      const imageNode: Node<ImageNodeData> = {
        id: `image-${Date.now()}`,
        type: "imageNode",
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: {
          label: `Image: ${entry.subject}`,
          image: entry.image,
          subject: entry.subject,
          compiledJson: entry.compiledJson,
          generationParams: entry.generationParams,
          timestamp: entry.timestamp,
        },
      };
      setNodes((nds) => [...nds, imageNode]);
    },
    [setNodes]
  );

  // Delete history entry
  const handleDeleteHistory = useCallback((id: string) => {
    deleteHistoryEntry(id);
    setHistory(getHistory());
  }, []);

  if (!ENV_STATE.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
          <h2 className="text-xl font-semibold mb-4">Configuration Required</h2>
          <div className="text-sm text-muted-foreground mb-4">{ENV_STATE.message}</div>
          <div className="text-xs">
            <p>Create <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> in the project root with:</p>
            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
              {`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Style Builder</h1>
        <div className="text-xs text-muted-foreground">
          Build visual style graphs → FFAStyles JSON → Generate images
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Node Palette */}
        <aside className="w-64 border-r p-4 bg-muted/30 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <h2 className="text-sm font-semibold mb-3">Node Palette</h2>
            <div className="space-y-2">
              <button
                onClick={() => addNode("imageInput", "Image Input", { image: "" } as any)}
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Image Input (Upload)
              </button>
              <button
                onClick={() => addNode("subject", "Subject", { subject: "" })}
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Subject
              </button>
              <button
                onClick={() =>
                  addNode("styleDescription", "Style Description", { description: "" } as any)
                }
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Style Description
              </button>
              <button
                onClick={() => addNode("colorPalette", "Color Palette", { range: "" } as any)}
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Color Palette
              </button>
              <div className="pt-2 border-t" />
              <button
                onClick={() => addNode("compiler", "Compiler", { showJson: true } as any)}
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Compiler (JSON)
              </button>
              <button
                onClick={() =>
                  addNode("generate", "Generate", {
                    subjectOverride: "",
                    image: "",
                    model: "gpt-image-1",
                    size: "1024x1024",
                  } as any)
                }
                className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
              >
                Generate (in-node)
              </button>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t space-y-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-3 py-2 text-sm border rounded hover:bg-accent"
              title="Reload the page (your workspace is saved locally)"
            >
              Refresh
            </button>
            <button
              onClick={() => {
                const ok = window.confirm("Clear saved workspace and start fresh?");
                if (!ok) return;
                clearWorkspaceSnapshot();
                setSelectedNode(null);
                setPanelTab("generate");
                setGeneratedImage(null);
                setSubject("");
                setEdges([]);
                setNodes([]);
              }}
              className="w-full px-3 py-2 text-sm border rounded hover:bg-accent text-destructive"
              title="Clear locally saved workspace"
            >
              Reset workspace
            </button>
          </div>
        </aside>

        {/* Center: React Flow Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Right: Panels */}
        <aside className="w-96 border-l flex flex-col bg-muted/30">
          {/* Tabs */}
          <div className="flex border-b">
            <button
              onClick={() => setPanelTab("inspector")}
              className={cn(
                "flex-1 px-4 py-2 text-sm border-b-2 transition-colors",
                panelTab === "inspector"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Inspector
            </button>
            <button
              onClick={() => setPanelTab("generate")}
              className={cn(
                "flex-1 px-4 py-2 text-sm border-b-2 transition-colors",
                panelTab === "generate"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Generate
            </button>
            <button
              onClick={() => setPanelTab("history")}
              className={cn(
                "flex-1 px-4 py-2 text-sm border-b-2 transition-colors",
                panelTab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              History
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {panelTab === "inspector" && (
              <InspectorPanel
                node={selectedNode}
                onUpdate={updateNodeData}
                onAutofillStyleFromImage={autofillStyleFromImage}
                autofilling={autofillingNodeId === selectedNode?.id}
              />
            )}

            {panelTab === "generate" && (
              <GeneratePanel
                compileResult={compileResult}
                subject={subject}
                onSubjectChange={setSubject}
                onGenerate={handleGenerate}
                generating={generating}
                generatedImage={generatedImage}
                onAddToCanvas={() => {
                  if (generatedImage && compileResult.template) {
                    const effectiveSubject =
                      subject.trim().length > 0
                        ? subject.trim()
                        : compileResult.template.object_specification.subject || "";
                    const entry: HistoryEntry = {
                      id: crypto.randomUUID(),
                      timestamp: Date.now(),
                      subject: effectiveSubject,
                      compiledJson: compileResult.template,
                      finalPrompt: generateJsonPrompt(compileResult.template, effectiveSubject),
                      generationParams: { model: "gpt-image-1", size: "1024x1024" },
                      image: generatedImage,
                    };
                    addImageToCanvas(entry);
                  }
                }}
              />
            )}

            {panelTab === "history" && (
              <HistoryPanel
                history={history}
                onAddToCanvas={addImageToCanvas}
                onDelete={handleDeleteHistory}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// Inspector Panel Component
function InspectorPanel({
  node,
  onUpdate,
  onAutofillStyleFromImage,
  autofilling,
}: {
  node: Node<NodeData> | null;
  onUpdate: (updates: Partial<NodeData>) => void;
  onAutofillStyleFromImage: (styleNodeId: string) => void;
  autofilling: boolean;
}) {
  if (!node) {
    return <div className="text-sm text-muted-foreground">Select a node to edit</div>;
  }

  const { type, data } = node;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Node Type</label>
        <div className="text-sm mt-1">{type || "default"}</div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground">Name</label>
        <div className="text-sm mt-1">{data.label || type || "Node"}</div>
      </div>

      {/* Type-specific fields */}
      {type === "templateRoot" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Category</label>
          <select
            value={(data as any).category || "Images"}
            onChange={(e) => onUpdate({ category: e.target.value as any })}
            className="w-full mt-1 px-2 py-1 text-sm border rounded bg-background"
          >
            <option value="Strokes">Strokes</option>
            <option value="Shapes">Shapes</option>
            <option value="Elements / Stickers">Elements / Stickers</option>
            <option value="Images">Images</option>
          </select>
        </div>
      )}

      {type === "subject" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Subject</label>
          <input
            type="text"
            value={(data as any).subject || ""}
            onChange={(e) => onUpdate({ subject: e.target.value })}
            className="w-full mt-1 px-2 py-1 text-sm border rounded bg-background"
            placeholder="e.g., retro robot vacuum"
          />
        </div>
      )}

      {type === "styleDescription" && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Autofill</div>
          <button
            onClick={() => onAutofillStyleFromImage(node.id)}
            disabled={autofilling}
            className="w-full px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {autofilling ? "Autofilling..." : "Autofill from connected image"}
          </button>
          <div className="text-[11px] text-muted-foreground">
            Connect an <span className="font-medium">Image Input (Upload)</span> node into this node, then click autofill.
          </div>
        </div>
      )}

      {type === "output" && (
        <>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Format</label>
            <input
              type="text"
              value={(data as any).format || "PNG"}
              onChange={(e) => onUpdate({ format: e.target.value })}
              className="w-full mt-1 px-2 py-1 text-sm border rounded bg-background"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Canvas Ratio</label>
            <input
              type="text"
              value={(data as any).canvas_ratio || "1:1"}
              onChange={(e) => onUpdate({ canvas_ratio: e.target.value })}
              className="w-full mt-1 px-2 py-1 text-sm border rounded bg-background"
              placeholder="e.g., 1:1, 16:9"
            />
          </div>
        </>
      )}

      {/* Generic JSON editor for other fields */}
      {type !== "templateRoot" && type !== "subject" && type !== "output" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Custom Data</label>
          <textarea
            value={JSON.stringify(data, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onUpdate(parsed);
              } catch {
                // Invalid JSON, ignore
              }
            }}
            className="w-full mt-1 px-2 py-1 text-xs font-mono border rounded bg-background"
            rows={8}
          />
        </div>
      )}
    </div>
  );
}

// Generate Panel Component
function GeneratePanel({
  compileResult,
  subject,
  onSubjectChange,
  onGenerate,
  generating,
  generatedImage,
  onAddToCanvas,
}: {
  compileResult: ReturnType<typeof compileGraph>;
  subject: string;
  onSubjectChange: (s: string) => void;
  onGenerate: () => void;
  generating: boolean;
  generatedImage: string | null;
  onAddToCanvas: () => void;
}) {
  const effectiveSubject =
    subject.trim().length > 0 ? subject.trim() : compileResult.template?.object_specification?.subject || "";
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">
          Subject (optional override)
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="e.g., retro robot vacuum"
          className="w-full px-2 py-1 text-sm border rounded bg-background"
        />
      </div>

      {compileResult.errors.length > 0 && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
          <div className="font-semibold mb-1">Compilation Errors:</div>
          <ul className="list-disc list-inside space-y-1">
            {compileResult.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {compileResult.template && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-muted-foreground">
              Compiled JSON
            </label>
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(compileResult.template, null, 2));
              }}
              className="text-xs text-primary hover:underline"
            >
              Copy
            </button>
          </div>
          <pre className="p-2 text-xs font-mono bg-muted rounded border overflow-auto max-h-64">
            {JSON.stringify(compileResult.template, null, 2)}
          </pre>
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={!compileResult.template || !effectiveSubject.trim() || generating}
        className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? "Generating..." : "Generate Image"}
      </button>

      {generatedImage && (
        <div className="space-y-2">
          <img src={generatedImage} alt="Generated" className="w-full rounded border" />
          <button
            onClick={onAddToCanvas}
            className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90 text-sm"
          >
            Add to Canvas
          </button>
        </div>
      )}
    </div>
  );
}

// History Panel Component
function HistoryPanel({
  history,
  onAddToCanvas,
  onDelete,
}: {
  history: HistoryEntry[];
  onAddToCanvas: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (history.length === 0) {
    return <div className="text-sm text-muted-foreground">No history yet</div>;
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => (
        <div key={entry.id} className="p-3 border rounded space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold">{entry.subject}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(entry.timestamp).toLocaleString()}
              </div>
            </div>
            <button
              onClick={() => onDelete(entry.id)}
              className="text-xs text-destructive hover:underline"
            >
              Delete
            </button>
          </div>
          <img src={entry.image} alt={entry.subject} className="w-full rounded border" />
          <div className="flex gap-2">
            <button
              onClick={() => onAddToCanvas(entry)}
              className="flex-1 px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Add to Canvas
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(entry.compiledJson, null, 2));
              }}
              className="px-3 py-1 text-xs border rounded hover:bg-accent"
            >
              Copy JSON
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
