import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
  type ReactFlowInstance,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "@/graph/nodeTypes";
import { compileGraph, generateJsonPrompt } from "@/graph/compiler";
import type { NodeData, ImageNodeData, FFAStyleTemplate } from "@/graph/schema";
import { generateImage } from "@/generation/supabaseImageClient";
import { saveHistoryEntry, getHistory, deleteHistoryEntry } from "@/history/historyStore";
import type { HistoryEntry } from "@/history/historyTypes";
import { ENV_STATE } from "@/env";
import { cn } from "@/lib/utils";
import { proxyStyleFromImage } from "@/openaiProxyClient";
import { parseSubjectsCsv, parseSubjectsText } from "@/graph/subjects";
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "@/graph/workspacePersistence";

type PanelTab = "inspector" | "generate" | "history";

export default function StyleBuilderApp() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("generate");
  const [subject, setSubject] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<
    Array<{
      subject: string;
      image?: string;
      status: "queued" | "generating" | "ready" | "error" | "cancelled";
      error?: string;
    }>
  >([]);
  const abortRef = useRef<AbortController[]>([]);
  const runRef = useRef<{ runId: string; stopped: boolean } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory());
  const [autofillingNodeId, setAutofillingNodeId] = useState<string | null>(null);
  const [zenMode, setZenMode] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const lastSavedRef = useRef<string>("");
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);
  const spawnIndexRef = useRef(0);

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
            : n,
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
    [setEdges],
  );

  const getViewportCenterFlowPosition = useCallback(() => {
    const rf = reactFlowInstanceRef.current;
    const el = reactFlowWrapperRef.current;
    if (!rf || !el) return { x: 40, y: 40 };

    const rect = el.getBoundingClientRect();
    const clientPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const base = rf.screenToFlowPosition(clientPoint);

    // Offset each spawn slightly so new nodes don't stack perfectly on top of each other.
    const i = spawnIndexRef.current++;
    const step = 18;
    const dx = (i % 6) * step;
    const dy = (Math.floor(i / 6) % 6) * step;
    return { x: base.x + dx, y: base.y + dy };
  }, []);

  // Add node from palette
  const addNode = useCallback(
    (type: string, label: string, defaultData: Partial<NodeData> = {}) => {
      const newId = `${type}-${Date.now()}`;
      const position = getViewportCenterFlowPosition();
      const newNode: Node<NodeData> = {
        id: newId,
        type: type as any,
        position,
        data: { label, ...defaultData } as NodeData,
        selected: true,
      };
      // Ensure the new node is selected and, by being appended last, renders on top.
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode]);
      setSelectedNode(newNode);
      setPanelTab("inspector");

      // For non-root nodes, auto-connect from Template Root (keeps compile simple)
      // NOTE: Do NOT auto-connect into pipeline nodes (compiler/generate). They should compile ONLY
      // what the user explicitly wires in, otherwise Template Root becomes a confusing "phantom input".
      if (type !== "templateRoot" && type !== "compiler" && type !== "generate" && type !== "refine") {
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
    [getViewportCenterFlowPosition, setEdges, setNodes, nodes],
  );

  // Cmd+. zen mode toggle (hide UI chrome around canvas)
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        Boolean((el as any).isContentEditable)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Similar to Figma: ⌘. toggles chrome
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        setZenMode((z) => !z);
      }
    };

    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("keydown", onKeyDown, opts);
    return () => window.removeEventListener("keydown", onKeyDown, opts);
  }, []);

  // Update selected node data
  const updateNodeData = useCallback(
    (updates: Partial<NodeData>) => {
      if (!selectedNode) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNode.id ? { ...n, data: { ...n.data, ...updates } as NodeData } : n,
        ),
      );
      setSelectedNode((prev) =>
        prev ? { ...prev, data: { ...prev.data, ...updates } as NodeData } : null,
      );
    },
    [selectedNode, setNodes],
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
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
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
          .filter((e) => e.source === cur)
          .forEach((e) => {
            if (!reachable.has(e.target)) queue.push(e.target);
          });
      }

      setAutofillingNodeId(styleNodeId);
      try {
        const instruction = [
          "You are a style-extraction assistant for an image-generation 'Style Builder'.",
          "Act like a thoughtful art critic: assess the image's visual language and artistic principles, not just a literal inventory of objects.",
          "",
          "Goal: produce a repeatable style template that can be reused with different subjects.",
          "The description MUST include a [subject] placeholder (exactly bracketed).",
          "",
          "CRITICAL: Keep the description SUBJECT-AGNOSTIC.",
          "- Do NOT mention what is depicted in the source image (no specific objects/people/animals/clothing).",
          "- Do NOT use anatomy-specific terms (e.g., head, face, eyes, hair) or item-specific terms (e.g., glasses) unless they are universally applicable to any [subject].",
          "- Express composition/framing generically using [subject] only (e.g., 'tight crop where [subject] dominates the frame').",
          "",
          "When writing the description, prioritize *artistic qualities* (some may be subjective):",
          "- composition principles (focal point hierarchy, balance/symmetry/asymmetry, rhythm/repetition, negative space, framing/cropping, depth cues)",
          "- mood/affect/atmosphere (tension vs calm, whimsical vs serious, etc.)",
          "- stylistic influences (movement/era references if plausible; hedge if unsure: 'evokes', 'reminiscent of')",
          "- color strategy (harmony/contrast, palette temperature, saturation, accent colors, gradients vs flats)",
          "- mark-making/line character (gesture, line weight, edge softness, contour vs sketch)",
          "- surface/texture/material feel (grain, paper texture, paint, plastic, metal, fabric, etc.)",
          "- lighting intent (dramatic vs diffuse, rim light, bounce, shadow hardness, specular behavior)",
          "- camera/perspective choices (lens feel, angle, isometric/orthographic cues)",
          "",
          "Also include concrete constraints when present:",
          "- renderer/tooling or medium (3D render, vector, watercolor, ink, collage, etc.)",
          "- background rules",
          "- output format (e.g., transparent alpha PNG) and sticker/die-cut border if present",
          "",
          "Avoid: brand names/logos, artist-name imitation, and overly literal scene narration.",
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
          "Generate a [subject] with playful, collectible-sticker energy: clean silhouette, strong focal hierarchy, generous negative space, and satisfying material reads. Render as a polished 3D object (studio-grade, soft-but-defined shadows, subtle rim light, pleasing specular highlights), with crisp edges and a slightly exaggerated toy-like proportion. Keep the background fully transparent (alpha PNG: no background, no gradients, no checkerboards). Add a white die-cut border for sticker presentation. Use a cohesive, slightly saturated palette with one accent color guiding attention. Follow this style:",
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

  const autofillFromConnectedRefine = useCallback(
    async (targetNodeId: string) => {
      const target = nodes.find((n) => n.id === targetNodeId);
      if (!target) {
        alert("Select a node to autofill.");
        return;
      }

      // Find a connected refine node (either direction).
      const incoming = edges.filter((e) => e.target === targetNodeId);
      const outgoing = edges.filter((e) => e.source === targetNodeId);

      const candidateNodes: Array<Node<NodeData> | undefined> = [
        ...incoming.map((e) => nodes.find((n) => n.id === e.source)),
        ...outgoing.map((e) => nodes.find((n) => n.id === e.target)),
      ];

      const refineNode = candidateNodes.find((n) => n?.type === "refine") ?? null;
      const lastResult = (refineNode?.data as any)?.lastResult as
        | { improvedTemplate?: FFAStyleTemplate; nodeFieldEdits?: Record<string, unknown> }
        | undefined;

      const improved = lastResult?.improvedTemplate;
      const nodeFieldEdits = (lastResult?.nodeFieldEdits ?? {}) as Record<string, unknown>;
      if (!refineNode) {
        alert("No Refine node connected. Connect a Refine node to this node first.");
        return;
      }
      if (!improved) {
        alert("Connected Refine node has no result yet. Run Refine first.");
        return;
      }

      const apply = (nodeType: string, base: any) => {
        const next: any = { ...(base ?? {}) };
        if (nodeType === "subject") {
          const s = improved?.object_specification?.subject;
          if (typeof s === "string") next.subject = s;
        }
        if (nodeType === "styleDescription") {
          const d = improved?.drawing_style?.description;
          if (typeof d === "string") next.description = d;
        }
        if (nodeType === "colorPalette") {
          const range = improved?.drawing_style?.color_palette?.range;
          const hexes = improved?.drawing_style?.color_palette?.hexes;
          if (typeof range === "string") next.range = range;
          if (Array.isArray(hexes)) next.hexes = hexes;
        }
        if (nodeType === "lineQuality") {
          const t = improved?.drawing_style?.line_quality?.type;
          if (typeof t === "string") next.type = t;
        }
        if (nodeType === "lighting") {
          const t = improved?.drawing_style?.lighting?.type;
          if (typeof t === "string") next.type = t;
        }
        if (nodeType === "perspective") {
          const p = improved?.drawing_style?.perspective;
          if (typeof p === "string") next.perspective = p;
        }
        if (nodeType === "fillAndTexture") {
          const f = improved?.drawing_style?.fill_and_texture?.filled_areas;
          if (typeof f === "string") next.filled_areas = f;
        }
        if (nodeType === "background") {
          const t = improved?.drawing_style?.background?.type;
          const s = improved?.drawing_style?.background?.style;
          if (typeof t === "string") next.type = t;
          if (typeof s === "string") next.style = s;
        }
        if (nodeType === "output") {
          const format = (improved as any)?.output?.format;
          const ratio = (improved as any)?.output?.canvas_ratio;
          if (typeof format === "string") next.format = format;
          if (typeof ratio === "string") next.canvas_ratio = ratio;
        }

        const edits = (nodeFieldEdits as any)?.[nodeType];
        if (edits && typeof edits === "object" && !Array.isArray(edits)) {
          Object.assign(next, edits);
        }
        return next;
      };

      setNodes((nds) =>
        nds.map((n) => (n.id === targetNodeId ? { ...n, data: apply(n.type ?? "unknown", n.data) } : n)),
      );
    },
    [edges, nodes, setNodes],
  );

  // Generate image
  const handleGenerate = useCallback(
    async (opts?: { qualityPreset?: "fast" | "balanced" | "high"; concurrency?: number }) => {
      if (!compileResult.template) return;
      if (!ENV_STATE.ok) {
        alert("Missing Supabase configuration. Check your .env.local file.");
        return;
      }

      const upstreamSubjects = (compileResult as any).subjects as string[] | undefined;
      const subjects =
        Array.isArray(upstreamSubjects) && upstreamSubjects.length > 1
          ? upstreamSubjects
          : [
              (
                subject.trim().length > 0
                  ? subject.trim()
                  : compileResult.template.object_specification.subject || ""
              ).trim(),
            ].filter(Boolean);
      if (subjects.length === 0) return;

      const qualityPreset = (opts?.qualityPreset ?? "balanced") as "fast" | "balanced" | "high";
      const size = "1024x1024";
      const quality: "low" | "medium" | "high" =
        qualityPreset === "fast" ? "low" : qualityPreset === "high" ? "high" : "medium";
      const concurrency = Math.max(
        1,
        Math.min(4, Number.isFinite(opts?.concurrency as any) ? Number(opts?.concurrency) : 2),
      );

      // Reset previous run.
      abortRef.current.forEach((c) => c.abort());
      abortRef.current = [];
      const runId = crypto.randomUUID();
      runRef.current = { runId, stopped: false };
      setGeneratedImages(subjects.map((s) => ({ subject: s, status: "queued" as const })));

      setGenerating(true);
      try {
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < subjects.length) {
            const ctl = runRef.current;
            if (!ctl || ctl.runId !== runId || ctl.stopped) break;
            const i = nextIndex++;
            const subj = subjects[i]!;

            setGeneratedImages((prev) =>
              prev.map((it) => (it.subject === subj ? { ...it, status: "generating" as const } : it)),
            );

            const controller = new AbortController();
            abortRef.current.push(controller);
            try {
              const finalPrompt = generateJsonPrompt(compileResult.template!, subj);
              const result = await generateImage(finalPrompt, {
                model: "gpt-image-1",
                size,
                quality,
                signal: controller.signal,
              });
              const dataUrl = `data:${result.contentType};base64,${result.base64}`;

              setGeneratedImages((prev) =>
                prev.map((it) => (it.subject === subj ? { ...it, status: "ready" as const, image: dataUrl } : it)),
              );

              // Save to history (one entry per image)
              const entry = saveHistoryEntry({
                subject: subj,
                compiledJson: compileResult.template!,
                finalPrompt,
                generationParams: { model: "gpt-image-1", size },
                image: dataUrl,
              });
              setHistory((h) => [entry, ...h]);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const cancelled = msg.toLowerCase().includes("aborted");
              setGeneratedImages((prev) =>
                prev.map((it) =>
                  it.subject === subj
                    ? {
                        ...it,
                        status: cancelled ? ("cancelled" as const) : ("error" as const),
                        error: cancelled ? undefined : msg,
                      }
                    : it,
                ),
              );
              if (!cancelled) {
                // keep the old UX: surface an alert for real errors
                // (but still allow others to finish)
                console.warn("[GeneratePanel] image failed:", msg);
              }
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, subjects.length) }, () => worker()),
        );
      } finally {
        setGenerating(false);
      }
    },
    [compileResult, subject],
  );

  // Add generated image to canvas
  const addImageToCanvas = useCallback(
    (entry: HistoryEntry) => {
      const imageNode: Node<ImageNodeData> = {
        id: `image-${Date.now()}`,
        type: "imageNode",
        position: getViewportCenterFlowPosition(),
        data: {
          label: `Image: ${entry.subject}`,
          image: entry.image,
          subject: entry.subject,
          compiledJson: entry.compiledJson,
          generationParams: entry.generationParams,
          timestamp: entry.timestamp,
        },
        selected: true,
      };
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), imageNode]);
      setSelectedNode(imageNode as any);
      setPanelTab("inspector");
    },
    [getViewportCenterFlowPosition, setNodes],
  );

  // Delete history entry
  const handleDeleteHistory = useCallback((id: string) => {
    deleteHistoryEntry(id);
    setHistory(getHistory());
  }, []);

  if (!ENV_STATE.ok) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4">
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
    <div className="h-full w-full flex flex-col bg-background min-h-0">
      {/* Header */}
      {!zenMode && (
        <header className="border-b px-4 py-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Style Builder</h1>
          <div className="text-xs text-muted-foreground">
            Build visual style graphs → FFAStyles JSON → Generate images
          </div>
        </header>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Node Palette */}
        {!zenMode && (
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
                  onClick={() => addNode("styleDescription", "Style Description", { description: "" } as any)}
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
                <button
                  onClick={() =>
                    addNode("background", "Background", {
                      type: "scene",
                      style:
                        "Create a coherent scene background that complements the subject. Keep the subject clear and centered; avoid clutter.",
                      color: "#ffffff",
                      outlineWidthPx: 24,
                    } as any)
                  }
                  className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
                >
                  Background
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
                <button
                  onClick={() =>
                    addNode("refine", "Refine", {
                      feedback: "",
                      sourceImageNodeId: "",
                      generatedImageNodeId: "",
                      model: "gpt-5.2",
                    } as any)
                  }
                  className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-accent"
                >
                  Refine (new branch)
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
                  setGeneratedImages([]);
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
        )}

        {/* Center: React Flow Canvas */}
        <div ref={reactFlowWrapperRef} className="flex-1 relative min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.05}
            maxZoom={8}
            // Interaction: make left-drag box-select (multi-select), and reserve panning for trackpad scroll / Space+drag / middle click.
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1, 2]}
            panActivationKeyCode="Space"
            panOnScroll
            zoomOnScroll={false}
            multiSelectionKeyCode="Shift"
            onInit={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>

          {/* Minimal chrome toggle (always available, even in zen mode) */}
          <div className="absolute top-3 left-3 z-50 flex items-center gap-2">
            <button
              onClick={() => setZenMode((z) => !z)}
              className="px-2 py-1 text-xs border rounded bg-background/90 backdrop-blur hover:bg-accent"
              title="Toggle zen mode (⌘.)"
            >
              {zenMode ? "Show UI" : "Hide UI"} <span className="text-muted-foreground">⌘.</span>
            </button>
            {!zenMode && (
              <button
                onClick={() => setRightPanelOpen((v) => !v)}
                className="px-2 py-1 text-xs border rounded bg-background/90 backdrop-blur hover:bg-accent"
                title={rightPanelOpen ? "Hide inspector" : "Show inspector"}
              >
                {rightPanelOpen ? "Hide inspector" : "Show inspector"}
              </button>
            )}
            {zenMode && (
              <div className="text-[11px] text-muted-foreground bg-background/80 backdrop-blur border rounded px-2 py-1">
                Zen mode — press <span className="font-medium">⌘.</span> to toggle
              </div>
            )}
          </div>
        </div>

        {/* Right: Panels */}
        {!zenMode && rightPanelOpen && (
          <aside className="w-96 border-l flex flex-col bg-muted/30">
            {/* Tabs */}
            <div className="flex border-b">
              <button
                onClick={() => setPanelTab("inspector")}
                className={cn(
                  "flex-1 px-4 py-2 text-sm border-b-2 transition-colors",
                  panelTab === "inspector"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
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
                    : "border-transparent text-muted-foreground hover:text-foreground",
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
                    : "border-transparent text-muted-foreground hover:text-foreground",
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
                  onAutofillFromConnectedRefine={autofillFromConnectedRefine}
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
                  generatedImages={generatedImages}
                  onStop={() => {
                    const ctl = runRef.current;
                    if (ctl) ctl.stopped = true;
                    abortRef.current.forEach((c) => c.abort());
                    abortRef.current = [];
                    setGeneratedImages((prev) =>
                      prev.map((it) => (it.status === "ready" ? it : { ...it, status: "cancelled" as const })),
                    );
                    setGenerating(false);
                  }}
                  onAddToCanvas={() => {
                    const ready = generatedImages.filter((it) => it.status === "ready" && it.image);
                    if (ready.length === 0 || !compileResult.template) return;
                    // Add all ready images to canvas.
                    for (const it of ready) {
                      const entry: HistoryEntry = {
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        subject: it.subject,
                        compiledJson: compileResult.template,
                        finalPrompt: generateJsonPrompt(compileResult.template, it.subject),
                        generationParams: { model: "gpt-image-1", size: "1024x1024" },
                        image: it.image!,
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
        )}
      </div>
    </div>
  );
}

// Inspector Panel Component
function InspectorPanel({
  node,
  onUpdate,
  onAutofillStyleFromImage,
  onAutofillFromConnectedRefine,
  autofilling,
}: {
  node: Node<NodeData> | null;
  onUpdate: (updates: Partial<NodeData>) => void;
  onAutofillStyleFromImage: (styleNodeId: string) => void;
  onAutofillFromConnectedRefine: (targetNodeId: string) => void;
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
          <div className="mt-2 flex items-center gap-2">
            <button
              className={cn(
                "px-2 py-1 text-xs border rounded",
                ((data as any).mode ?? "single") !== "multiple" ? "bg-accent" : "hover:bg-accent",
              )}
              onClick={() => onUpdate({ mode: "single" } as any)}
            >
              Single
            </button>
            <button
              className={cn(
                "px-2 py-1 text-xs border rounded",
                ((data as any).mode ?? "single") === "multiple" ? "bg-accent" : "hover:bg-accent",
              )}
              onClick={() => onUpdate({ mode: "multiple" } as any)}
            >
              Multiple
            </button>
          </div>

          {((data as any).mode ?? "single") === "multiple" ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={(data as any).subjectsText || ""}
                onChange={(e) => onUpdate({ subjectsText: e.target.value } as any)}
                className="w-full px-2 py-1 text-sm border rounded bg-background"
                rows={4}
                placeholder={"Multiple subjects (comma or newline separated)\ncat, dog\nhamster"}
              />

              <div className="flex items-center gap-2">
                <label className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-accent">
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      const subjects = parseSubjectsCsv(text);
                      onUpdate({
                        subjectsText: subjects.join("\n"),
                        csvFilename: file.name,
                        mode: "multiple",
                      } as any);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <div className="text-[11px] text-muted-foreground truncate">
                  {typeof (data as any).csvFilename === "string" && (data as any).csvFilename
                    ? `CSV: ${(data as any).csvFilename}`
                    : "First column used"}
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                Count:{" "}
                <span className="font-medium">
                  {parseSubjectsText((data as any).subjectsText || "").length}
                </span>
              </div>
            </div>
          ) : (
            <input
              type="text"
              value={(data as any).subject || ""}
              onChange={(e) => onUpdate({ subject: e.target.value })}
              className="w-full mt-2 px-2 py-1 text-sm border rounded bg-background"
              placeholder="e.g., retro robot vacuum"
            />
          )}
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
          <button
            onClick={() => onAutofillFromConnectedRefine(node.id)}
            className="w-full px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
          >
            Autofill from connected refine
          </button>
          <div className="text-[11px] text-muted-foreground">
            Connect an <span className="font-medium">Image Input (Upload)</span> node into this node,
            then click autofill.
          </div>
        </div>
      )}

      {type === "colorPalette" && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Refine</div>
          <button
            onClick={() => onAutofillFromConnectedRefine(node.id)}
            className="w-full px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
          >
            Apply from connected refine
          </button>
          <div className="text-[11px] text-muted-foreground">
            Connect a <span className="font-medium">Refine</span> node to this node to pull the
            latest refined palette.
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
  generatedImages,
  onStop,
  onAddToCanvas,
}: {
  compileResult: ReturnType<typeof compileGraph>;
  subject: string;
  onSubjectChange: (s: string) => void;
  onGenerate: (opts?: { qualityPreset?: "fast" | "balanced" | "high"; concurrency?: number }) => void;
  generating: boolean;
  generatedImages: Array<{
    subject: string;
    image?: string;
    status: "queued" | "generating" | "ready" | "error" | "cancelled";
    error?: string;
  }>;
  onStop: () => void;
  onAddToCanvas: () => void;
}) {
  const [qualityPreset, setQualityPreset] = useState<"fast" | "balanced" | "high">("balanced");
  const [concurrency, setConcurrency] = useState<number>(2);
  const effectiveSubject =
    subject.trim().length > 0
      ? subject.trim()
      : compileResult.template?.object_specification?.subject || "";
  const isMulti =
    Array.isArray((compileResult as any).subjects) &&
    ((compileResult as any).subjects as string[]).length > 1;
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
        {isMulti && (
          <div className="text-[11px] text-muted-foreground mt-1">
            Multi-subject detected from Subject node — this override will be ignored unless you disconnect it.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Quality</label>
          <select
            value={qualityPreset}
            onChange={(e) => setQualityPreset(e.target.value as any)}
            className="w-full px-2 py-1 text-sm border rounded bg-background"
          >
            <option value="fast">Fast (quality: low)</option>
            <option value="balanced">Balanced (quality: medium)</option>
            <option value="high">High (quality: high)</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Parallel</label>
          <select
            value={String(concurrency)}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="w-full px-2 py-1 text-sm border rounded bg-background"
          >
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
            <option value="4">4×</option>
          </select>
        </div>
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
            <label className="text-xs font-semibold text-muted-foreground">Compiled JSON</label>
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
        onClick={() => onGenerate({ qualityPreset, concurrency })}
        disabled={!compileResult.template || (!effectiveSubject.trim() && !isMulti) || generating}
        className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? "Generating..." : "Generate Image"}
      </button>

      {generating && (
        <button onClick={onStop} className="w-full px-4 py-2 border rounded hover:bg-accent text-sm">
          Stop
        </button>
      )}

      {generatedImages.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {generatedImages.map((it) => (
              <div key={it.subject} className="border rounded overflow-hidden bg-background">
                {it.status === "ready" && it.image ? (
                  <img src={it.image} alt={it.subject} className="w-full object-cover" />
                ) : (
                  <div className="w-full aspect-square bg-muted/40 flex items-center justify-center">
                    <div className="text-xs text-muted-foreground">
                      {it.status === "generating" ? "Generating…" : it.status}
                    </div>
                  </div>
                )}
                <div className="px-2 py-1 text-[11px] border-t truncate" title={it.subject}>
                  {it.subject}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={onAddToCanvas}
            className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90 text-sm"
          >
            Add all ready to Canvas
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
              <div className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</div>
            </div>
            <button onClick={() => onDelete(entry.id)} className="text-xs text-destructive hover:underline">
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

