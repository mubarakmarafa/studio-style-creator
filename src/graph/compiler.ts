import { Node, Edge } from "@xyflow/react";
import type {
  FFAStyleTemplate,
  NodeData,
  TemplateRootNodeData,
  SubjectNodeData,
  StyleDescriptionNodeData,
  LineQualityNodeData,
  ColorPaletteNodeData,
  LightingNodeData,
  PerspectiveNodeData,
  FillAndTextureNodeData,
  BackgroundNodeData,
  OutputNodeData,
} from "./schema";
import { parseSubjectsText } from "@/graph/subjects";

export interface CompileError {
  message: string;
  nodeId?: string;
}

export interface CompileResult {
  template: FFAStyleTemplate | null;
  errors: CompileError[];
  /**
   * If the upstream graph includes a Subject node in multiple mode, this is the
   * parsed subject list (capped/normalized).
   */
  subjects?: string[];
  subjectMode?: "single" | "multiple";
}

export type CompileMode = "fromTemplateRoot" | "upstreamOfTarget";

// Deep merge utility
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const output = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      output[key] = deepMerge(
        (output[key] as Record<string, unknown>) || {},
        source[key] as Record<string, unknown>
      );
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

// Find root node (templateRoot)
function findRootNode(nodes: Node<NodeData>[]): Node<TemplateRootNodeData> | null {
  return (nodes.find((n) => n.type === "templateRoot") as Node<TemplateRootNodeData>) || null;
}

// Get connected nodes in dependency order (BFS from root)
function getConnectedNodes(
  rootId: string,
  nodes: Node<NodeData>[],
  edges: Edge[]
): Node<NodeData>[] {
  const visited = new Set<string>();
  const result: Node<NodeData>[] = [];
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = nodes.find((n) => n.id === currentId);
    if (node) {
      result.push(node);
    }

    // Add connected nodes
    edges
      .filter((e) => e.source === currentId)
      .forEach((e) => {
        if (!visited.has(e.target)) {
          queue.push(e.target);
        }
      });
  }

  return result;
}

function getUpstreamNodes(
  targetId: string,
  nodes: Node<NodeData>[],
  edges: Edge[]
): Node<NodeData>[] {
  const visited = new Set<string>();
  const result: Node<NodeData>[] = [];
  const queue: string[] = [targetId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    if (currentId !== targetId) {
      const node = nodes.find((n) => n.id === currentId);
      if (node) result.push(node);
    }

    // Walk "backwards": any edge whose target is current becomes an upstream dependency.
    edges
      .filter((e) => e.target === currentId)
      .forEach((e) => {
        if (!visited.has(e.source)) queue.push(e.source);
      });
  }

  return result;
}

