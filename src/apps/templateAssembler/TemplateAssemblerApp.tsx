import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Edge, Node } from "@xyflow/react";
import { Background, Controls, MiniMap, ReactFlow, SelectionMode, addEdge, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/supabase";
import { getStudioClientId } from "@/studio/clientId";
import { ENV, ENV_STATE } from "@/env";
import { proxyChat } from "@/openaiProxyClient";
import { Modal } from "@/components/Modal";
import { TemplateAssemblerProvider } from "./templateAssemblerContext";
import LayoutNode, { type LayoutFlowNode } from "./nodes/LayoutNode";
import ModuleSetNode, { type ModuleSetFlowNode } from "./nodes/ModuleSetNode";
import AssemblerNode, { type AssemblerFlowNode } from "./nodes/AssemblerNode";
import PromptNode, { type PromptFlowNode } from "./nodes/PromptNode";

const LAST_ASSEMBLY_ID_KEY = "templateAssembler:lastAssemblyId";
const TEMPLATE_RESULTS_CACHE_PREFIX = "templateAssembler:results:v1:";

type TANode = LayoutFlowNode | ModuleSetFlowNode | AssemblerFlowNode | PromptFlowNode;
type TAEdge = Edge;
type GraphJson = { version: 1; nodes: TANode[]; edges: TAEdge[] };

type SlotTextOverride = {
  headers?: string[];
  titles?: string[];
  bodies?: string[];
};

const TEMPLATE_FILL_MODEL = "gpt-5.2";

function defaultGraph(): GraphJson {
  return {
    version: 1,
    nodes: [
      { id: "layout", type: "layoutNode", position: { x: 60, y: 60 }, data: { layoutIds: [], layoutId: "" } },
      { id: "module_1", type: "moduleNode", position: { x: 420, y: 60 }, data: { moduleIds: [] } as any },
      { id: "assembler", type: "assemblerNode", position: { x: 820, y: 60 }, data: { combinationCount: 0, validationError: null } },
    ],
    edges: [
      { id: "e1", source: "layout", target: "module_1", animated: true },
      { id: "e2", source: "module_1", target: "assembler", animated: true },
    ],
  };
}

export default function TemplateAssemblerApp() {
  const { assemblyId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [nodes, setNodes, onNodesChange] = useNodesState<TANode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TAEdge>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const graphJson: GraphJson = useMemo(() => ({ version: 1, nodes, edges }), [nodes, edges]);

  const [layouts, setLayouts] = useState<Array<{ id: string; kind: "layout"; name: string; spec_json: any }>>([]);
  const [modules, setModules] = useState<Array<{ id: string; kind: "module"; name: string; spec_json: any }>>([]);

  const [resultsOpen, setResultsOpen] = useState(false);
  const [combinationCount, setCombinationCount] = useState(0);
  const [combinationError, setCombinationError] = useState<string | null>(null);
  const [llmNotice, setLlmNotice] = useState<string | null>(null);
  const [llmMeta, setLlmMeta] = useState<{ model: string; filledKeys: number; ms: number } | null>(null);
  const [lastLlmPrompt, setLastLlmPrompt] = useState<string | null>(null);
  const [lastLlmRaw, setLastLlmRaw] = useState<string | null>(null);
  const [lastLlmExtractedJson, setLastLlmExtractedJson] = useState<string | null>(null);
  const [lastLlmParseError, setLastLlmParseError] = useState<string | null>(null);
  const [lastLlmOverrides, setLastLlmOverrides] = useState<Record<string, SlotTextOverride> | null>(null);
  const [aiDebugOpen, setAiDebugOpen] = useState(false);
  const [generatedTemplates, setGeneratedTemplates] = useState<
    Array<{ idx: number; layoutName: string; layoutId: string; mapping: Record<string, string>; template_spec_json: any }>
  >([]);
  const [templatePreviewIdx, setTemplatePreviewIdx] = useState<number | null>(null);
  const [templatesCacheHydrated, setTemplatesCacheHydrated] = useState(false);
  const [pdfPreviewByIdx, setPdfPreviewByIdx] = useState<
    Record<number, { status: "idle" | "loading" | "ready" | "error"; dataUrl?: string; error?: string }>
  >({});
  // (kept for possible future use)
  const autoRenderTokenRef = useRef(0);

  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const reactFlowInstanceRef = useRef<any | null>(null);
  const spawnIndexRef = useRef(0);

  // Autosave (debounced). We avoid saving immediately after loading to prevent creating new rows
  // just by opening the editor. We only persist once the user changes something.
  const initialSnapshotKeyRef = useRef<string | null>(null);
  const lastSavedKeyRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveTokenRef = useRef(0);

  const nodeTypes = useMemo(
    () => ({
      layoutNode: LayoutNode,
      // new types
      moduleNode: ModuleSetNode,
      assemblerNode: AssemblerNode,
      promptNode: PromptNode,
      // back-compat types
      moduleSetNode: ModuleSetNode,
      generateNode: AssemblerNode,
    }),
    [],
  );

  const selectedTemplate = useMemo(() => {
    if (templatePreviewIdx == null) return null;
    return generatedTemplates.find((t) => t.idx === templatePreviewIdx) ?? null;
  }, [generatedTemplates, templatePreviewIdx]);

  const selectedTemplateSvg = useMemo(() => {
    if (!selectedTemplate) return "";
    return renderTemplateSvg(selectedTemplate.template_spec_json);
  }, [selectedTemplate]);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  const updateNodeData = useCallback(
    (nodeId: string, patch: Record<string, any>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? ({ ...n, data: { ...(n.data ?? {}), ...patch } } as any) : n)),
      );
    },
    [setNodes],
  );

  const getViewportCenterFlowPosition = useCallback(() => {
    const rf = reactFlowInstanceRef.current;
    const el = reactFlowWrapperRef.current;
    if (!rf || !el) return { x: 60, y: 60 };
    const rect = el.getBoundingClientRect();
    const clientPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const base = rf.screenToFlowPosition(clientPoint);
    const i = spawnIndexRef.current++;
    const step = 22;
    return { x: base.x + (i % 6) * step, y: base.y + (Math.floor(i / 6) % 6) * step };
  }, []);

  const addNode = useCallback(
    (type: "layoutNode" | "moduleNode" | "promptNode" | "assemblerNode") => {
      const pos = getViewportCenterFlowPosition();
      const now = Date.now();
      if (type === "layoutNode") {
        setNodes((prev) => [
          ...prev,
          { id: `layout_${now}`, type: "layoutNode", position: pos, data: { layoutIds: [], layoutId: "" } } as any,
        ]);
        return;
      }
      if (type === "moduleNode") {
        const nextIdx = (nodes as any[]).filter((n) => String(n.type) === "moduleNode" || String(n.type) === "moduleSetNode")
          .length + 1;
        setNodes((prev) => [
          ...prev,
          { id: `module_${nextIdx}_${now}`, type: "moduleNode", position: pos, data: { moduleIds: [] } } as any,
        ]);
        return;
      }
      if (type === "promptNode") {
        setNodes((prev) => [...prev, { id: `prompt_${now}`, type: "promptNode", position: pos, data: { prompt: "" } } as any]);
        return;
      }
      if (type === "assemblerNode") {
        setNodes((prev) => [
          ...prev,
          {
            id: `assembler_${now}`,
            type: "assemblerNode",
            position: pos,
            data: { combinationCount: 0, validationError: null },
          } as any,
        ]);
      }
    },
    [getViewportCenterFlowPosition, nodes, setNodes],
  );

  function promptForAssembler(assemblerNodeId: string): string | null {
    const srcIds = connectedSources(assemblerNodeId);
    const connectedPrompts = srcIds
      .map((sid) => findNode(sid))
      .filter((n) => n && String(n.type ?? "") === "promptNode");
    for (const pn of connectedPrompts) {
      const p = String(pn?.data?.prompt ?? "").trim();
      if (p) return p;
    }
    // Fallback: if user added a prompt node but didn't connect it yet, still use it.
    const anyPrompt = (nodes as any[]).find((n) => String(n?.type ?? "") === "promptNode");
    const p = String(anyPrompt?.data?.prompt ?? "").trim();
    return p ? p : null;
  }

  async function refreshModules() {
    try {
      const { data, error } = await supabase
        .from("template_modules")
        .select("id,kind,name,spec_json")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const nextLayouts = rows
        .filter((r) => r.kind === "layout")
        .map((r) => ({ id: String(r.id), kind: "layout" as const, name: String(r.name ?? ""), spec_json: r.spec_json }));
      const nextModules = rows
        .filter((r) => r.kind === "module")
        .map((r) => ({ id: String(r.id), kind: "module" as const, name: String(r.name ?? ""), spec_json: r.spec_json }));
      setLayouts(nextLayouts);
      setModules(nextModules);

      // Also refresh existing generated previews by re-assembling with the latest module specs.
      // We extract the current filled text from the assembled spec so the preview can be updated
      // without having to re-run generation (or AI fill).
      setGeneratedTemplates((prev) => {
        if (!prev.length) return prev;

        function slotRectsFromLayoutSpec(layoutSpec: any): Record<string, any> {
          const els = Array.isArray(layoutSpec?.elements) ? layoutSpec.elements : [];
          const slotRects: Record<string, any> = {};
          for (const e of els) {
            if (String(e?.type ?? "") !== "Slot") continue;
            const slotKey = String(e?.props?.slotKey ?? "").trim();
            if (!slotKey) continue;
            slotRects[slotKey] = { rect: e.rect };
          }
          return slotRects;
        }

        function extractOverridesFromAssembledSpec(
          assembledSpec: any,
          mapping: Record<string, string>,
        ): Record<string, SlotTextOverride> {
          const out: Record<string, SlotTextOverride> = {};
          const els = Array.isArray(assembledSpec?.elements) ? assembledSpec.elements : [];
          for (const [slotKey, moduleId] of Object.entries(mapping)) {
            const key = `${slotKey}|${moduleId}`;
            const slotEls = els
              .filter((e: any) => String(e?.props?.__slotKey ?? "") === String(slotKey))
              .slice()
              .sort((a: any, b: any) => {
                const ay = Number(a?.rect?.y ?? 0);
                const by = Number(b?.rect?.y ?? 0);
                if (ay !== by) return ay - by;
                const ax = Number(a?.rect?.x ?? 0);
                const bx = Number(b?.rect?.x ?? 0);
                if (ax !== bx) return ax - bx;
                return (Number(a?.zIndex ?? 0) || 0) - (Number(b?.zIndex ?? 0) || 0);
              });
            const headers: string[] = [];
            const titles: string[] = [];
            const bodies: string[] = [];
            for (const e of slotEls) {
              const t = String(e?.type ?? "");
              const text = String(e?.props?.text ?? "").trim();
              if (!text) continue;
              if (t === "Header") headers.push(text);
              else if (t === "Title") titles.push(text);
              else if (t === "BodyText") bodies.push(text);
            }
            if (headers.length || titles.length || bodies.length) out[key] = { headers, titles, bodies };
          }
          return out;
        }

        const rebuilt = prev.map((t) => {
          const l = nextLayouts.find((x) => x.id === t.layoutId);
          const layoutSpec = (l as any)?.spec_json ?? null;
          if (!layoutSpec) return t;
          const slotRects = slotRectsFromLayoutSpec(layoutSpec);
          const overrides = extractOverridesFromAssembledSpec(t.template_spec_json, t.mapping);
          return {
            ...t,
            layoutName: l?.name || t.layoutName,
            template_spec_json: assembleTemplateSpec(layoutSpec, slotRects, t.mapping, null, overrides),
          };
        });

        // PDFs are now stale relative to the updated template specs.
        setPdfPreviewByIdx({});
        return rebuilt;
      });
    } catch (e) {
      // Non-fatal; show in main error area
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      if (!assemblyId) {
        setName("Untitled assembly");
        setDescription("");
        const g = defaultGraph();
        setNodes(g.nodes);
        setEdges(g.edges);
        await refreshModules();
        return;
      }
      const { data, error } = await supabase
        .from("template_assemblies")
        .select("id,client_id,name,description,graph_json,created_at,updated_at")
        .eq("id", assemblyId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Assembly not found.");

      setName(String((data as any).name ?? ""));
      setDescription(String((data as any).description ?? ""));
      const gj = ((data as any).graph_json ?? defaultGraph()) as GraphJson;
      setNodes((gj.nodes ?? []) as TANode[]);
      setEdges((gj.edges ?? []) as TAEdge[]);
      await refreshModules();

      try {
        localStorage.setItem(LAST_ASSEMBLY_ID_KEY, assemblyId);
      } catch {
        // ignore
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyId]);

  function snapshotKeyForAutosave(): string {
    return JSON.stringify({
      v: 1,
      name: name.trim() || "Untitled assembly",
      description: description.trim(),
      graph: graphJson,
    });
  }

  // Seed baseline keys after we finish loading an assembly (or default graph for new).
  useEffect(() => {
    if (loading) return;
    const key = snapshotKeyForAutosave();
    initialSnapshotKeyRef.current = key;
    lastSavedKeyRef.current = key;
    // Clear any pending timers when switching assemblies / finishing load
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, assemblyId]);

  // Debounced autosave when content changes.
  useEffect(() => {
    if (loading) return;
    if (savingRef.current) return;

    const key = snapshotKeyForAutosave();
    const baseline = initialSnapshotKeyRef.current;
    const lastSaved = lastSavedKeyRef.current;
    const isDirty = baseline ? key !== baseline : true;
    const alreadySaved = lastSaved ? key === lastSaved : false;
    if (!isDirty || alreadySaved) return;

    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      const token = ++autosaveTokenRef.current;
      void (async () => {
        try {
          const clientId = getStudioClientId();
          const cleanedName = name.trim() || "Untitled assembly";
          const cleanedDescription = description.trim();

          // Create-on-first-edit if there isn't an id yet.
          if (!assemblyId) {
            const { data, error } = await supabase
              .from("template_assemblies")
              .insert({
                client_id: clientId,
                name: cleanedName,
                description: cleanedDescription,
                graph_json: graphJson as any,
              } as any)
              .select("id")
              .single();
            if (error) throw error;
            if (token !== autosaveTokenRef.current) return; // stale

            const id = String((data as any)?.id ?? "");
            if (!id) throw new Error("Auto-save succeeded but no id returned.");
            lastSavedKeyRef.current = snapshotKeyForAutosave();
            navigate(`/template-assembler/edit/${encodeURIComponent(id)}`, { replace: true });
            return;
          }

          const { error } = await supabase
            .from("template_assemblies")
            .update({
              name: cleanedName,
              description: cleanedDescription,
              graph_json: graphJson as any,
            } as any)
            .eq("id", assemblyId);
          if (error) throw error;
          if (token !== autosaveTokenRef.current) return; // stale

          lastSavedKeyRef.current = snapshotKeyForAutosave();
        } catch (e) {
          // Don't spam global errors on background autosave; surface once.
          console.warn("[templateAssembler] autosave failed:", e);
        }
      })();
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, assemblyId, name, description, graphJson]);

  // Reset hydration marker when switching assemblies.
  useEffect(() => {
    setTemplatesCacheHydrated(false);
    // Keep panel closed until user asks for it; templates may still restore.
    setResultsOpen(false);
    setTemplatePreviewIdx(null);
    setPdfPreviewByIdx({});
  }, [assemblyId]);

  // Restore previously generated templates from localStorage (per assembly).
  useEffect(() => {
    if (!assemblyId) return;
    if (loading) return;
    const key = `${TEMPLATE_RESULTS_CACHE_PREFIX}${assemblyId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setTemplatesCacheHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw) as any;
      if (!parsed || parsed.v !== 1) {
        setTemplatesCacheHydrated(true);
        return;
      }
      const restored = Array.isArray(parsed.generatedTemplates) ? parsed.generatedTemplates : [];
      if (restored.length) setGeneratedTemplates(restored);
      if (typeof parsed.combinationCount === "number") setCombinationCount(parsed.combinationCount);
      setLlmMeta(parsed.llmMeta ?? null);
      setLlmNotice(parsed.llmNotice ?? null);
      setLastLlmPrompt(parsed.lastLlmPrompt ?? null);
    } catch {
      // ignore
    } finally {
      setTemplatesCacheHydrated(true);
    }
  }, [assemblyId, loading]);

  // Persist the latest generated templates so refreshes don't lose generations.
  useEffect(() => {
    if (!assemblyId) return;
    if (!templatesCacheHydrated) return; // don't overwrite before we attempt restore
    const key = `${TEMPLATE_RESULTS_CACHE_PREFIX}${assemblyId}`;
    try {
      if (generatedTemplates.length === 0) {
        localStorage.removeItem(key);
        return;
      }
      const payload = {
        v: 1 as const,
        savedAt: new Date().toISOString(),
        combinationCount,
        generatedTemplates,
        llmMeta,
        llmNotice,
        lastLlmPrompt,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore (quota exceeded / blocked)
    }
  }, [assemblyId, templatesCacheHydrated, generatedTemplates, combinationCount, llmMeta, llmNotice, lastLlmPrompt]);

  function connectedSources(targetId: string): string[] {
    return (edges as any[]).filter((e) => String(e?.target ?? "") === targetId).map((e) => String(e?.source ?? "")).filter(Boolean);
  }

  function findNode(id: string): any | null {
    return (nodes as any[]).find((n) => String(n?.id ?? "") === id) ?? null;
  }

  function modulePoolForAssembler(assemblerNodeId: string): string[] {
    const srcIds = connectedSources(assemblerNodeId);
    const pool: string[] = [];
    for (const sid of srcIds) {
      const n = findNode(sid);
      if (!n) continue;
      const t = String(n.type ?? "");
      if (t !== "moduleNode" && t !== "moduleSetNode") continue;
      const ids = Array.isArray(n?.data?.moduleIds) ? (n.data.moduleIds as any[]).map(String).filter(Boolean) : [];
      for (const id of ids) if (!pool.includes(id)) pool.push(id);
    }
    return pool;
  }

  function selectedLayoutIdsFromLayoutNode(layoutNode: any): string[] {
    const ids = Array.isArray(layoutNode?.data?.layoutIds)
      ? (layoutNode.data.layoutIds as any[]).map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    const legacy = String(layoutNode?.data?.layoutId ?? "").trim();
    const out: string[] = [];
    for (const id of ids) if (!out.includes(id)) out.push(id);
    if (legacy && !out.includes(legacy)) out.push(legacy);
    return out;
  }

  type LayoutCtx = {
    layoutId: string;
    layoutName: string;
    layoutSpec: any;
    slots: string[];
    slotRects: Record<string, any>;
  };

  function layoutSpecsForAssembler(assemblerNodeId: string): LayoutCtx[] | null {
    const srcIds = connectedSources(assemblerNodeId);
    const connectedLayoutNodes = srcIds
      .map((sid) => findNode(sid))
      .filter((n) => n && String(n.type ?? "") === "layoutNode");
    const fallbackLayoutNodes = connectedLayoutNodes.length
      ? connectedLayoutNodes
      : (nodes as any[]).filter((n) => String(n?.type ?? "") === "layoutNode");
    if (fallbackLayoutNodes.length === 0) return null;

    const layoutIds: string[] = [];
    for (const ln of fallbackLayoutNodes) {
      for (const id of selectedLayoutIdsFromLayoutNode(ln)) if (!layoutIds.includes(id)) layoutIds.push(id);
    }

    const out: LayoutCtx[] = [];
    for (const layoutId of layoutIds) {
    const l = layouts.find((x) => x.id === layoutId);
      const layoutSpec = (l as any)?.spec_json ?? null;
      const layoutName = l?.name || layoutId.slice(0, 8);
      const els = Array.isArray(layoutSpec?.elements) ? layoutSpec.elements : [];
    const slots = els
      .filter((e: any) => e?.type === "Slot")
      .map((e: any) => String(e?.props?.slotKey ?? "").trim())
      .filter(Boolean);
    const unique: string[] = [];
    for (const s of slots) if (!unique.includes(s)) unique.push(s);

      const slotRects: Record<string, any> = {};
      for (const e of els) {
        if (String(e?.type ?? "") !== "Slot") continue;
        const slotKey = String(e?.props?.slotKey ?? "").trim();
      if (!slotKey) continue;
        slotRects[slotKey] = { rect: e.rect };
      }

      out.push({ layoutId, layoutName, layoutSpec, slots: unique, slotRects });
    }

    return out;
  }

  function validateAndCountForAssembler(assemblerNodeId: string): { count: number; error: string | null } {
    const layoutsForAsm = layoutSpecsForAssembler(assemblerNodeId);
    if (!layoutsForAsm) return { count: 0, error: "Connect a Layout node to the Assembler." };
    if (layoutsForAsm.length === 0) return { count: 0, error: "Select at least one layout module in the Layout node." };
    for (const l of layoutsForAsm) {
      if (!l.layoutId) return { count: 0, error: "Select at least one layout module in the Layout node." };
      if (!l.layoutSpec) return { count: 0, error: `Selected layout not found (${l.layoutId.slice(0, 8)}).` };
      if (l.slots.length === 0)
        return { count: 0, error: `Layout "${l.layoutName}" has no slots. Add Slot elements in Module Forge.` };
    }

    const pool = modulePoolForAssembler(assemblerNodeId);
    if (pool.length === 0) return { count: 0, error: "Select at least one module in a connected Module node." };

    // count = sum_over_layouts(pool^slots(layout))
    const n = pool.length;
    let count = 0;
    for (const l of layoutsForAsm) {
      let c = 1;
      for (let i = 0; i < l.slots.length; i++) {
        c *= n;
        if (!Number.isFinite(c) || c > Number.MAX_SAFE_INTEGER) return { count: 0, error: "Combination count overflow." };
      }
      count += c;
      if (!Number.isFinite(count) || count > Number.MAX_SAFE_INTEGER) return { count: 0, error: "Combination count overflow." };
    }
    return { count, error: null };
  }

  // Validate + compute combination count for each Assembler node, then surface inside those nodes.
  useEffect(() => {
    const assemblers = (nodes as any[]).filter(
      (n) => String(n?.type ?? "") === "assemblerNode" || String(n?.type ?? "") === "generateNode",
    );
    if (assemblers.length === 0) return;
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const t = String((n as any).type ?? "");
        if (t !== "assemblerNode" && t !== "generateNode") return n;
        const { count, error } = validateAndCountForAssembler(String((n as any).id ?? ""));
        const curCount = Number((n as any)?.data?.combinationCount ?? 0);
        const curErr = ((n as any)?.data?.validationError ?? null) as string | null;
        const nextErr = error ?? null;
        if (curCount === count && curErr === nextErr) return n;
        changed = true;
        return { ...n, data: { ...(n.data ?? {}), combinationCount: count, validationError: nextErr } } as any;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, modules, layouts]);

  function powInt(base: number, exp: number): number {
    let out = 1;
    for (let i = 0; i < exp; i++) out *= base;
      return out;
  }

  async function generateTemplatesPreview(assemblerNodeId: string): Promise<void> {
    const { count, error } = validateAndCountForAssembler(assemblerNodeId);
    setCombinationCount(count);
    setCombinationError(error);
    setLlmNotice(null);
    setLlmMeta(null);
    setLastLlmPrompt(null);
    setLastLlmRaw(null);
    setLastLlmExtractedJson(null);
    setLastLlmParseError(null);
    setLastLlmOverrides(null);
    setPdfPreviewByIdx({});

    if (error) {
      setResultsOpen(true);
      setGeneratedTemplates([]);
      return;
    }

    const layoutsForAsm = layoutSpecsForAssembler(assemblerNodeId);
    if (!layoutsForAsm || layoutsForAsm.length === 0) {
      setResultsOpen(true);
      setCombinationError("Select at least one layout module in the Layout node.");
      setGeneratedTemplates([]);
      return;
    }

    const pool = modulePoolForAssembler(assemblerNodeId);
    const prompt = promptForAssembler(assemblerNodeId);
    const useLlmFill = Boolean(
      (nodes as any[]).find((n) => String(n?.id ?? "") === assemblerNodeId)?.data?.useLlmFill ?? false,
    );
    const cap = 40; // PDF previews are heavier; keep this small
    const combos: Array<{ idx: number; layoutName: string; layoutId: string; mapping: Record<string, string>; template_spec_json: any }> = [];

    const n = pool.length;
    for (const l of layoutsForAsm) {
      if (combos.length >= cap) break;
      const slots = l.slots;
      const s = slots.length;
      const total = powInt(n, s);
      const limit = Math.min(cap - combos.length, total);
      for (let i = 0; i < limit; i++) {
        const mapping: Record<string, string> = {};
        let x = i;
        for (let si = 0; si < s; si++) {
          const slotKey = slots[si]!;
          const pick = x % n;
          x = Math.floor(x / n);
          mapping[slotKey] = pool[pick]!;
        }
        combos.push({
          idx: combos.length,
          layoutName: l.layoutName,
          layoutId: l.layoutId,
          mapping,
          template_spec_json: assembleTemplateSpec(l.layoutSpec, l.slotRects, mapping, prompt, undefined),
        });
      }
    }

    if (useLlmFill && String(prompt ?? "").trim()) {
      try {
        const overrides = await generateSlotTextOverridesWithLlm(layoutsForAsm, combos, String(prompt ?? "").trim());
        const rebuilt = combos.map((c) => {
          const l = layoutsForAsm.find((x) => x.layoutId === c.layoutId);
          if (!l) return c;
          return {
            ...c,
            template_spec_json: assembleTemplateSpec(l.layoutSpec, l.slotRects, c.mapping, prompt, overrides),
          };
        });
        setGeneratedTemplates(rebuilt);
        setResultsOpen(true);
        setLlmNotice(null);
      } catch (e) {
        setGeneratedTemplates(combos);
        setResultsOpen(true);
        setLlmNotice(e instanceof Error ? e.message : String(e));
      }
    } else {
      setGeneratedTemplates(combos);
      setResultsOpen(true);
    }
  }

  function functionsBaseUrl(): string {
    if (!ENV_STATE.ok) throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
    if (ENV.SUPABASE_FUNCTIONS_BASE_URL) return ENV.SUPABASE_FUNCTIONS_BASE_URL;
    const u = new URL(ENV.SUPABASE_URL!);
    return `${u.origin}/functions/v1`;
  }

  async function invokeFunctionJson<T>(name: string, body: unknown): Promise<T> {
    if (!ENV_STATE.ok) throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
    const url = `${functionsBaseUrl()}/${name.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ENV.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY!}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${raw || "Unknown error"}`);
    return JSON.parse(raw) as T;
  }

  async function ensurePdfPreview(idx: number): Promise<void> {
    if (!generatedTemplates[idx]) return;
    const cur = pdfPreviewByIdx[idx];
    if (cur?.status === "loading" || cur?.status === "ready") return;
    setPdfPreviewByIdx((prev) => ({ ...prev, [idx]: { status: "loading" } }));
    try {
      const tpl = generatedTemplates[idx]!;
      const resp = await invokeFunctionJson<{ ok: boolean; base64: string }>("template-pdf-render", {
        action: "render",
        templateSpec: tpl.template_spec_json,
      });
      const dataUrl = `data:application/pdf;base64,${resp.base64}`;
      setPdfPreviewByIdx((prev) => ({ ...prev, [idx]: { status: "ready", dataUrl } }));
    } catch (e) {
      setPdfPreviewByIdx((prev) => ({
        ...prev,
        [idx]: { status: "error", error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  function escapeXml(s: string): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function safeSvgId(s: string): string {
    return String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function wrapTextToWidth(text: string, maxWidth: number, fontSize: number): string[] {
    const t = String(text ?? "");
    if (!t.trim()) return [""];
    // Heuristic: average glyph width ≈ 0.55em for typical sans fonts.
    const approxCharW = Math.max(1, fontSize * 0.55);
    const maxChars = Math.max(1, Math.floor(maxWidth / approxCharW));

    const words = t.split(/\s+/g).filter(Boolean);
    const lines: string[] = [];
    let line = "";

    const pushLine = () => {
      lines.push(line);
      line = "";
    };

    for (const w of words) {
      // Break very long words to avoid overflow.
      if (w.length > maxChars) {
        if (line) pushLine();
        for (let i = 0; i < w.length; i += maxChars) {
          lines.push(w.slice(i, i + maxChars));
        }
        continue;
      }

      const next = line ? `${line} ${w}` : w;
      if (next.length <= maxChars) {
        line = next;
      } else {
        if (line) pushLine();
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [t];
  }

  async function generateSlotTextOverridesWithLlm(
    layoutsForAsm: Array<{ layoutId: string; layoutName: string; layoutSpec: any; slotRects: Record<string, any>; slots: string[] }>,
    combos: Array<{ idx: number; layoutId: string; mapping: Record<string, string> }>,
    prompt: string,
  ): Promise<Record<string, SlotTextOverride>> {
    const keys = new Set<string>();
    for (const c of combos) {
      for (const [slotKey, moduleId] of Object.entries(c.mapping)) {
        keys.add(`${slotKey}|${moduleId}`);
      }
    }
    const expectedCountsByKey = new Map<string, { headers: number; titles: number; bodies: number }>();

    function approxCharBudget(rect: { w: number; h: number }, fontSize: number, lineHeight: number): number {
      const pad = 6;
      const maxW = Math.max(0, rect.w - pad * 2);
      const maxH = Math.max(0, rect.h - pad * 2);
      const maxCharsPerLine = Math.max(1, Math.floor(maxW / Math.max(1, fontSize * 0.55)));
      const maxLines = Math.max(1, Math.floor(maxH / Math.max(1, fontSize * lineHeight)));
      return maxCharsPerLine * maxLines;
    }

    function computeScaledModuleRects(
      modSpec: any,
      slotRect: any,
    ): Array<{ type: string; rect: { x: number; y: number; w: number; h: number } }> {
      // Avoid `any[]` here so downstream map/filter callbacks aren't implicitly `any` under `strict`.
      const modEls: Array<{
        type?: unknown;
        rect?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      }> = Array.isArray(modSpec?.elements) ? modSpec.elements : [];

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const e of modEls) {
        const r = e?.rect ?? {};
        const x = Number(r?.x ?? 0);
        const y = Number(r?.y ?? 0);
        const w = Number(r?.w ?? 0);
        const h = Number(r?.h ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        if (w <= 0 || h <= 0) continue;
        any = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }
      const boundsX = any ? minX : 0;
      const boundsY = any ? minY : 0;
      const boundsW = Math.max(1, any ? maxX - minX : Number(modSpec?.canvas?.w ?? 1) || 1);
      const boundsH = Math.max(1, any ? maxY - minY : Number(modSpec?.canvas?.h ?? 1) || 1);
      // Fill the slot by default (no letterboxing). This matches how we assemble modules into slots.
      const scaleX = Number(slotRect?.w ?? 1) / boundsW;
      const scaleY = Number(slotRect?.h ?? 1) / boundsH;
      const baseX = Number(slotRect?.x ?? 0) - boundsX * scaleX;
      const baseY = Number(slotRect?.y ?? 0) - boundsY * scaleY;

      return modEls
        .map((e) => {
          const r = e?.rect ?? {};
          const nx = baseX + (Number(r?.x ?? 0) || 0) * scaleX;
          const ny = baseY + (Number(r?.y ?? 0) || 0) * scaleY;
          const nw = (Number(r?.w ?? 0) || 0) * scaleX;
          const nh = (Number(r?.h ?? 0) || 0) * scaleY;
          return { type: String(e?.type ?? ""), rect: { x: nx, y: ny, w: nw, h: nh } };
        })
        .filter((e) => e.rect.w > 0 && e.rect.h > 0);
    }

    const uniqueLayoutNames = Array.from(new Set(layoutsForAsm.map((l) => String(l.layoutName ?? l.layoutId))));

    function buildLlmPrompt(attempt: number, lastError?: string): string {
      const promptLines: string[] = [];
      promptLines.push("You're an expert template creator.");
      promptLines.push(
        "Based on the instructions, fill out these content slots with meaningful content for use in a template generator.",
      );
      promptLines.push(
        "If there are multiple slots on a template, consider the overall final template and return content that makes sense together (avoid duplicate wording).",
      );
      promptLines.push('Do NOT use placeholder phrases like: "goes here", "placeholder", or "lorem ipsum".');
      promptLines.push("Write text that fits the available space. Follow the budgets.");
      if (attempt > 0) {
        promptLines.push("");
        promptLines.push("IMPORTANT: Your previous response was invalid.");
        if (lastError) promptLines.push(`Reason: ${lastError}`);
        promptLines.push("You MUST return non-empty arrays when a count is > 0.");
        promptLines.push("You MUST return non-empty strings (no blank strings).");
      }
      promptLines.push("");
      promptLines.push(`Instructions: Create a template for a [${prompt}]`);
      promptLines.push("");
      promptLines.push("Template Structure:");
      promptLines.push("- Module: Header / Divider / Body");
      promptLines.push(`- Templates: ${uniqueLayoutNames.join(" and ")}`);
      promptLines.push("");
      promptLines.push("Content Slots:");
      promptLines.push("Each key represents one module instance being placed into one slot.");
      promptLines.push("");
      expectedCountsByKey.clear();
      for (const key of Array.from(keys)) {
      const [slotKey, moduleId] = key.split("|");
      const layout = layoutsForAsm.find((l) => l.slots.includes(slotKey));
      const slotRect = layout?.slotRects?.[slotKey]?.rect;
      const mod = modules.find((m) => m.id === moduleId);
      const modSpec = (mod as any)?.spec_json;
      if (!layout || !slotRect || !modSpec) continue;

      const modEls = Array.isArray(modSpec?.elements) ? modSpec.elements : [];
      const headerCountRaw = modEls.filter((e: any) => String(e?.type ?? "") === "Header").length;
      const titleCountRaw = modEls.filter((e: any) => String(e?.type ?? "") === "Title").length;
      const bodyCountRaw = modEls.filter((e: any) => String(e?.type ?? "") === "BodyText").length;

      // If the module is empty (or has no text-like elements), the assembler will fall back to a minimal placeholder.
      // In that case, still ask the model for 1 header + 1 body so previews can look non-deterministic.
      const headerCount = headerCountRaw || (modEls.length === 0 ? 1 : 0);
      const titleCount = titleCountRaw;
      const bodyCount = bodyCountRaw || (modEls.length === 0 ? 1 : 0);
      expectedCountsByKey.set(key, { headers: headerCount, titles: titleCount, bodies: bodyCount });

      // Budgets: prefer element rects if present; otherwise fall back to slot-based heuristics.
      const scaled = computeScaledModuleRects(modSpec, slotRect);
      const textEls = scaled.filter((e) => e.type === "Header" || e.type === "Title" || e.type === "BodyText");
      const headerBudget =
        headerCount && textEls.some((e) => e.type === "Header")
          ? approxCharBudget(textEls.find((e) => e.type === "Header")!.rect, 24, 1.2)
          : headerCount
            ? approxCharBudget({ w: slotRect.w, h: Math.min(slotRect.h, 64) }, 24, 1.2)
            : 0;
      const bodyBudget =
        bodyCount && textEls.some((e) => e.type === "BodyText")
          ? approxCharBudget(textEls.find((e) => e.type === "BodyText")!.rect, 12, 1.35)
          : bodyCount
            ? approxCharBudget({ w: slotRect.w, h: Math.max(80, slotRect.h - 64) }, 12, 1.35)
            : 0;

      promptLines.push(
        `- key: ${key} | slot=${slotKey} (w=${Math.round(slotRect.w)}pt,h=${Math.round(
          slotRect.h,
        )}pt) | module=${String(mod?.name ?? moduleId)} | headers=${headerCount}, titles=${titleCount}, bodies=${bodyCount} | header_budget_chars≈${headerBudget} | body_budget_chars≈${bodyBudget}`,
      );
      }
      promptLines.push("");
      promptLines.push("Response format (STRICT):");
      promptLines.push(
        'Return ONLY JSON: {"items": {"<slotKey>|<moduleId>": {"headers": string[], "titles": string[], "bodies": string[]}}}',
      );
      promptLines.push("Rules:");
      promptLines.push("- Keep headers short and specific.");
      promptLines.push("- Bodies should read like real content (not meta-instructions).");
      promptLines.push("- For meeting summaries: include decisions, action items, and next steps where appropriate.");
      promptLines.push("- Respect budgets; if space is tight, shorten rather than cramming.");
      promptLines.push(
        "- IMPORTANT: For each key, return arrays with the EXACT number of strings implied by headers/titles/bodies in the slot schema.",
      );
      promptLines.push("- If a count is > 0, the corresponding array MUST have that many non-empty strings.");
      promptLines.push("- No extra keys. No markdown. No commentary.");
      if (attempt > 0) {
        const sampleKey = Array.from(expectedCountsByKey.keys())[0];
        const sampleCounts = sampleKey ? expectedCountsByKey.get(sampleKey) : null;
        if (sampleKey && sampleCounts) {
          promptLines.push("");
          promptLines.push("Example (shape only; your text must differ):");
          promptLines.push(
            JSON.stringify(
              {
                items: {
                  [sampleKey]: {
                    headers: Array.from({ length: sampleCounts.headers }, (_, i) => `Header ${i + 1}`),
                    titles: Array.from({ length: sampleCounts.titles }, (_, i) => `Title ${i + 1}`),
                    bodies: Array.from({ length: sampleCounts.bodies }, (_, i) => `Body ${i + 1}`),
                  },
                },
              },
              null,
              0,
            ),
          );
        }
      }
      return promptLines.join("\n");
    }

    async function tryOnce(attempt: number, lastError?: string) {
      const llmPrompt = buildLlmPrompt(attempt, lastError);
      const t0 = performance.now();
      setLastLlmPrompt(llmPrompt);
      setLastLlmRaw(null);
      setLastLlmExtractedJson(null);
      setLastLlmParseError(null);
      setLastLlmOverrides(null);
      const resp = await proxyChat(llmPrompt, { model: TEMPLATE_FILL_MODEL });
      const t1 = performance.now();
      const raw = String(resp?.text ?? "");
      setLastLlmRaw(raw);

      let items: any = null;
      try {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("AI did not return JSON.");
        const jsonStr = raw.slice(start, end + 1);
        setLastLlmExtractedJson(jsonStr);
        const parsed = JSON.parse(jsonStr) as any;
        items = parsed?.items;
        if (!items || typeof items !== "object") throw new Error("AI JSON missing 'items' object.");
      } catch (e) {
        setLastLlmParseError(e instanceof Error ? e.message : String(e));
        throw e;
      }

      const out: Record<string, SlotTextOverride> = {};
      for (const [k, v] of Object.entries(items)) {
        if (typeof k !== "string" || !v || typeof v !== "object") continue;
        const o = v as any;
        const exp = expectedCountsByKey.get(k) ?? { headers: 0, titles: 0, bodies: 0 };
        const headers = Array.isArray(o.headers)
          ? o.headers.map((s: any) => String(s)).filter((s: string) => s.trim())
          : [];
        const titles = Array.isArray(o.titles) ? o.titles.map((s: any) => String(s)).filter((s: string) => s.trim()) : [];
        const bodies = Array.isArray(o.bodies) ? o.bodies.map((s: any) => String(s)).filter((s: string) => s.trim()) : [];

        if (exp.headers > 0 && headers.length < exp.headers) {
          throw new Error(`AI returned ${headers.length} header(s) for ${k}; expected ${exp.headers}.`);
        }
        if (exp.titles > 0 && titles.length < exp.titles) {
          throw new Error(`AI returned ${titles.length} title(s) for ${k}; expected ${exp.titles}.`);
        }
        if (exp.bodies > 0 && bodies.length < exp.bodies) {
          throw new Error(`AI returned ${bodies.length} body paragraph(s) for ${k}; expected ${exp.bodies}.`);
        }

        out[k] = {
          headers: headers.length ? headers.slice(0, exp.headers || headers.length) : undefined,
          titles: titles.length ? titles.slice(0, exp.titles || titles.length) : undefined,
          bodies: bodies.length ? bodies.slice(0, exp.bodies || bodies.length) : undefined,
        };
      }

      setLastLlmOverrides(out);
      setLlmMeta({ model: TEMPLATE_FILL_MODEL, filledKeys: Object.keys(out).length, ms: Math.round(t1 - t0) });
      return out;
    }

    try {
      return await tryOnce(0);
    } catch (e0) {
      const msg0 = e0 instanceof Error ? e0.message : String(e0);
      return await tryOnce(1, msg0);
    }
  }

  // Fast, client-side preview (SVG). Much cheaper than PDF-per-card, and scales well for large combo spaces.
  function renderTemplateSvg(spec: any): string {
    const canvasW = Number(spec?.canvas?.w ?? 612) || 612;
    const canvasH = Number(spec?.canvas?.h ?? 792) || 792;
    const elements = Array.isArray(spec?.elements) ? spec.elements : [];
    const sorted = elements
      .slice()
      .sort((a: any, b: any) => (Number(a?.zIndex ?? 0) || 0) - (Number(b?.zIndex ?? 0) || 0));

    const defs: string[] = [];
    const svgEls: string[] = [];
    for (const e of sorted) {
      const type = String(e?.type ?? "");
      const rect = e?.rect ?? {};
      const x = Number(rect?.x ?? 0) || 0;
      const y = Number(rect?.y ?? 0) || 0;
      const w = Number(rect?.w ?? 0) || 0;
      const h = Number(rect?.h ?? 0) || 0;
      const props = e?.props ?? {};

      if (type === "BackgroundTexture") {
        const fill = escapeXml(String(props?.fill ?? "#ffffff"));
        svgEls.push(`<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${fill}" />`);
        continue;
      }

      if (type === "GridLines") {
        const cols = Math.max(1, Number(props?.cols ?? 6) || 6);
        const rows = Math.max(1, Number(props?.rows ?? 8) || 8);
        const stroke = escapeXml(String(props?.stroke ?? "#e5e7eb"));
        for (let i = 1; i < cols; i++) {
          const lx = (canvasW / cols) * i;
          svgEls.push(`<line x1="${lx}" y1="0" x2="${lx}" y2="${canvasH}" stroke="${stroke}" stroke-width="1" />`);
        }
        for (let j = 1; j < rows; j++) {
          const ly = (canvasH / rows) * j;
          svgEls.push(`<line x1="0" y1="${ly}" x2="${canvasW}" y2="${ly}" stroke="${stroke}" stroke-width="1" />`);
        }
        continue;
      }

      if (type === "Pattern") {
        const variant = String(props?.variant ?? "grid").toLowerCase();
        const stroke = escapeXml(String(props?.stroke ?? "#e5e7eb"));
        const outline = Boolean(props?.outline ?? false);
        const outlineThickness = Math.max(0, Number(props?.outlineThickness ?? 2) || 0);
        const spacing = Math.max(6, Number(props?.spacing ?? (variant === "dots" ? 12 : variant === "grid" ? 16 : 16)) || 16);

        if (variant === "lines") {
          for (let gy = y + spacing; gy < y + h; gy += spacing) {
            svgEls.push(`<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="${stroke}" stroke-width="1" />`);
          }
        } else if (variant === "grid") {
          for (let gx = x + spacing; gx < x + w; gx += spacing) {
            svgEls.push(`<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + h}" stroke="${stroke}" stroke-width="1" />`);
          }
          for (let gy = y + spacing; gy < y + h; gy += spacing) {
            svgEls.push(`<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="${stroke}" stroke-width="1" />`);
          }
        } else if (variant === "dots") {
          const r = 1.2;
          for (let gx = x + spacing / 2; gx < x + w; gx += spacing) {
            for (let gy = y + spacing / 2; gy < y + h; gy += spacing) {
              svgEls.push(`<circle cx="${gx}" cy="${gy}" r="${r}" fill="${stroke}" />`);
            }
          }
        } else {
          // blank
        }

        if (outline && outlineThickness > 0) {
          svgEls.push(
            `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="${outlineThickness}" />`,
          );
        }
        continue;
      }

      if (type === "Divider") {
        const stroke = escapeXml(String(props?.stroke ?? "#e5e7eb"));
        const thickness = Math.max(1, Number(props?.thickness ?? 2) || 2);
        svgEls.push(`<rect x="${x}" y="${y}" width="${w}" height="${thickness}" fill="${stroke}" />`);
        continue;
      }

      if (type === "Container") {
        const stroke = escapeXml(String(props?.stroke ?? "#d1d5db"));
        const fill = props?.fill ? escapeXml(String(props.fill)) : "none";
        svgEls.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`,
        );
        continue;
      }

      if (type === "Slot") {
        const slotKey = escapeXml(String(props?.slotKey ?? "slot"));
        svgEls.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#60a5fa" stroke-dasharray="1 6" stroke-linecap="round" stroke-width="2" />`,
        );
        svgEls.push(`<text x="${x + 6}" y="${y + 16}" font-size="10" fill="#2563eb">${slotKey}</text>`);
        continue;
      }

      if (type === "Header" || type === "Title" || type === "BodyText") {
        const rawText = String(props?.text ?? type);
        const fontSize = Math.max(8, Number(props?.fontSize ?? (type === "BodyText" ? 12 : 24)) || 12);
        const lineHeight = Math.max(1, Number(props?.lineHeight ?? 1.35) || 1.35);
        const fontWeight = Number(props?.fontWeight ?? (type === "Header" ? 700 : 400)) || (type === "Header" ? 700 : 400);
        const align = String(props?.textAlign ?? "left").toLowerCase();
        const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
        const pad = 6;
        const maxW = Math.max(0, w - pad * 2);
        const lines = wrapTextToWidth(rawText, maxW, fontSize).slice(0, 200); // safety cap

        const clipId = `clip_${safeSvgId(String(e?.id ?? `${type}_${x}_${y}`))}`;
        if (w > 0 && h > 0) {
          defs.push(`<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" /></clipPath>`);
        }

        const tspans = lines
          .map((ln, i) => {
            const ly = y + pad + fontSize + i * fontSize * lineHeight;
            const lx = align === "center" ? x + w / 2 : align === "right" ? x + w - pad : x + pad;
            return `<tspan x="${lx}" y="${ly}">${escapeXml(ln)}</tspan>`;
          })
          .join("");

        const textEl = `<text font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anchor}" fill="#111827">${tspans}</text>`;
        svgEls.push(w > 0 && h > 0 ? `<g clip-path="url(#${clipId})">${textEl}</g>` : textEl);
        continue;
      }

      // Fallback box
      if (w > 0 && h > 0) {
        svgEls.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(0,0,0,0.02)" stroke="#e5e7eb" />`,
        );
      }
    }

    // Important: thumbnails must show the full template, so size SVG to the container and "meet" aspect ratio.
    // The container sets the thumbnail aspect; this keeps the full page visible with letterboxing if needed.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${canvasW} ${canvasH}" preserveAspectRatio="xMidYMid meet" style="display:block" pointer-events="none"><defs>${defs.join("")}</defs>${svgEls.join("")}</svg>`;
  }

  function assembleTemplateSpec(
    layoutSpec: any,
    slotRects: Record<string, any>,
    mapping: Record<string, string>,
    prompt: string | null,
    overrides?: Record<string, SlotTextOverride>,
  ): any {
    const canvas = layoutSpec?.canvas ?? { w: 612, h: 792, unit: "pt" };
    const layoutEls = Array.isArray(layoutSpec?.elements) ? layoutSpec.elements : [];
    const outEls: any[] = [];
    let maxZ = 0;

    const cleanedPrompt = String(prompt ?? "").trim();
    const topic = cleanedPrompt || "";

    function titleCase(s: string): string {
      const raw = String(s ?? "").trim();
      if (!raw) return "";
      return raw
        .split(/\s+/g)
        .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ""))
        .join(" ");
    }

    function headerPlaceholder(idx: number): string {
      if (topic) return idx === 0 ? titleCase(topic) : `${titleCase(topic)} (section)`;
      return idx === 0 ? "This is a header" : "This is a long header";
    }

    function bodyPlaceholder(idx: number): string {
      if (topic) {
        const t = topic.toLowerCase();
        return idx === 0
          ? `A short ${t} paragraph goes here.\n\nAdd another sentence or two to make the layout feel realistic.`
          : `More ${t} details go here.\n\nThis is placeholder content used during assembly previews.`;
      }
      return idx === 0
        ? "This is a paragraph.\n\nIt’s placeholder content used during assembly previews."
        : "This is another paragraph.\n\nIt’s placeholder content used during assembly previews.";
    }

    for (const e of layoutEls) {
      const t = String(e?.type ?? "");
      if (t === "Slot") continue; // slot is an assembly-time construct
      outEls.push(e);
      maxZ = Math.max(maxZ, Number(e?.zIndex ?? 0) || 0);
    }

    let z = maxZ + 1;
    for (const [slotKey, moduleId] of Object.entries(mapping)) {
      const slot = slotRects[slotKey];
      if (!slot?.rect) continue;
      const mod = modules.find((m) => m.id === moduleId);
      const modSpec = (mod as any)?.spec_json ?? null;
      if (!modSpec) continue;
      const slotRect = slot.rect;
      const modEls = Array.isArray(modSpec?.elements) ? modSpec.elements : [];
      let headerIdx = 0;
      let bodyIdx = 0;
      let titleIdx = 0;

      // If a module is completely empty, still render a minimal placeholder so previews aren't blank.
      if (modEls.length === 0) {
        const overrideKey = `${slotKey}|${moduleId}`;
        const o = overrides?.[overrideKey];
        const pad = Math.max(6, Math.min(18, Math.min(slotRect.w, slotRect.h) * 0.06));
        const innerW = Math.max(1, slotRect.w - pad * 2);
        const headerH = Math.max(24, Math.min(44, slotRect.h * 0.22));
        // Ensure the header text actually fits in the header box (avoid clipping in SVG/PDF).
        const headerFontSize = Math.max(12, Math.min(28, headerH - pad * 2 - 2));
        const dividerH = 2;
        const gap = Math.max(6, pad * 0.6);
        const bodyY = slotRect.y + pad + headerH + gap + dividerH + gap;
        const bodyH = Math.max(18, slotRect.h - (bodyY - slotRect.y) - pad);

        const headerText = String(o?.headers?.[headerIdx] ?? headerPlaceholder(headerIdx));
        headerIdx++;
        outEls.push({
          id: `slot_${slotKey}_placeholder_header`,
          type: "Header",
          rect: { x: slotRect.x + pad, y: slotRect.y + pad, w: innerW, h: headerH },
          zIndex: z++,
          props: {
            __slotKey: slotKey,
            text: headerText,
            fontSize: headerFontSize,
            color: "#111827",
            lineHeight: 1.2,
          },
        });
        outEls.push({
          id: `slot_${slotKey}_placeholder_divider`,
          type: "Divider",
          rect: { x: slotRect.x + pad, y: slotRect.y + pad + headerH + gap, w: innerW, h: dividerH },
          zIndex: z++,
          props: { __slotKey: slotKey, stroke: "#e5e7eb", thickness: 2 },
        });
        const bodyText = String(o?.bodies?.[bodyIdx] ?? bodyPlaceholder(bodyIdx));
        bodyIdx++;
        outEls.push({
          id: `slot_${slotKey}_placeholder_body`,
          type: "BodyText",
          rect: { x: slotRect.x + pad, y: bodyY, w: innerW, h: bodyH },
          zIndex: z++,
          props: {
            __slotKey: slotKey,
            text: bodyText,
            fontSize: 12,
            color: "#111827",
            lineHeight: 1.35,
          },
        });
        continue;
      }

      // If this module is a stack-layout module (Header/Title/BodyText/Divider/Pattern only),
      // we can honor `layoutPreset: fit` by computing heights from the filled text before scaling into the slot.
      const stackableTypes = new Set(["Header", "Title", "BodyText", "Divider", "Pattern"]);
      const isStackModule =
        modEls.length > 0 &&
        modEls.every((e: any) => stackableTypes.has(String(e?.type ?? ""))) &&
        Number.isFinite(Number(modSpec?.canvas?.w ?? NaN)) &&
        Number.isFinite(Number(modSpec?.canvas?.h ?? NaN));

      const canvasW = Number(modSpec?.canvas?.w ?? 1) || 1;
      const canvasH = Number(modSpec?.canvas?.h ?? 1) || 1;
      const STACK_PAD = 24;
      const STACK_GAP = 12;
      const TEXT_PAD = 6;

      function presetOf(e: any): "fixed" | "fill" | "fit" {
        const p = String(e?.props?.layoutPreset ?? "").toLowerCase();
        if (p === "fill") return "fill";
        if (p === "fit") return "fit";
        return "fixed";
      }

      function fittedHeightFor(e: any, tmp: { header: number; title: number; body: number }, innerW: number): number {
        const type = String(e?.type ?? "");
        const props = e?.props ?? {};
        const preset = presetOf(e);
        if (preset !== "fit") return Math.max(1, Number(e?.rect?.h ?? 40) || 40);
        if (type === "Divider") return Math.max(1, Number(props?.thickness ?? 2) || 2);
        if (type === "Pattern") {
          const spacing = Math.max(6, Number(props?.spacing ?? 16) || 16);
          return Math.max(24, spacing * 6);
        }
        const maxW = Math.max(0, innerW - TEXT_PAD * 2);
        if (type === "Header") {
          const text = String(overrides?.[`${slotKey}|${moduleId}`]?.headers?.[tmp.header] ?? headerPlaceholder(tmp.header));
          tmp.header++;
          const fontSize = Math.max(8, Number(props?.fontSize ?? 24) || 24);
          const lineHeight = Math.max(1, Number(props?.lineHeight ?? 1.2) || 1.2);
          const lines = wrapTextToWidth(text, maxW, fontSize).slice(0, 200);
          return Math.max(18, TEXT_PAD * 2 + lines.length * fontSize * lineHeight);
        }
        if (type === "Title") {
          const text = String(
            overrides?.[`${slotKey}|${moduleId}`]?.titles?.[tmp.title] ??
              (topic ? titleCase(topic) : tmp.title === 0 ? "This is a title" : "This is another title"),
          );
          tmp.title++;
          const fontSize = Math.max(8, Number(props?.fontSize ?? 18) || 18);
          const lineHeight = Math.max(1, Number(props?.lineHeight ?? 1.25) || 1.25);
          const lines = wrapTextToWidth(text, maxW, fontSize).slice(0, 200);
          return Math.max(18, TEXT_PAD * 2 + lines.length * fontSize * lineHeight);
        }
        if (type === "BodyText") {
          const text = String(overrides?.[`${slotKey}|${moduleId}`]?.bodies?.[tmp.body] ?? bodyPlaceholder(tmp.body));
          tmp.body++;
          const fontSize = Math.max(8, Number(props?.fontSize ?? 12) || 12);
          const lineHeight = Math.max(1, Number(props?.lineHeight ?? 1.35) || 1.35);
          const lines = wrapTextToWidth(text, maxW, fontSize).slice(0, 200);
          return Math.max(18, TEXT_PAD * 2 + lines.length * fontSize * lineHeight);
        }
        return Math.max(1, Number(e?.rect?.h ?? 40) || 40);
      }

      // Special-case stack modules: lay out directly in slot-space (uniform text/padding scale),
      // so extra slot height goes into "fill" elements (BodyText/Pattern) instead of inflating top padding.
      if (isStackModule) {
        const sorted = modEls
          .slice()
          .sort((a: any, b: any) => (Number(a?.zIndex ?? 0) || 0) - (Number(b?.zIndex ?? 0) || 0));

        const scaleText = Math.max(0.01, Math.min(slotRect.w / canvasW, slotRect.h / canvasH));
        const pad = Math.max(6, Math.min(32, STACK_PAD * scaleText));
        const gap = Math.max(4, Math.min(24, STACK_GAP * scaleText));
        const innerW = Math.max(1, slotRect.w - pad * 2);
        const innerH = Math.max(1, slotRect.h - pad * 2);

        const tmp = { header: 0, title: 0, body: 0 };
        const fixedHeights: number[] = [];
        const fillIdx: number[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const e = sorted[i];
          const type = String(e?.type ?? "");
          const preset = presetOf(e);
          if (preset === "fill") {
            fillIdx.push(i);
            fixedHeights.push(0);
            continue;
          }
          if (preset === "fit") {
            fixedHeights.push(fittedHeightFor(e, tmp, innerW) * scaleText);
            continue;
          }
          if (type === "Divider") {
            const t = Math.max(1, Number(e?.props?.thickness ?? 2) || 2);
            fixedHeights.push(t * scaleText);
            continue;
          }
          // fixed
          fixedHeights.push(Math.max(1, (Number(e?.rect?.h ?? 40) || 40) * scaleText));
        }

        const gapsTotal = sorted.length > 0 ? gap * (sorted.length - 1) : 0;
        const fixedTotal = fixedHeights.reduce((s, h) => s + h, 0);
        const remaining = Math.max(1, innerH - gapsTotal - fixedTotal);
        const fillH = fillIdx.length > 0 ? Math.max(1, remaining / fillIdx.length) : 0;

        let yCursor = slotRect.y + pad;
        for (let i = 0; i < sorted.length; i++) {
          const e = sorted[i];
          const type = String(e?.type ?? "");
          const preset = presetOf(e);
          const rectH =
            preset === "fill"
              ? fillH
              : preset === "fit"
                ? fixedHeights[i]
                : type === "Divider"
                  ? fixedHeights[i]
                  : fixedHeights[i];

          const nx = slotRect.x + pad;
          const ny = yCursor;
          const nw = innerW;
          const nh = rectH;

          const baseProps: Record<string, any> = { ...(e?.props ?? {}), __slotKey: slotKey };
          const overrideKey = `${slotKey}|${moduleId}`;
          const o = overrides?.[overrideKey];

          if (type === "Divider") {
            const thickness = Math.max(1, Number(baseProps?.thickness ?? 2) || 2) * scaleText;
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: Math.max(1, thickness) },
              zIndex: z++,
              props: { ...baseProps, thickness },
            });
          } else if (type === "Pattern") {
            const spacing = Math.max(6, Number(baseProps?.spacing ?? 16) || 16) * scaleText;
            const outlineThickness = Math.max(0, Number(baseProps?.outlineThickness ?? 2) || 0) * scaleText;
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: nh },
              zIndex: z++,
              props: { ...baseProps, spacing, outlineThickness },
            });
          } else if (type === "Header") {
            const headerText = String(o?.headers?.[headerIdx] ?? headerPlaceholder(headerIdx));
            headerIdx++;
            const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 24) || 24) * scaleText;
            const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.2) || 1.2);
            const color = String(baseProps?.color ?? "#111827");
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: nh },
              zIndex: z++,
              props: { ...baseProps, text: headerText, fontSize, lineHeight, color },
            });
          } else if (type === "Title") {
            const titleText = String(
              o?.titles?.[titleIdx] ??
                (topic ? titleCase(topic) : titleIdx === 0 ? "This is a title" : "This is another title"),
            );
            titleIdx++;
            const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 18) || 18) * scaleText;
            const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.25) || 1.25);
            const color = String(baseProps?.color ?? "#111827");
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: nh },
              zIndex: z++,
              props: { ...baseProps, text: titleText, fontSize, lineHeight, color },
            });
          } else if (type === "BodyText") {
            const bodyText = String(o?.bodies?.[bodyIdx] ?? bodyPlaceholder(bodyIdx));
            bodyIdx++;
            const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 12) || 12) * scaleText;
            const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.35) || 1.35);
            const color = String(baseProps?.color ?? "#111827");
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: nh },
              zIndex: z++,
              props: { ...baseProps, text: bodyText, fontSize, lineHeight, color },
            });
          } else {
            outEls.push({
              ...e,
              id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
              rect: { x: nx, y: ny, w: nw, h: nh },
              zIndex: z++,
              props: baseProps,
            });
          }

          yCursor += nh + gap;
        }

        // Stack module handled fully in slot-space; skip bounds-based scaling below.
        continue;
      }

      let sourceEls: any[] = modEls;
      if (isStackModule) {
        const innerW = Math.max(1, canvasW - STACK_PAD * 2);
        const innerH = Math.max(1, canvasH - STACK_PAD * 2);
        const sorted = modEls.slice().sort((a: any, b: any) => (Number(a?.zIndex ?? 0) || 0) - (Number(b?.zIndex ?? 0) || 0));

        const tmp = { header: 0, title: 0, body: 0 };
        const fixedHeights: number[] = [];
        const fillIdx: number[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const e = sorted[i];
          const preset = presetOf(e);
          if (preset === "fill") {
            fillIdx.push(i);
            fixedHeights.push(0);
            continue;
          }
          if (preset === "fit") {
            fixedHeights.push(fittedHeightFor(e, tmp, innerW));
            continue;
          }
          if (String(e?.type ?? "") === "Divider") {
            fixedHeights.push(Math.max(1, Number(e?.props?.thickness ?? 2) || 2));
            continue;
          }
          fixedHeights.push(Math.max(1, Number(e?.rect?.h ?? 40) || 40));
        }
        const gapsTotal = sorted.length > 0 ? STACK_GAP * (sorted.length - 1) : 0;
        const fixedTotal = fixedHeights.reduce((s, h) => s + h, 0);
        const remaining = Math.max(1, innerH - gapsTotal - fixedTotal);
        const fillH = fillIdx.length > 0 ? Math.max(1, remaining / fillIdx.length) : 0;

        let yCursor = STACK_PAD;
        sourceEls = sorted.map((e: any, i: number) => {
          const preset = presetOf(e);
          const type = String(e?.type ?? "");
          const h =
            preset === "fill"
              ? fillH
              : preset === "fit"
                ? fixedHeights[i]
                : type === "Divider"
                  ? Math.max(1, Number(e?.props?.thickness ?? 2) || 2)
                  : fixedHeights[i];
          const out = { ...e, rect: { x: STACK_PAD, y: yCursor, w: innerW, h } };
          yCursor += h + STACK_GAP;
          return out;
        });
      }

      // Compute module content bounds (canvas is editor-only; modules should scale to fit slots).
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const e of sourceEls) {
        const r = e?.rect ?? {};
        const x = Number(r?.x ?? 0);
        const y = Number(r?.y ?? 0);
        const w = Number(r?.w ?? 0);
        const h = Number(r?.h ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        if (w <= 0 || h <= 0) continue;
        any = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }
      const boundsX = any ? minX : 0;
      const boundsY = any ? minY : 0;
      const boundsW = Math.max(1, any ? maxX - minX : Number(modSpec?.canvas?.w ?? 1) || 1);
      const boundsH = Math.max(1, any ? maxY - minY : Number(modSpec?.canvas?.h ?? 1) || 1);

      // Default behavior: modules should occupy the full slot area (no letterboxing).
      // We intentionally allow non-uniform scaling to avoid cropping.
      const scaleX = slotRect.w / boundsW;
      const scaleY = slotRect.h / boundsH;
      const scaleText = Math.max(0.01, Math.min(scaleX, scaleY));
      const baseX = slotRect.x - boundsX * scaleX;
      const baseY = slotRect.y - boundsY * scaleY;

      for (const e of sourceEls) {
        const rect = e?.rect ?? {};
        const nx = baseX + (Number(rect?.x ?? 0) || 0) * scaleX;
        const ny = baseY + (Number(rect?.y ?? 0) || 0) * scaleY;
        const nw = (Number(rect?.w ?? 0) || 0) * scaleX;
        const nh = (Number(rect?.h ?? 0) || 0) * scaleY;
        const type = String(e?.type ?? "");

        // Module BackgroundTexture should not fill the full page; treat it as a filled rect inside the slot region.
        if (type === "BackgroundTexture") {
          outEls.push({
            id: `slot_${slotKey}_${String(e?.id ?? "bg")}`,
            type: "Container",
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: { fill: String(e?.props?.fill ?? "#ffffff") },
          });
          continue;
        }

        const baseProps: Record<string, any> = { ...(e?.props ?? {}), __slotKey: slotKey };
        const overrideKey = `${slotKey}|${moduleId}`;
        const o = overrides?.[overrideKey];
        if (type === "Divider") {
          const thickness = Math.max(1, Number(baseProps?.thickness ?? 2) || 2) * scaleY;
          outEls.push({
            ...e,
            id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: { ...baseProps, thickness },
          });
          continue;
        }
        if (type === "Pattern") {
          const spacing = Math.max(6, Number(baseProps?.spacing ?? 16) || 16) * scaleText;
          const outlineThickness = Math.max(0, Number(baseProps?.outlineThickness ?? 2) || 0) * scaleText;
          outEls.push({
            ...e,
            id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: { ...baseProps, spacing, outlineThickness },
          });
          continue;
        }
        if (type === "Header") {
          const headerText = String(o?.headers?.[headerIdx] ?? headerPlaceholder(headerIdx));
          headerIdx++;
          const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 24) || 24) * scaleText;
          const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.2) || 1.2);
          const color = String(baseProps?.color ?? "#111827");
          outEls.push({
            ...e,
            id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: {
              ...baseProps,
              text: headerText,
              fontSize,
              lineHeight,
              color,
            },
          });
          continue;
        }
        if (type === "Title") {
          const titleText = String(
            o?.titles?.[titleIdx] ??
              (topic ? titleCase(topic) : titleIdx === 0 ? "This is a title" : "This is another title"),
          );
          titleIdx++;
          const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 18) || 18) * scaleText;
          const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.25) || 1.25);
          const color = String(baseProps?.color ?? "#111827");
          outEls.push({
            ...e,
            id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: {
              ...baseProps,
              text: titleText,
              fontSize,
              lineHeight,
              color,
            },
          });
          continue;
        }
        if (type === "BodyText") {
          const bodyText = String(o?.bodies?.[bodyIdx] ?? bodyPlaceholder(bodyIdx));
          bodyIdx++;
          const fontSize = Math.max(8, Number(baseProps?.fontSize ?? 12) || 12) * scaleText;
          const lineHeight = Math.max(1, Number(baseProps?.lineHeight ?? 1.35) || 1.35);
          const color = String(baseProps?.color ?? "#111827");
          outEls.push({
            ...e,
            id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
            rect: { x: nx, y: ny, w: nw, h: nh },
            zIndex: z++,
            props: {
              ...baseProps,
              text: bodyText,
              fontSize,
              color,
              lineHeight,
            },
          });
          continue;
        }

        outEls.push({
          ...e,
          id: `slot_${slotKey}_${String(e?.id ?? "el")}`,
          rect: { x: nx, y: ny, w: nw, h: nh },
          zIndex: z++,
          props: baseProps,
        });
      }
    }

    return { version: 1, canvas, elements: outEls };
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const clientId = getStudioClientId();
      const cleanedName = name.trim() || "Untitled assembly";

      if (!assemblyId) {
        const { data, error } = await supabase
          .from("template_assemblies")
          .insert({
            client_id: clientId,
            name: cleanedName,
            description: description.trim(),
            graph_json: graphJson as any,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        const id = String((data as any)?.id ?? "");
        if (!id) throw new Error("Save succeeded but no id returned.");
        // Mark saved state before navigation to avoid an immediate autosave loop.
        lastSavedKeyRef.current = snapshotKeyForAutosave();
        navigate(`/template-assembler/edit/${encodeURIComponent(id)}`, { replace: true });
        return;
      }

      const { error } = await supabase
        .from("template_assemblies")
        .update({
          name: cleanedName,
          description: description.trim(),
          graph_json: graphJson as any,
        } as any)
        .eq("id", assemblyId);
      if (error) throw error;

      setName(cleanedName);
      lastSavedKeyRef.current = snapshotKeyForAutosave();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <TemplateAssemblerProvider
      value={{
        layouts,
        modules,
        updateNodeData,
        requestGenerate: (assemblerNodeId: string) => generateTemplatesPreview(assemblerNodeId),
      }}
    >
      <div className="h-full w-full overflow-hidden flex flex-col">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link className="text-xs underline text-muted-foreground shrink-0" to="/template-assembler/assemblies">
            ← Assemblies
          </Link>
          <input
            className="border rounded px-3 py-2 text-sm bg-background w-[320px] max-w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Assembly name"
          />
          <input
            className="border rounded px-3 py-2 text-sm bg-background w-[420px] max-w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
            onClick={() => setResultsOpen(true)}
            disabled={resultsOpen}
            title={resultsOpen ? "Templates panel is already open" : "Open generated templates panel"}
          >
            Show templates{generatedTemplates.length ? ` (${generatedTemplates.length})` : ""}
          </button>
          <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={refreshModules}>
            Refresh modules
          </button>
          <button
            className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {err ? (
        <div className="border-b p-3 text-sm bg-destructive/10 border-destructive/20 text-destructive">{err}</div>
      ) : null}

      <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left palette */}
          <aside className="w-60 shrink-0 border-r bg-muted/20 overflow-auto">
            <div className="p-4 space-y-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Nodes</div>
                <div className="font-semibold">Add to canvas</div>
              </div>
              <div className="grid gap-2">
                <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={() => addNode("layoutNode")}>
                  Layout
                </button>
                <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={() => addNode("moduleNode")}>
                  Module
                </button>
                <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={() => addNode("promptNode")}>
                  Prompt
                </button>
                <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={() => addNode("assemblerNode")}>
                  Assembler
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Tip: connect <span className="font-medium">Layout → Module → Assembler</span>. Prompt is optional.
              </div>
            </div>
          </aside>

          {/* Canvas */}
          <div ref={reactFlowWrapperRef} className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes as any}
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
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

          {/* Right results */}
        {resultsOpen ? (
            <aside className="w-[460px] shrink-0 border-l bg-muted/20 overflow-auto">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">Generated templates</div>
                <button className="text-xs underline text-muted-foreground" onClick={() => setResultsOpen(false)}>
                  Close
                </button>
              </div>

              <div className="text-sm">
                Count: <span className="font-medium">{combinationCount}</span>
              </div>

              {!combinationError && generatedTemplates.length === 0 ? (
                <div className="p-2 rounded border text-sm bg-muted/30 text-muted-foreground">
                  No generated templates yet. Click <span className="font-medium">Generate</span> on an Assembler node to create previews.
                </div>
              ) : null}

              {combinationError ? (
                <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">
                  {combinationError}
                </div>
              ) : null}

              {llmNotice ? (
                <div className="p-2 rounded border text-sm bg-amber-50 border-amber-200 text-amber-900">
                  AI fill failed; showing deterministic placeholders instead.
                  <div className="mt-1 text-xs text-amber-900/80">{llmNotice}</div>
                </div>
              ) : null}

              {llmMeta ? (
                <div className="text-xs text-muted-foreground">
                  AI fill: <span className="font-medium">on</span> · model{" "}
                  <span className="font-medium">{llmMeta.model}</span> · keys{" "}
                  <span className="font-medium">{llmMeta.filledKeys}</span> ·{" "}
                  <span className="font-medium">{llmMeta.ms}ms</span>
                </div>
              ) : null}

              {lastLlmPrompt ? (
                <button
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => navigator.clipboard.writeText(lastLlmPrompt)}
                  title="Copy the exact prompt sent to the AI"
                >
                  Copy AI prompt
                </button>
              ) : null}

              {lastLlmPrompt ? (
                <button
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => setAiDebugOpen(true)}
                  title="Show raw AI response + parsed overrides"
                >
                  Debug AI
                </button>
              ) : null}

                {!combinationError ? (
                  <>
                    <div className="text-xs text-muted-foreground">
                      Showing first {generatedTemplates.length} (cap 40). Thumbnails are fast SVG previews; PDF is optional per card.
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {generatedTemplates.map((t) => {
                        const svg = renderTemplateSvg(t.template_spec_json);
                        // const elements = ...
                        // const firstType = ...

                        return (
                          <div
                            key={t.idx}
                            className="border rounded-lg bg-background p-2 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                            role="button"
                            tabIndex={0}
                            title="Click to open a larger preview"
                            onClick={() => setTemplatePreviewIdx(t.idx)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setTemplatePreviewIdx(t.idx);
                              }
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-muted-foreground">#{t.idx + 1}</div>
                              <div className="flex items-center gap-2">
                                <button
                                  className="text-[11px] underline text-muted-foreground hover:text-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void navigator.clipboard.writeText(JSON.stringify(t.template_spec_json, null, 2));
                                  }}
                                  title="Copy assembled template JSON"
                                >
                                  Copy JSON
                                </button>
                                <button
                                  className="text-[11px] underline text-muted-foreground hover:text-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    ensurePdfPreview(t.idx);
                                  }}
                                  title="Render an exact PDF (slower)"
                                >
                                  Render PDF
                                </button>
                              </div>
                            </div>

                            <div className="mt-1 text-[11px] text-muted-foreground truncate" title={t.layoutName}>
                              Layout: <span className="font-medium">{t.layoutName}</span>
                            </div>

                            {/* (debug removed) */}

                            <div className="mt-2">
                              <div
                                className="w-full aspect-[3/4] rounded border bg-white overflow-hidden"
                                title="SVG preview"
                                dangerouslySetInnerHTML={{ __html: svg }}
                              />
                              {pdfPreviewByIdx[t.idx]?.status === "loading" ? (
                                <div className="mt-1 text-[11px] text-muted-foreground">Rendering PDF…</div>
                              ) : null}
                              {pdfPreviewByIdx[t.idx]?.status === "ready" && pdfPreviewByIdx[t.idx]?.dataUrl ? (
                                <a
                                  className="mt-1 text-[11px] underline text-muted-foreground hover:text-foreground inline-block"
                                  href={pdfPreviewByIdx[t.idx]!.dataUrl}
                                  onClick={(e) => e.stopPropagation()}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open PDF
                                </a>
                              ) : null}
                              {pdfPreviewByIdx[t.idx]?.status === "error" && pdfPreviewByIdx[t.idx]?.error ? (
                                <div className="mt-1 text-[11px] text-destructive line-clamp-2">
                                  {pdfPreviewByIdx[t.idx]!.error}
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-2 space-y-1">
                              {Object.entries(t.mapping).map(([slot, moduleId]) => {
                                const modName = modules.find((m) => m.id === moduleId)?.name || moduleId.slice(0, 8);
                                return (
                                  <div key={slot} className="flex items-center justify-between gap-2">
                                    <div className="font-mono text-[11px] truncate" title={slot}>
                                      {slot}
                                    </div>
                                    <div className="truncate" title={modName}>
                                      {modName}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
      </div>

      <Modal
        open={!!selectedTemplate}
        title={selectedTemplate ? `Template preview #${selectedTemplate.idx + 1}` : "Template preview"}
        description={selectedTemplate ? `Layout: ${selectedTemplate.layoutName}` : undefined}
        onClose={() => setTemplatePreviewIdx(null)}
        size="xl"
      >
        {selectedTemplate ? (
          <div className="space-y-3">
            <div
              className="w-full rounded border bg-white flex items-center justify-center p-2 [&_svg]:max-w-full [&_svg]:max-h-[70vh] [&_svg]:w-auto [&_svg]:h-auto"
              title="SVG preview"
              dangerouslySetInnerHTML={{ __html: selectedTemplateSvg }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={aiDebugOpen}
        title="AI debug"
        description="Raw model response + extracted JSON + parsed overrides used to fill the preview."
        onClose={() => setAiDebugOpen(false)}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {llmMeta ? (
              <div className="text-xs text-muted-foreground">
                model <span className="font-medium">{llmMeta.model}</span> · keys{" "}
                <span className="font-medium">{llmMeta.filledKeys}</span> ·{" "}
                <span className="font-medium">{llmMeta.ms}ms</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No AI meta yet (generate with AI fill on).</div>
            )}
            <div className="flex-1" />
            {lastLlmPrompt ? (
              <button
                className="text-xs px-2 py-1 border rounded hover:bg-accent"
                onClick={() => navigator.clipboard.writeText(lastLlmPrompt)}
              >
                Copy prompt
              </button>
            ) : null}
            {lastLlmRaw ? (
              <button
                className="text-xs px-2 py-1 border rounded hover:bg-accent"
                onClick={() => navigator.clipboard.writeText(lastLlmRaw)}
              >
                Copy raw
              </button>
            ) : null}
            {lastLlmExtractedJson ? (
              <button
                className="text-xs px-2 py-1 border rounded hover:bg-accent"
                onClick={() => navigator.clipboard.writeText(lastLlmExtractedJson)}
              >
                Copy extracted JSON
              </button>
            ) : null}
            {lastLlmOverrides ? (
              <button
                className="text-xs px-2 py-1 border rounded hover:bg-accent"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(lastLlmOverrides, null, 2))}
              >
                Copy overrides
              </button>
            ) : null}
          </div>

          {lastLlmParseError ? (
            <div className="p-2 rounded border text-sm bg-amber-50 border-amber-200 text-amber-900">
              Parse error: <span className="font-medium">{lastLlmParseError}</span>
            </div>
          ) : null}

          <div>
            <div className="text-xs font-medium mb-1">Raw LLM response</div>
            <pre className="text-xs p-2 rounded border bg-muted/30 overflow-auto max-h-[240px] whitespace-pre-wrap">
{String(lastLlmRaw ?? "")}
            </pre>
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Extracted JSON (what we parse)</div>
            <pre className="text-xs p-2 rounded border bg-muted/30 overflow-auto max-h-[240px] whitespace-pre-wrap">
{String(lastLlmExtractedJson ?? "")}
            </pre>
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Parsed overrides (what we apply)</div>
            <pre className="text-xs p-2 rounded border bg-muted/30 overflow-auto max-h-[280px] whitespace-pre-wrap">
{lastLlmOverrides ? JSON.stringify(lastLlmOverrides, null, 2) : ""}
            </pre>
          </div>
        </div>
      </Modal>
    </TemplateAssemblerProvider>
  );
}

