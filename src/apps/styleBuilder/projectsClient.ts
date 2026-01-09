import { supabase } from "@/supabase";

const CLIENT_ID_KEY = "styleBuilder:clientId";

function formatPostgrestError(e: any): string {
  if (!e) return "Unknown Supabase error";
  const message = typeof e.message === "string" ? e.message : "Supabase error";
  const details = typeof e.details === "string" && e.details.trim() ? e.details.trim() : "";
  const hint = typeof e.hint === "string" && e.hint.trim() ? e.hint.trim() : "";
  const code = typeof e.code === "string" && e.code.trim() ? e.code.trim() : "";
  return [message, details ? `Details: ${details}` : "", hint ? `Hint: ${hint}` : "", code ? `Code: ${code}` : ""]
    .filter(Boolean)
    .join("\n");
}

export type StyleBuilderProjectRow = {
  id: string;
  client_id: string;
  name: string;
  description: string;
  thumbnail_asset_id: string | null;
  created_at: string;
  updated_at: string;
};

export type StyleBuilderAssetRow = {
  id: string;
  project_id: string;
  kind: "uploaded" | "generated" | "thumbnail" | string;
  public_url: string | null;
  storage_bucket: string;
  storage_path: string;
  created_at: string;
};

export function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && typeof existing === "string" && existing.trim()) return existing;
  } catch {
    // ignore
  }
  const next = crypto.randomUUID();
  try {
    localStorage.setItem(CLIENT_ID_KEY, next);
  } catch {
    // ignore
  }
  return next;
}

export async function listProjects(clientId: string): Promise<StyleBuilderProjectRow[]> {
  const { data, error } = await supabase
    .from("style_builder_projects")
    .select("id,client_id,name,description,thumbnail_asset_id,created_at,updated_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []) as any;
}

export async function createProject(opts: {
  clientId: string;
  name?: string;
  description?: string;
  snapshot?: unknown;
}): Promise<StyleBuilderProjectRow> {
  const { data, error } = await supabase
    .from("style_builder_projects")
    .insert({
      client_id: opts.clientId,
      name: (opts.name ?? "Untitled project").trim() || "Untitled project",
      description: opts.description ?? "",
      snapshot:
        opts.snapshot ??
        ({
          version: "style-builder-project-v1",
          nodes: [],
          edges: [],
          subject: "",
          savedAt: Date.now(),
        } as any),
    } as any)
    .select("id,client_id,name,description,thumbnail_asset_id,created_at,updated_at")
    .single();
  if (error) throw new Error(formatPostgrestError(error));
  return data as any;
}

export async function renameProject(projectId: string, patch: { name?: string; description?: string }) {
  const { error } = await supabase
    .from("style_builder_projects")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    } as any)
    .eq("id", projectId);
  if (error) throw new Error(formatPostgrestError(error));
}

export async function deleteProject(projectId: string) {
  const { error } = await supabase.from("style_builder_projects").delete().eq("id", projectId);
  if (error) throw new Error(formatPostgrestError(error));
}

export async function getAssetsByIds(assetIds: string[]): Promise<StyleBuilderAssetRow[]> {
  if (assetIds.length === 0) return [];
  const { data, error } = await supabase
    .from("style_builder_assets")
    .select("id,project_id,kind,public_url,storage_bucket,storage_path,created_at")
    .in("id", assetIds as any);
  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []) as any;
}

export async function getLatestGeneratedAssetsByProjectIds(
  projectIds: string[],
): Promise<Array<Pick<StyleBuilderAssetRow, "id" | "project_id" | "public_url" | "created_at">>> {
  if (projectIds.length === 0) return [];
  const { data, error } = await supabase
    .from("style_builder_assets")
    .select("id,project_id,public_url,created_at")
    .in("project_id", projectIds as any)
    .eq("kind", "generated")
    .not("public_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []) as any;
}

export async function setProjectThumbnailAssetId(
  projectId: string,
  assetId: string,
  opts?: { onlyIfEmpty?: boolean },
) {
  const q = supabase
    .from("style_builder_projects")
    .update({ thumbnail_asset_id: assetId } as any)
    .eq("id", projectId);
  const final = opts?.onlyIfEmpty ? (q as any).is?.("thumbnail_asset_id", null) ?? q : q;
  const { error } = await final;
  if (error) throw new Error(formatPostgrestError(error));
}

