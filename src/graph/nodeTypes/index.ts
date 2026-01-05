import { BaseNode } from "./BaseNode";
import { ColorPaletteNode } from "./ColorPaletteNode";
import { CompilerNode } from "./CompilerNode";
import { GenerateNode } from "./GenerateNode";
import { ImageInputNode } from "./ImageInputNode";
import { ImageNode } from "./ImageNode";
import type { NodeTypes } from "@xyflow/react";

export const nodeTypes: NodeTypes = {
  default: BaseNode as any,
  templateRoot: BaseNode as any,
  subject: BaseNode as any,
  styleDescription: BaseNode as any,
  lineQuality: BaseNode as any,
  colorPalette: ColorPaletteNode as any,
  lighting: BaseNode as any,
  perspective: BaseNode as any,
  fillAndTexture: BaseNode as any,
  background: BaseNode as any,
  output: BaseNode as any,
  compiler: CompilerNode as any,
  generate: GenerateNode as any,
  imageInput: ImageInputNode as any,
  imageNode: ImageNode as any,
};

