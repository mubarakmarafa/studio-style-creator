import { Node, Edge } from "@xyflow/react";

// FFAStyles JSON structure (based on your template library)
export interface FFAStyleTemplate {
  metadata?: {
    type?: {
      category?: "Strokes" | "Shapes" | "Elements / Stickers" | "Images";
    };
  };
  object_specification: {
    subject: string;
    [key: string]: unknown;
  };
  drawing_style?: {
    description?: string;
    perspective?: string;
    line_quality?: { type?: string; [key: string]: unknown };
    color_palette?: {
      range?: string;
      /**
       * Structured palette extracted from an image (hex values).
       * This is useful to persist for downstream generation or auditing.
       */
      hexes?: string[];
      /**
       * Optional provenance about how the palette was produced.
       */
      sourceImageNodeId?: string;
      extractionMethod?: string;
      extractedAt?: number;
      [key: string]: unknown;
    };
    lighting?: { type?: string; [key: string]: unknown };
    fill_and_texture?: { filled_areas?: string; [key: string]: unknown };
    textures?: { material_finish?: string; [key: string]: unknown };
    structure?: { perspective?: string; [key: string]: unknown };
    background?: { type?: string; style?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  output: {
    format: string;
    canvas_ratio: string;
    [key: string]: unknown;
  };
}

// Node type identifiers
export type NodeType =
  | "templateRoot"
  | "subject"
  | "styleDescription"
  | "lineQuality"
  | "colorPalette"
  | "lighting"
  | "perspective"
  | "fillAndTexture"
  | "background"
  | "output"
  | "compiler"
  | "generate"
  | "imageInput"
  | "imageNode"
  | "refine";

// Base node data structure
export interface BaseNodeData {
  label: string;
  [key: string]: unknown;
}

// Template Root Node
export interface TemplateRootNodeData extends BaseNodeData {
  category?: "Strokes" | "Shapes" | "Elements / Stickers" | "Images";
}

// Subject Node
export interface SubjectNodeData extends BaseNodeData {
  subject: string;
  constraints?: string;
}

// Style Description Node (freeform style text)
export interface StyleDescriptionNodeData extends BaseNodeData {
  description: string;
}

// Style Block Nodes
export interface LineQualityNodeData extends BaseNodeData {
  type: string;
  [key: string]: unknown;
}

export interface ColorPaletteNodeData extends BaseNodeData {
  range: string;
  hexes?: string[];
  sourceImageNodeId?: string;
  extractionMethod?: string;
  extractedAt?: number;
  [key: string]: unknown;
}

export interface LightingNodeData extends BaseNodeData {
  type: string;
  [key: string]: unknown;
}

export interface PerspectiveNodeData extends BaseNodeData {
  perspective: string;
  [key: string]: unknown;
}

export interface FillAndTextureNodeData extends BaseNodeData {
  filled_areas: string;
  [key: string]: unknown;
}

export interface BackgroundNodeData extends BaseNodeData {
  /**
   * Background mode. Kept as `type` to match existing compiler/autofill wiring.
   * Recommended values (used by the Background node UI):
   * - "scene"
   * - "solidColor"
   * - "dieCutStickerOutline"
   * - "transparent"
   */
  type: string;
  style?: string;
  /**
   * Optional solid background color (hex string).
   */
  color?: string;
  /**
   * Optional die-cut outline width in pixels (for sticker-style output).
   */
  outlineWidthPx?: number;
  [key: string]: unknown;
}

// Output Node
export interface OutputNodeData extends BaseNodeData {
  format: string;
  canvas_ratio: string;
  [key: string]: unknown;
}

// Image Input Node (uploaded images; used as input for LLM style extraction)
export interface ImageInputNodeData extends BaseNodeData {
  image: string; // data URL (e.g. data:image/png;base64,...)
  filename?: string;
  mimeType?: string;
  timestamp?: number;
}

// Image Node (for generated images on canvas)
export interface ImageNodeData extends BaseNodeData {
  image: string; // data URL or base64
  subject: string;
  compiledJson: FFAStyleTemplate;
  generationParams: {
    model: string;
    size: string;
  };
  timestamp: number;
  /**
   * UI-only (optional): allows showing a canvas placeholder while an image is being generated.
   */
  status?: "generating" | "ready" | "error";
}

// Compiler Node (compiles upstream nodes to JSON)
export interface CompilerNodeData extends BaseNodeData {
  /**
   * UI-only: whether to show the compiled JSON preview in the node.
   * (Keeps canvas tidy when you only want the node as a "compile step".)
   */
  showJson?: boolean;
}

// Generate Node (generates image directly inside the node)
export interface GenerateNodeData extends BaseNodeData {
  /**
   * Optional override. If empty, we use compiledJson.object_specification.subject.
   */
  subjectOverride?: string;
  /**
   * Persisted generated output so it's visible on reload (may be stripped if too large).
   */
  image?: string;
  /**
   * Debugging / UX info.
   */
  lastPrompt?: string;
  lastError?: string;
  lastGeneratedAt?: number;
  model?: string;
  size?: string;
}

// Refine Node (creates a new downstream branch using LLM feedback + images)
export interface RefineNodeData extends BaseNodeData {
  /**
   * User feedback about what to improve.
   */
  feedback: string;
  /**
   * Optional explicit selection for which node provides the "source" image.
   * If omitted, Refine will try to infer from connected nodes.
   */
  sourceImageNodeId?: string;
  /**
   * Optional explicit selection for which node provides the "generated" image.
   * If omitted, Refine will try to infer from connected nodes.
   */
  generatedImageNodeId?: string;
  /**
   * LLM model used for refinement (multimodal).
   */
  model?: string;
  /**
   * Persisted last refinement result (non-destructive; used for UI preview).
   */
  lastResult?: {
    improvedTemplate: FFAStyleTemplate;
    /**
     * Optional, extra guidance for updating node fields. Keys are node types or semantic groups.
     */
    nodeFieldEdits: Record<string, unknown>;
    notes?: string;
    createdNodeIds?: string[];
    createdEdgeIds?: string[];
  };
  lastError?: string;
  lastRefinedAt?: number;
}

// Union type for all node data
export type NodeData =
  | TemplateRootNodeData
  | SubjectNodeData
  | StyleDescriptionNodeData
  | LineQualityNodeData
  | ColorPaletteNodeData
  | LightingNodeData
  | PerspectiveNodeData
  | FillAndTextureNodeData
  | BackgroundNodeData
  | OutputNodeData
  | CompilerNodeData
  | GenerateNodeData
  | ImageInputNodeData
  | ImageNodeData
  | RefineNodeData;

// Graph document structure
export interface GraphDocument {
  version: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
}

// Default empty graph
export function createEmptyGraph(): GraphDocument {
  return {
    version: "1.0.0",
    nodes: [],
    edges: [],
  };
}

