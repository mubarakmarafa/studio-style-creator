import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { useMemo, useState } from "react";
import { useTemplateAssemblerCtx } from "../templateAssemblerContext";

export type ModuleSetNodeData = {
  // Legacy field (old UX used to target a specific slot). Kept for backwards compatibility.
  slotKey?: string;
  moduleIds?: string[];
};

// Back-compat: older graphs used "moduleSetNode". New graphs use "moduleNode".
export type ModuleSetFlowNode = Node<ModuleSetNodeData, "moduleNode" | "moduleSetNode">;

export default function ModuleSetNode(props: NodeProps<ModuleSetFlowNode>) {
  const { modules, updateNodeData } = useTemplateAssemblerCtx();
  const moduleIds = Array.isArray(props.data?.moduleIds) ? props.data?.moduleIds ?? [] : [];

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(moduleIds);
  const [query, setQuery] = useState("");

  const moduleNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const mod of modules) m.set(mod.id, mod.name || mod.id.slice(0, 8));
    return m;
  }, [modules]);

  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const id = m.id.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [modules, query]);

  const commit = (ids: string[]) => {
    const clean: string[] = [];
    for (const id of ids.map(String).map((s) => s.trim()).filter(Boolean)) {
      if (!clean.includes(id)) clean.push(id);
    }
    updateNodeData(props.id, { moduleIds: clean });
  };

  const toggle = (id: string) => {
    const next = moduleIds.includes(id) ? moduleIds.filter((x: string) => x !== id) : [...moduleIds, id];
    updateNodeData(props.id, { moduleIds: next });
  };

  return (
    <div className="rounded-xl border bg-card p-3 w-[300px]">
      <div className="text-xs text-muted-foreground">Required</div>
      <div className="font-semibold">Module</div>

      <div className="mt-2 text-xs text-muted-foreground">
        Select one or more modules. When connected, the Assembler will populate <span className="font-medium">all layout slots</span>{" "}
        from this pool.
      </div>

      <div className="mt-3 space-y-2">
        <label className="text-xs text-muted-foreground">Modules</label>

        <div className="flex flex-wrap gap-2">
          {moduleIds.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">None selected</div>
          ) : null}

          {moduleIds.map((id) => (
            <div
              key={id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-background text-xs max-w-full"
              title={id}
            >
              <span className="truncate max-w-[190px]">{moduleNameById.get(id) ?? id.slice(0, 8)}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => commit(moduleIds.filter((x) => x !== id))}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-muted/30 hover:bg-accent text-xs"
            onClick={() => {
              setDraftIds(moduleIds);
              setQuery("");
              setPickerOpen(true);
            }}
            title="Add modules"
          >
            + Add
          </button>
        </div>

        {pickerOpen ? (
          <div className="relative">
            <div className="absolute z-50 mt-2 w-full rounded-lg border bg-background shadow-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Select modules</div>
                <button
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => setPickerOpen(false)}
                >
                  Close
                </button>
              </div>

              <input
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search modules…"
              />

              <div className="max-h-44 overflow-auto border rounded">
                {filteredModules.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No matches.</div>
                ) : (
                  filteredModules.map((m) => {
                    const checked = draftIds.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/30"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setDraftIds((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                          }
                        />
                        <span className="truncate" title={m.name || m.id}>
                          {m.name || m.id.slice(0, 8)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-muted-foreground">Selected: {draftIds.length}</div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-xs border rounded hover:bg-accent"
                    onClick={() => {
                      setDraftIds(moduleIds);
                      setPickerOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs border rounded bg-primary text-primary-foreground hover:opacity-90"
                    onClick={() => {
                      commit(draftIds);
                      setPickerOpen(false);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* keep legacy toggle behavior accessible (not shown, but retained for safe future reuse) */}
        <div className="hidden">
          {modules.map((m) => {
            const checked = moduleIds.includes(m.id);
            return (
              <label key={m.id}>
                <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} />
              </label>
            );
          })}
        </div>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

