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
    color_palette?: { range?: string; [key: string]: unknown };
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
  | "imageNode";

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
  type: string;
  style?: string;
  [key: string]: unknown;
}

// Output Node
export interface OutputNodeData extends BaseNodeData {
  format: string;
  canvas_ratio: string;
  [key: string]: unknown;
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
  | ImageNodeData;

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

