import { useCallback, useEffect, useMemo, useState } from "react";
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
import { compileGraph, generatePrompt } from "./graph/compiler";
import type { NodeData, ImageNodeData, FFAStyleTemplate } from "./graph/schema";
import { generateImage } from "./generation/supabaseImageClient";
import { saveHistoryEntry, getHistory, deleteHistoryEntry } from "./history/historyStore";
import type { HistoryEntry } from "./history/historyTypes";
import { ENV_STATE } from "./env";
import { cn } from "./lib/utils";

type PanelTab = "inspector" | "generate" | "history";

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("generate");
  const [subject, setSubject] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory());

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
      if (type !== "templateRoot") {
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

  // Generate image
  const handleGenerate = useCallback(async () => {
    if (!compileResult.template || !subject.trim()) return;
    if (!ENV_STATE.ok) {
      alert("Missing Supabase configuration. Check your .env.local file.");
      return;
    }

    setGenerating(true);
    try {
      const finalPrompt = generatePrompt(compileResult.template, subject);
      const result = await generateImage(finalPrompt, {
        model: "gpt-image-1",
        size: compileResult.template.output?.canvas_ratio === "1:1" ? "1024x1024" : "1024x1024",
      });

      const dataUrl = `data:${result.contentType};base64,${result.base64}`;
      setGeneratedImage(dataUrl);

      // Save to history
      const entry = saveHistoryEntry({
        subject,
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
        <aside className="w-64 border-r p-4 overflow-y-auto bg-muted/30">
          <h2 className="text-sm font-semibold mb-3">Node Palette</h2>
          <div className="space-y-2">
            <button
              onClick={() => addNode("subject", "Subject", { subject: "" })}
              className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
            >
              Subject
            </button>
            <button
              onClick={() => addNode("styleDescription", "Style Description", { description: "" } as any)}
              className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
            >
              Style Description
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
                    const entry: HistoryEntry = {
                      id: crypto.randomUUID(),
                      timestamp: Date.now(),
                      subject,
                      compiledJson: compileResult.template,
                      finalPrompt: generatePrompt(compileResult.template, subject),
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
}: {
  node: Node<NodeData> | null;
  onUpdate: (updates: Partial<NodeData>) => void;
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
        <label className="text-xs font-semibold text-muted-foreground">Label</label>
        <input
          type="text"
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="w-full mt-1 px-2 py-1 text-sm border rounded bg-background"
        />
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
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">
          Subject
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
        disabled={!compileResult.template || !subject.trim() || generating}
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
