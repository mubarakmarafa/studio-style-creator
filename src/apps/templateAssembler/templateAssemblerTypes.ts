export type AssemblyNodeType = "LayoutNode" | "ModuleNode" | "AssemblerNode";

export type TemplateAssemblyGraphV1 = {
  version: 1;
  nodes: any[]; // xyflow nodes
  edges: any[]; // xyflow edges
};

export type TemplateAssemblyRow = {
  id: string;
  client_id: string;
  name: string;
  description: string;
  graph_json: TemplateAssemblyGraphV1;
  created_at: string;
  updated_at: string;
};

