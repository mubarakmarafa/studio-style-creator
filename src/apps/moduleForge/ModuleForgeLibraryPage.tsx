import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/supabase";
import { getStudioClientId } from "@/studio/clientId";
import type { ModuleForgeSpec, TemplateModuleKind, TemplateModuleRow } from "./moduleForgeTypes";

type Row = Omit<TemplateModuleRow, "spec_json"> & { spec_json: any };

const DEFAULT_LAYOUT_CANVAS = { w: 612, h: 792, unit: "pt" as const }; // US Letter-ish @ 72dpi points
const DEFAULT_MODULE_CANVAS = { w: 640, h: 640, unit: "pt" as const };

function defaultSpec(kind: TemplateModuleKind): ModuleForgeSpec {
  return {
    version: 1,
    canvas: kind === "module" ? DEFAULT_MODULE_CANVAS : DEFAULT_LAYOUT_CANVAS,
    kind,
    elements: kind === "layout" ? [] : [],
  };
}

export default function ModuleForgeLibraryPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get("kind") ?? "all").toLowerCase() as "all" | TemplateModuleKind;

  const [rows, setRows] = useState<TemplateModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createKind, setCreateKind] = useState<TemplateModuleKind>("layout");

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("template_modules")
        .select("id,client_id,kind,name,spec_json,preview_path,created_at,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;

      setRows(
        ((data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          client_id: String((r as any).client_id ?? ""),
          kind: (String(r.kind) as TemplateModuleKind) || "module",
          name: String(r.name ?? ""),
          spec_json: (r.spec_json ?? {}) as any,
          preview_path: r.preview_path ? String(r.preview_path) : null,
          created_at: String(r.created_at ?? ""),
          updated_at: String(r.updated_at ?? ""),
        })),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    // keep `kind` query param sane
    if (filter !== "all" && filter !== "layout" && filter !== "module") {
      setSp({ kind: "all" }, { replace: true });
    }
  }, [filter, setSp]);

  // Keep the create kind aligned with the current filter (unless in "all", where it's user-chosen).
  useEffect(() => {
    if (filter === "layout" || filter === "module") setCreateKind(filter);
  }, [filter]);

  async function createModule() {
    const kind = createKind;
    const name = newName.trim() || (kind === "layout" ? "Untitled layout" : "Untitled module");
    setCreating(true);
    setErr(null);
    try {
      const clientId = getStudioClientId();
      const spec = defaultSpec(kind);
      const { data, error } = await supabase
        .from("template_modules")
        .insert({
          client_id: clientId,
          kind,
          name,
          spec_json: spec as any,
          preview_path: null,
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const id = String((data as any)?.id ?? "");
      if (!id) throw new Error("Create succeeded but no id returned.");
      navigate(`/module-forge/edit/${encodeURIComponent(id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function badgeClasses(kind: TemplateModuleKind): string {
    return kind === "layout"
      ? "bg-blue-100 text-blue-900 border-blue-200"
      : "bg-emerald-100 text-emerald-900 border-emerald-200";
  }

  return (
    <div className="h-full w-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted-foreground">Template Module Forge</div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">
            Create and edit reusable <span className="font-medium">layouts</span> and <span className="font-medium">modules</span>.
          </p>
        </header>

        {err ? (
          <div className="p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-sm">{err}</div>
        ) : null}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-2 text-sm border rounded ${filter === "all" ? "bg-accent" : "hover:bg-accent"}`}
              onClick={() => setSp({ kind: "all" })}
            >
              All
            </button>
            <button
              className={`px-3 py-2 text-sm border rounded ${filter === "layout" ? "bg-accent" : "hover:bg-accent"}`}
              onClick={() => setSp({ kind: "layout" })}
            >
              Layouts
            </button>
            <button
              className={`px-3 py-2 text-sm border rounded ${filter === "module" ? "bg-accent" : "hover:bg-accent"}`}
              onClick={() => setSp({ kind: "module" })}
            >
              Modules
            </button>
            <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={refresh}>
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-2">
            {filter === "all" ? (
              <div className="flex items-center gap-1 border rounded bg-background p-1">
                <button
                  className={`px-2 py-1 text-xs border rounded ${createKind === "layout" ? "bg-accent" : "hover:bg-accent"}`}
                  onClick={() => setCreateKind("layout")}
                  type="button"
                >
                  Layout
                </button>
                <button
                  className={`px-2 py-1 text-xs border rounded ${createKind === "module" ? "bg-accent" : "hover:bg-accent"}`}
                  onClick={() => setCreateKind("module")}
                  type="button"
                >
                  Module
                </button>
              </div>
            ) : null}
            <input
              className="border rounded px-3 py-2 text-sm bg-background w-56"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={createKind === "layout" ? "New layout name" : "New module name"}
            />
            <button
              className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={createModule}
              disabled={creating}
            >
              {creating ? "Creating…" : createKind === "layout" ? "Create layout" : "Create module"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((m) => (
              <Link
                key={m.id}
                to={`/module-forge/edit/${encodeURIComponent(m.id)}`}
                className="border rounded-xl bg-card hover:bg-accent/30 transition-colors p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${badgeClasses(m.kind)} uppercase tracking-wide`}>
                    {m.kind}
                  </span>
                </div>
                <div className="font-semibold mt-1 truncate">{m.name || "Untitled"}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  Updated: {m.updated_at ? new Date(m.updated_at).toLocaleString() : "—"}
                </div>
              </Link>
            ))}
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-xl p-4 bg-card">
                No {filter === "layout" ? "layouts" : filter === "module" ? "modules" : "items"} yet.
              </div>
            ) : null}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Tip: Layouts define slots. Modules are reusable content blocks that can be plugged into slots during assembly.
        </div>
      </div>
    </div>
  );
}

