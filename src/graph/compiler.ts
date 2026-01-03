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

export interface CompileError {
  message: string;
  nodeId?: string;
}

export interface CompileResult {
  template: FFAStyleTemplate | null;
  errors: CompileError[];
}

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
      return {
        object_specification: {
          subject: d.subject || "",
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
              Object.entries(d).filter(([k]) => k !== "label" && k !== "type")
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
              Object.entries(d).filter(([k]) => k !== "label" && k !== "range")
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
              Object.entries(d).filter(([k]) => k !== "label" && k !== "type")
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
              Object.entries(d).filter(([k]) => k !== "label" && k !== "filled_areas")
            ),
          },
        },
      };
    }

    case "background": {
      const d = data as BackgroundNodeData;
      return {
        drawing_style: {
          background: {
            type: d.type || "",
            ...(d.style ? { style: d.style } : {}),
            ...Object.fromEntries(
              Object.entries(d).filter(([k]) => k !== "label" && k !== "type" && k !== "style")
            ),
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
            Object.entries(d).filter(([k]) => k !== "label" && k !== "format" && k !== "canvas_ratio")
          ),
        },
      };
    }

    default:
      return null;
  }
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

  // Build template by merging patches
  let template: Partial<FFAStyleTemplate> = {};

  for (const node of connectedNodes) {
    const patch = nodeToPatch(node);
    if (patch) {
      template = deepMerge(template, patch) as Partial<FFAStyleTemplate>;
    }
  }

  // Minimal mode: keep compile permissive; generation UI can enforce subject etc.

  // Ensure object_specification exists
  if (!template.object_specification) {
    template.object_specification = { subject: "" };
  }

  // Ensure output exists
  if (!template.output) {
    template.output = { format: "PNG", canvas_ratio: "1:1" };
  }

  return {
    template: template as FFAStyleTemplate,
    errors,
  };
}

// Generate final prompt string from template (for image generation)
export function generatePrompt(template: FFAStyleTemplate, subject?: string): string {
  const subj = subject || template.object_specification.subject || "";
  const parts: string[] = [subj];

  if (template.drawing_style) {
    const style = template.drawing_style;
    if (style.description) parts.push(style.description);
    if (style.perspective) parts.push(style.perspective);
    if (style.line_quality?.type) parts.push(style.line_quality.type);
    if (style.color_palette?.range) parts.push(style.color_palette.range);
    if (style.lighting?.type) parts.push(style.lighting.type);
    if (style.fill_and_texture?.filled_areas) parts.push(style.fill_and_texture.filled_areas);
    if (style.textures?.material_finish) parts.push(style.textures.material_finish);
    if (style.background?.type) parts.push(`background: ${style.background.type}`);
  }

  return parts.filter(Boolean).join(", ");
}

