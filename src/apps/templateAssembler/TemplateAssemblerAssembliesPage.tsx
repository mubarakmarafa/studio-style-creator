import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/supabase";
import { getStudioClientId } from "@/studio/clientId";

type Row = {
  id: string;
  client_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export default function TemplateAssemblerAssembliesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("template_assemblies")
        .select("id,client_id,name,description,created_at,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createAssembly() {
    const cleaned = name.trim() || "Untitled assembly";
    setCreating(true);
    setErr(null);
    try {
      const clientId = getStudioClientId();
      const { data, error } = await supabase
        .from("template_assemblies")
        .insert({
          client_id: clientId,
          name: cleaned,
          description: "",
          graph_json: { version: 1, nodes: [], edges: [] },
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const id = String((data as any)?.id ?? "");
      if (!id) throw new Error("Create succeeded but no id returned.");
      navigate(`/template-assembler/edit/${encodeURIComponent(id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full w-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted-foreground">Template Assembler</div>
          <h1 className="text-2xl font-semibold tracking-tight">Assemblies</h1>
          <p className="text-sm text-muted-foreground">Build graphs that combine layouts + module sets and batch-generate templates.</p>
        </header>

        {err ? (
          <div className="p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-sm">{err}</div>
        ) : null}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={refresh}>
              Refresh
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-3 py-2 text-sm bg-background w-56"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New assembly name"
            />
            <button
              className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={createAssembly}
              disabled={creating}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((a) => (
              <Link
                key={a.id}
                to={`/template-assembler/edit/${encodeURIComponent(a.id)}`}
                className="border rounded-xl bg-card hover:bg-accent/30 transition-colors p-4"
              >
                <div className="font-semibold truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  Updated: {a.updated_at ? new Date(a.updated_at).toLocaleString() : "—"}
                </div>
              </Link>
            ))}
            {rows.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-xl p-4 bg-card">No assemblies yet.</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

