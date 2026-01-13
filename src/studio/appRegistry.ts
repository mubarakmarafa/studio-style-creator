import type React from "react";
import { Layers, LayoutGrid, Package, Wand2 } from "lucide-react";

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
    id: "module-forge",
    title: "Module Forge",
    description: "Create reusable layout modules and content modules for templates.",
    route: "/module-forge/*",
    navTo: "/module-forge/library",
    icon: Layers,
    loader: () => import("@/apps/moduleForge/ModuleForgeRouterApp"),
  },
  {
    id: "template-assembler",
    title: "Template Assembler",
    description: "Assemble templates from modules → enumerate combinations → batch-generate outputs.",
    route: "/template-assembler/*",
    navTo: "/template-assembler/assemblies",
    icon: LayoutGrid,
    loader: () => import("@/apps/templateAssembler/TemplateAssemblerRouterApp"),
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
    icon: Layers,
  },
  {
    id: "colour-palette-discoverer",
    title: "Colour Palette Discoverer",
    description: "Explore and save colour palettes tailored to a target aesthetic.",
    icon: LayoutGrid,
  },
  {
    id: "prompt-pack-writer",
    title: "Prompt Pack Writer",
    description: "Draft and organize prompt packs for repeatable generation workflows.",
    icon: Layers,
  },
];

