import { createContext, useContext } from "react";

export type TemplateModuleListItem = {
  id: string;
  kind: "layout" | "module";
  name: string;
  spec_json: any;
};

export type TemplateAssemblerContextValue = {
  layouts: TemplateModuleListItem[];
  modules: TemplateModuleListItem[];
  updateNodeData: (nodeId: string, patch: Record<string, any>) => void;
  requestGenerate: (assemblerNodeId: string) => Promise<void>;
};

const Ctx = createContext<TemplateAssemblerContextValue | null>(null);

export function TemplateAssemblerProvider({
  value,
  children,
}: {
  value: TemplateAssemblerContextValue;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTemplateAssemblerCtx(): TemplateAssemblerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTemplateAssemblerCtx must be used within TemplateAssemblerProvider");
  return v;
}

