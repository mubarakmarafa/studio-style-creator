export type TemplateModuleKind = "layout" | "module";

export type ModuleForgeElementType =
  | "BackgroundTexture"
  | "Container"
  | "GridLines"
  | "Pattern"
  | "Header"
  | "Title"
  | "BodyText"
  | "Divider"
  | "Slot";

export type Rect = { x: number; y: number; w: number; h: number };

export type ModuleForgeElement = {
  id: string;
  type: ModuleForgeElementType;
  rect: Rect;
  zIndex: number;
  props: Record<string, any>;
};

export type ModuleForgeSpec = {
  version: 1;
  canvas: { w: number; h: number; unit: "pt" };
  kind: TemplateModuleKind;
  elements: ModuleForgeElement[];
  /**
   * Optional module-assist settings for `kind: "module"`.
   * These are editor-only helpers; module placement at assembly time uses element bounds, not the editor canvas.
   */
  moduleAssist?: {
    alignX?: "left" | "center" | "right";
    alignY?: "top" | "center" | "bottom";
  };
  /**
   * Optional layout-assist settings for `kind: "layout"`.
   * These are editor-only helpers; the canonical assembly-time source of truth is still `elements` (Slots with rects).
   */
  layoutAssist?: {
    mode: "grid" | "flex";
    padding: number;
    gap: number;
    // grid
    cols?: number;
    rows?: number;
    // flex
    direction?: "row" | "column";
    wrap?: boolean;
    count?: number;
    perLine?: number;
    crossSize?: number;
    // naming
    slotKeyBase?: string;
  };
};

export type TemplateModuleRow = {
  id: string;
  client_id: string;
  kind: TemplateModuleKind;
  name: string;
  spec_json: ModuleForgeSpec;
  preview_path: string | null;
  created_at: string;
  updated_at: string;
};