function typePriority(type: string | undefined): number {
  // Lower number = earlier merge (later nodes can overwrite).
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

// Convert node to JSON patch
function nodeToPatch(node: Node<NodeData>): Record<string, unknown> | null {
  const { type, data } = node;
  if (!data) return null;

  switch (type) {
    case "templateRoot": {
      const d = data as TemplateRootNodeData;
      return {
        metadata: {
          type: {
            category: d.category || "Images",
          },
        },
      };
    }

    case "subject": {
      const d = data as SubjectNodeData;
      const mode: "single" | "multiple" = (d.mode ?? "single") === "multiple" ? "multiple" : "single";
      const subjects = mode === "multiple" ? parseSubjectsText(d.subjectsText ?? "") : [];
      const subject = mode === "multiple" ? subjects[0] ?? "" : d.subject || "";
      return {
        object_specification: {
          subject,
        },
      };
    }

    case "styleDescription": {
      const d = data as StyleDescriptionNodeData;
      return {
        drawing_style: {
          description: d.description || "",
        },
      };
    }

    case "lineQuality": {
      const d = data as LineQualityNodeData;
      return {
        drawing_style: {
          line_quality: {
            type: d.type || "",
            ...Object.fromEntries(
              Object.entries(d).filter(([k]) => k !== "label" && k !== "type" && k !== "ui")
            ),
          },
        },
      };
    }

    case "colorPalette": {
      const d = data as ColorPaletteNodeData;
      return {
        drawing_style: {
          color_palette: {
            range: d.range || "",
            ...Object.fromEntries(
              Object.entries(d).filter(([k]) => k !== "label" && k !== "range" && k !== "ui")
            ),
          },
        },
      };
    }

    case "lighting": {
      const d = data as LightingNodeData;
      return {
        drawing_style: {
          lighting: {
            type: d.type || "",
            ...Object.fromEntries(
              Object.entries(d).filter(([k]) => k !== "label" && k !== "type" && k !== "ui")
            ),
          },
        },
      };
    }

    case "perspective": {
      const d = data as PerspectiveNodeData;
      return {
        drawing_style: {
          perspective: d.perspective || "",
        },
      };
    }

    case "fillAndTexture": {
      const d = data as FillAndTextureNodeData;
      return {
        drawing_style: {
          fill_and_texture: {
            filled_areas: d.filled_areas || "",
            ...Object.fromEntries(
              Object.entries(d).filter(([k]) => k !== "label" && k !== "filled_areas" && k !== "ui")
            ),
          },
        },
      };
    }

    case "background": {
      const d = data as BackgroundNodeData;
      const mode = (d.type || "").trim();

      // Build a minimal, semantically meaningful background block.
      // We intentionally do NOT spread arbitrary node data into the template because nodes
      // can contain editor-only fields (like `ui`) or stale fields from previous modes.
      const background: Record<string, unknown> = {
        type: mode,
        ...(d.style ? { style: d.style } : {}),
      };

      if (mode === "solidColor") {
        if (typeof d.color === "string" && d.color.trim().length > 0) {
          background.color = d.color.trim();
        }
        // Clear other mode-specific fields so upstream values don't "stick" via deepMerge.
        background.outlineWidthPx = undefined;
      } else if (mode === "dieCutStickerOutline") {
        if (typeof d.outlineWidthPx === "number" && Number.isFinite(d.outlineWidthPx)) {
          background.outlineWidthPx = d.outlineWidthPx;
        }
        // Clear other mode-specific fields so upstream values don't "stick" via deepMerge.
        background.color = undefined;
      } else {
        // transparent / scene (or any future modes that don't use these fields)
        // Explicitly clear so earlier nodes can't leak mode-specific values forward.
        background.color = undefined;
        background.outlineWidthPx = undefined;
      }

      // Back-compat: if other non-UI keys are present, ignore them unless they are
      // explicitly part of the background spec. (Prevents accidental leakage.)
      return {
        drawing_style: {
          background: {
            ...background,
          },
        },
      };
    }

    case "output": {
      const d = data as OutputNodeData;
      return {
        output: {
          format: d.format || "PNG",
          canvas_ratio: d.canvas_ratio || "1:1",
          ...Object.fromEntries(
            Object.entries(d).filter(
              ([k]) => k !== "label" && k !== "format" && k !== "canvas_ratio" && k !== "ui",
            )
          ),
        },
      };
    }

    default:
      return null;
  }
}

function normalizeTemplate(partial: Partial<FFAStyleTemplate>): FFAStyleTemplate {
  const template: Partial<FFAStyleTemplate> = { ...partial };

  if (!template.metadata) {
    template.metadata = { type: { category: "Images" } };
  }
  if (!template.metadata.type) {
    template.metadata.type = { category: "Images" };
  }
  if (!template.metadata.type.category) {
    template.metadata.type.category = "Images";
  }

  // Ensure object_specification exists
  if (!template.object_specification) {
    template.object_specification = { subject: "" };
  }

  // Ensure output exists
  if (!template.output) {
    template.output = { format: "PNG", canvas_ratio: "1:1" };
  }

  return template as FFAStyleTemplate;
}

function computeSubjectsFromOrderedNodes(ordered: Node<NodeData>[]): {
  subjectMode?: "single" | "multiple";
  subjects?: string[];
} {
  // Use the *last* subject node by deterministic order (later nodes overwrite earlier).
  for (let i = ordered.length - 1; i >= 0; i--) {
    const n = ordered[i];
    if (n?.type !== "subject") continue;
    const d = (n.data ?? {}) as SubjectNodeData;
    const mode: "single" | "multiple" = (d.mode ?? "single") === "multiple" ? "multiple" : "single";
    if (mode !== "multiple") return { subjectMode: "single" };
    const subjects = parseSubjectsText(d.subjectsText ?? "");
    return { subjectMode: "multiple", subjects };
  }
  return {};
}

// Compile graph to FFAStyles JSON template
export function compileGraph(
  nodes: Node<NodeData>[],
  edges: Edge[]
): CompileResult {
  const errors: CompileError[] = [];

  // Find root
  const root = findRootNode(nodes);
  if (!root) {
    return {
      template: null,
      errors: [{ message: "No template root node found. Add a Template Root node." }],
    };
  }

  // Get connected nodes in order
  const connectedNodes = getConnectedNodes(root.id, nodes, edges);
  const subjectsInfo = computeSubjectsFromOrderedNodes(connectedNodes);

  // Build template by merging patches
  let template: Partial<FFAStyleTemplate> = {};

  for (const node of connectedNodes) {
    const patch = nodeToPatch(node);
    if (patch) {
      template = deepMerge(template, patch) as Partial<FFAStyleTemplate>;
    }
  }

  return {
    template: normalizeTemplate(template),
    errors,
    ...subjectsInfo,
  };
}

/**
 * Compile only the nodes that feed into a specific target node.
 * Useful for "Compiler" and "Generate" nodes on the canvas.
 */
export function compileUpstream(
  targetNodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[]
): CompileResult {
  const errors: CompileError[] = [];
  const upstream = getUpstreamNodes(targetNodeId, nodes, edges);

  if (upstream.length === 0) {
    return {
      template: normalizeTemplate({}),
      errors: [{ message: "No inputs connected. Connect nodes into this Compiler/Generate node." }],
      subjectMode: "single",
    };
  }

  // Deterministic merge order: type priority, then id.
  const ordered = [...upstream].sort((a, b) => {
    const pa = typePriority(a.type);
    const pb = typePriority(b.type);
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  const subjectsInfo = computeSubjectsFromOrderedNodes(ordered);

  let template: Partial<FFAStyleTemplate> = {};
  for (const node of ordered) {
    const patch = nodeToPatch(node);
    if (patch) template = deepMerge(template, patch) as Partial<FFAStyleTemplate>;
  }

  return { template: normalizeTemplate(template), errors, ...subjectsInfo };
}

/**
 * The prompt we send to the image API.
 * You asked for "just the JSON prompt without parsing it", so we stringify the compiled template
 * as-is, optionally overriding only `object_specification.subject`.
 */
export function generateJsonPrompt(template: FFAStyleTemplate, subjectOverride?: string): string {
  const subj = (subjectOverride ?? "").trim();
  const next: FFAStyleTemplate =
    subj.length > 0
      ? {
          ...template,
          object_specification: {
            ...(template.object_specification ?? { subject: "" }),
            subject: subj,
          },
        }
      : template;

  // Keep it compact for tokens while still being valid JSON.
  return JSON.stringify(next);
}

