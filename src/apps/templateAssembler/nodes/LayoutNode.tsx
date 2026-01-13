import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { useMemo, useState } from "react";
import { useTemplateAssemblerCtx } from "../templateAssemblerContext";

export type LayoutNodeData = {
  // New: select multiple layouts in a single node.
  layoutIds?: string[];
  // Legacy (single-select).
  layoutId?: string;
};

export type LayoutFlowNode = Node<LayoutNodeData, "layoutNode">;

export default function LayoutNode(props: NodeProps<LayoutFlowNode>) {
  const { layouts, updateNodeData } = useTemplateAssemblerCtx();
  const legacy = String(props.data?.layoutId ?? "").trim();
  const selectedIds = Array.isArray(props.data?.layoutIds)
    ? (props.data?.layoutIds ?? []).map(String).map((s) => s.trim()).filter(Boolean)
    : legacy
      ? [legacy]
      : [];

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [query, setQuery] = useState("");

  const selectedNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of layouts) m.set(l.id, l.name || l.id.slice(0, 8));
    return m;
  }, [layouts]);

  const filteredLayouts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return layouts;
    return layouts.filter((l) => {
      const name = (l.name || "").toLowerCase();
      const id = l.id.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [layouts, query]);

  const commit = (ids: string[]) => {
    const clean: string[] = [];
    for (const id of ids.map(String).map((s) => s.trim()).filter(Boolean)) {
      if (!clean.includes(id)) clean.push(id);
    }
    updateNodeData(props.id, { layoutIds: clean, layoutId: clean[0] ?? "" });
  };

  return (
    <div className="rounded-xl border bg-card p-3 w-[260px]">
      <div className="text-xs text-muted-foreground">Required</div>
      <div className="font-semibold">Layout</div>

      <div className="mt-2 space-y-1">
        <label className="text-xs text-muted-foreground">Layouts</label>

        <div className="flex flex-wrap gap-2">
          {selectedIds.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">None selected</div>
          ) : null}

          {selectedIds.map((id) => (
            <div
              key={id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-background text-xs max-w-full"
              title={id}
            >
              <span className="truncate max-w-[160px]">{selectedNameById.get(id) ?? id.slice(0, 8)}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => commit(selectedIds.filter((x) => x !== id))}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-muted/30 hover:bg-accent text-xs"
            onClick={() => {
              setDraftIds(selectedIds);
              setQuery("");
              setPickerOpen(true);
            }}
            title="Add layouts"
          >
            + Add
          </button>
        </div>

        {pickerOpen ? (
          <div className="relative">
            <div className="absolute z-50 mt-2 w-full rounded-lg border bg-background shadow-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Select layouts</div>
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
                placeholder="Search layouts…"
              />

              <div className="max-h-44 overflow-auto border rounded">
                {filteredLayouts.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No matches.</div>
                ) : (
                  filteredLayouts.map((l) => {
                    const checked = draftIds.includes(l.id);
                    return (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/30"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setDraftIds((prev) =>
                              prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                            )
                          }
                        />
                        <span className="truncate" title={l.name || l.id}>
                          {l.name || l.id.slice(0, 8)}
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
                      setDraftIds(selectedIds);
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
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Tip: define slots in Module Forge using <span className="font-mono">Slot</span> elements.
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

