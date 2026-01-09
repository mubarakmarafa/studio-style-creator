import { memo, useMemo, useRef } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { SubjectNodeData } from "../schema";
import { parseSubjectsCsv, parseSubjectsText } from "@/graph/subjects";
import { getNodeUiSize, NodeResizeHandle } from "./NodeResizeHandle";

function NodeHandles() {
  const common =
    "!w-5 !h-5 rounded-full bg-foreground/80 dark:bg-foreground/70 border-2 border-background pointer-events-auto z-50 cursor-crosshair";

  return (
    <>
      <Handle id="in" type="target" position={Position.Left} className={common} />
      <Handle id="out" type="source" position={Position.Right} className={common} />
    </>
  );
}

export const SubjectNode = memo(function SubjectNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const d = (data ?? {}) as SubjectNodeData;
  const ui = getNodeUiSize(data);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mode: "single" | "multiple" = (d.mode ?? "single") === "multiple" ? "multiple" : "single";
  const label = d.label || "Subject";

  const parsedSubjects = useMemo(() => {
    if (mode !== "multiple") return [];
    if (Array.isArray((d as any).subjects) && (d as any).subjects.length > 0) {
      return parseSubjectsText(((d as any).subjects as string[]).join("\n"));
    }
    return parseSubjectsText((d as any).subjectsText ?? "");
  }, [d, mode]);

  const updateNodeData = (updates: Partial<SubjectNodeData>) => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as any), ...updates } } : n)));
  };

  const preview = parsedSubjects.slice(0, 5);

  return (
    <div
      style={{
        width: ui.width,
        height: ui.height,
        minWidth: 240,
        minHeight: 140,
      }}
      className={cn(
        "relative px-3 py-2 shadow-lg rounded-md border-2 bg-white dark:bg-gray-800 flex flex-col",
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600",
      )}
    >
      <NodeHandles />
      <NodeResizeHandle nodeId={id} selected={selected} minWidth={240} minHeight={140} />

      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="font-semibold text-sm">{label}</div>
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "nodrag text-[11px] px-2 py-1 border rounded",
              mode === "single" ? "bg-accent" : "hover:bg-accent",
            )}
            onClick={(e) => {
              e.stopPropagation();
              updateNodeData({ mode: "single" } as any);
            }}
          >
            Single
          </button>
          <button
            className={cn(
              "nodrag text-[11px] px-2 py-1 border rounded",
              mode === "multiple" ? "bg-accent" : "hover:bg-accent",
            )}
            onClick={(e) => {
              e.stopPropagation();
              updateNodeData({ mode: "multiple" } as any);
            }}
          >
            Multiple
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-auto">
        {mode === "single" ? (
          <input
            className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
            value={d.subject ?? ""}
            placeholder="Subject"
            onChange={(e) => updateNodeData({ subject: e.target.value } as any)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <textarea
              className="nodrag w-full text-xs border rounded px-2 py-1 bg-background"
              value={(d as any).subjectsText ?? ""}
              placeholder="Multiple subjects (comma or newline separated)\ne.g. cat, dog, hamster"
              rows={4}
              onChange={(e) => updateNodeData({ subjectsText: e.target.value } as any)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  e.stopPropagation();
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const subjects = parseSubjectsCsv(text);
                  updateNodeData({
                    mode: "multiple",
                    subjectsText: subjects.join("\n"),
                    csvFilename: file.name,
                  } as any);
                  // Allow re-uploading same file by resetting value.
                  e.currentTarget.value = "";
                }}
              />
              <button
                className="nodrag text-[11px] px-2 py-1 border rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Upload CSV
              </button>
              {typeof (d as any).csvFilename === "string" && (d as any).csvFilename ? (
                <div className="text-[11px] text-muted-foreground truncate">CSV: {(d as any).csvFilename}</div>
              ) : (
                <div className="text-[11px] text-muted-foreground">First column used</div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground">
              Count: <span className="font-medium">{parsedSubjects.length}</span>
              {preview.length > 0 ? (
                <span className="ml-2">
                  Preview: <span className="font-medium">{preview.join(", ")}</span>
                  {parsedSubjects.length > preview.length ? "…" : ""}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
});


