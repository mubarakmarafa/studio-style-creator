import type React from "react";
import { Construction, Package, Wand2 } from "lucide-react";

export type StudioApp = {
  id: string;
  title: string;
  description: string;
  route: string;
  navTo?: string;
  icon: React.ComponentType<{ className?: string }>;
  loader: () => Promise<{ default: React.ComponentType<any> }>;
};

export const STUDIO_APPS: StudioApp[] = [
  {
    id: "style-builder",
    title: "Style Builder",
    description: "Build visual style graphs → compile JSON → generate images.",
    route: "/style-builder/*",
    navTo: "/style-builder/projects",
    icon: Wand2,
    loader: () => import("@/apps/styleBuilder/StyleBuilderRouterApp"),
  },
  {
    id: "pack-creator",
    title: "Pack Creator",
    description: "Select a saved style + subject list → generate sticker packs in the background.",
    route: "/pack-creator",
    icon: Package,
    loader: () => import("@/apps/packCreator/PackCreatorApp"),
  },
];

export type WipStudioApp = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const WIP_STUDIO_APPS: WipStudioApp[] = [
  {
    id: "handwriting-synthesiser",
    title: "Handwriting Synthesiser",
    description: "Generate and refine handwriting styles for use across packs and templates.",
    icon: Construction,
  },
  {
    id: "template-module-forge",
    title: "Template Module Forge",
    description: "Create reusable template modules with consistent styling and constraints.",
    icon: Construction,
  },
  {
    id: "template-assembler",
    title: "Template Assembler",
    description: "Assemble templates from modules to quickly produce consistent layouts.",
    icon: Construction,
  },
  {
    id: "colour-palette-discoverer",
    title: "Colour Palette Discoverer",
    description: "Explore and save colour palettes tailored to a target aesthetic.",
    icon: Construction,
  },
  {
    id: "prompt-pack-writer",
    title: "Prompt Pack Writer",
    description: "Draft and organize prompt packs for repeatable generation workflows.",
    icon: Construction,
  },
];

