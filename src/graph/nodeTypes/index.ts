import { BaseNode } from "./BaseNode";
import { ImageInputNode } from "./ImageInputNode";
import { ImageNode } from "./ImageNode";
import type { NodeTypes } from "@xyflow/react";

export const nodeTypes: NodeTypes = {
  default: BaseNode as any,
  templateRoot: BaseNode as any,
  subject: BaseNode as any,
  styleDescription: BaseNode as any,
  lineQuality: BaseNode as any,
  colorPalette: BaseNode as any,
  lighting: BaseNode as any,
  perspective: BaseNode as any,
  fillAndTexture: BaseNode as any,
  background: BaseNode as any,
  output: BaseNode as any,
  imageInput: ImageInputNode as any,
  imageNode: ImageNode as any,
};

