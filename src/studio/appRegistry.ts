import type React from "react";
import { Package, Wand2 } from "lucide-react";

export type StudioApp = {
  id: string;
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  loader: () => Promise<{ default: React.ComponentType<any> }>;
};

export const STUDIO_APPS: StudioApp[] = [
  {
    id: "style-builder",
    title: "Style Builder",
    description: "Build visual style graphs → compile JSON → generate images.",
    route: "/style-builder",
    icon: Wand2,
    loader: () => import("@/apps/styleBuilder/StyleBuilderApp"),
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

