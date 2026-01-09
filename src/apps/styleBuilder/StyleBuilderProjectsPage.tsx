import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createProject,
  deleteProject,
  getAssetsByIds,
  getLatestGeneratedAssetsByProjectIds,
  listProjects,
  renameProject,
  setProjectThumbnailAssetId,
  type StyleBuilderProjectRow,
} from "./projectsClient";

export default function StyleBuilderProjectsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<StyleBuilderProjectRow[]>([]);
  const [thumbsByAssetId, setThumbsByAssetId] = useState<Record<string, string>>({});

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const rows = await listProjects();
      const projectsWithThumb = rows;

      // 1) Load explicit thumbnail assets (fast path)
      const assetIds = rows.map((p) => p.thumbnail_asset_id).filter(Boolean) as string[];
      const assets = await getAssetsByIds(assetIds);
      const nextThumbs: Record<string, string> = {};
      for (const a of assets) {
        if (a.id && a.public_url) nextThumbs[a.id] = a.public_url;
      }

      // 2) Backfill: if a project has no thumbnail_asset_id, use its most recent generated image.
      // This helps older projects created before thumbnails were implemented.
      const missingThumbProjectIds = rows.filter((p) => !p.thumbnail_asset_id).map((p) => p.id);
      if (missingThumbProjectIds.length > 0) {
        const latest = await getLatestGeneratedAssetsByProjectIds(missingThumbProjectIds);
        const bestByProjectId = new Map<string, { assetId: string; url: string }>();
        for (const a of latest) {
          const pid = String(a.project_id ?? "");
          const aid = String(a.id ?? "");
          const url = typeof a.public_url === "string" ? a.public_url : "";
          if (!pid || !aid || !url) continue;
          if (!bestByProjectId.has(pid)) bestByProjectId.set(pid, { assetId: aid, url });
        }

        // Update local list + thumbs map for immediate UI.
        for (const [pid, { assetId, url }] of bestByProjectId.entries()) {
          nextThumbs[assetId] = url;
        }

        // Persist the backfill so other devices / future loads get the thumbnail_asset_id.
        // Best-effort: don't fail refresh if a project row can't be updated.
        void Promise.allSettled(
          Array.from(bestByProjectId.entries()).map(([pid, v]) =>
            setProjectThumbnailAssetId(pid, v.assetId, { onlyIfEmpty: true }),
          ),
        );
      }

      setProjects(projectsWithThumb);
      setThumbsByAssetId(nextThumbs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full w-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted-foreground">Content Studio</div>
          <h1 className="text-2xl font-semibold tracking-tight">Style Builder</h1>
          <p className="text-sm text-muted-foreground">Pick a project or create a new one.</p>
        </header>

        {err ? (
          <div className="p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-sm">
            {err}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              setErr(null);
              try {
                const p = await createProject({});
                navigate(`/style-builder/${p.id}`);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setCreating(false);
              }
            }}
          >
            {creating ? "Creating…" : "New project"}
          </button>
          <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={refresh}>
            Refresh
          </button>
          <Link className="px-3 py-2 text-sm border rounded hover:bg-accent" to="/home">
            Back to apps
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="border rounded-xl bg-card p-6 text-sm text-muted-foreground">
            No projects yet. Click <span className="font-medium">New project</span> to get started.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const thumbUrl =
                (p.thumbnail_asset_id ? thumbsByAssetId[p.thumbnail_asset_id] : null) ?? null;
              const isEditing = editingId === p.id;
              return (
                <div key={p.id} className="border rounded-xl bg-card overflow-hidden">
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={p.name}
                      className="w-full aspect-video object-cover border-b"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-muted/40 border-b" />
                  )}
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            className="w-full border rounded px-2 py-1 text-sm bg-background"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            placeholder="Project name"
                          />
                        ) : (
                          <div className="font-semibold truncate" title={p.name}>
                            {p.name}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          Updated: {new Date(p.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button
                              className="text-xs underline text-muted-foreground disabled:opacity-50"
                              disabled={savingName}
                              onClick={() => {
                                setEditingId(null);
                                setDraftName("");
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="text-xs underline text-primary disabled:opacity-50"
                              disabled={savingName}
                              onClick={async () => {
                                const next = draftName.trim();
                                if (!next) return;
                                setSavingName(true);
                                setErr(null);
                                try {
                                  await renameProject(p.id, { name: next });
                                  setEditingId(null);
                                  setDraftName("");
                                  await refresh();
                                } catch (e) {
                                  setErr(e instanceof Error ? e.message : String(e));
                                } finally {
                                  setSavingName(false);
                                }
                              }}
                            >
                              {savingName ? "Saving…" : "Save"}
                            </button>
                          </>
                        ) : (
                          <button
                            className="text-xs underline text-muted-foreground"
                            onClick={() => {
                              setEditingId(p.id);
                              setDraftName(p.name ?? "");
                            }}
                          >
                            Rename
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        className="flex-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
                        onClick={() => navigate(`/style-builder/${p.id}`)}
                      >
                        Open
                      </button>
                      <button
                        className="px-3 py-2 text-sm border rounded hover:bg-accent text-destructive"
                        onClick={async () => {
                          const ok = window.confirm(`Delete project "${p.name}"? This cannot be undone.`);
                          if (!ok) return;
                          setErr(null);
                          try {
                            await deleteProject(p.id);
                            await refresh();
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

