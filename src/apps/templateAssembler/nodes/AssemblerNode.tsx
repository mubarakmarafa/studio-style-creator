import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { useCallback, useState } from "react";
import { useTemplateAssemblerCtx } from "../templateAssemblerContext";

export type AssemblerNodeData = {
  combinationCount?: number;
  validationError?: string | null;
  useLlmFill?: boolean;
};

// Back-compat: we may load older graphs that used "generateNode".
export type AssemblerFlowNode = Node<AssemblerNodeData, "assemblerNode" | "generateNode">;

export default function AssemblerNode(props: NodeProps<AssemblerFlowNode>) {
  const { requestGenerate, updateNodeData } = useTemplateAssemblerCtx();
  const count = Number(props.data?.combinationCount ?? 0);
  const err = (props.data?.validationError ?? null) as string | null;
  const useLlmFill = Boolean((props.data as any)?.useLlmFill ?? false);
  const [isGenerating, setIsGenerating] = useState(false);

  const onGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      await requestGenerate(props.id);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, props.id, requestGenerate]);

  return (
    <div className="rounded-xl border bg-card p-3 w-[280px]">
      <div className="text-xs text-muted-foreground">Output</div>
      <div className="font-semibold">Assembler</div>
      <div className="mt-2 text-sm">
        Templates: <span className="font-medium">{Number.isFinite(count) ? count : 0}</span>
      </div>

      {err ? (
        <div className="mt-2 text-xs p-2 rounded border bg-destructive/10 border-destructive/20 text-destructive">
          {err}
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">Click Generate to preview templates.</div>
      )}

      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={useLlmFill}
          onChange={(e) => updateNodeData(props.id, { useLlmFill: e.target.checked })}
        />
        Use AI to fill text
      </label>

      <button
        className="mt-2 w-full px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        onClick={onGenerate}
        disabled={isGenerating || Boolean(err) || !Number.isFinite(count) || count <= 0}
        title={err ? "Fix validation errors first" : "Generate preview templates"}
        aria-busy={isGenerating}
      >
        <span className="inline-flex items-center justify-center gap-2">
          {isGenerating ? (
            <svg
              aria-hidden="true"
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          ) : null}
          <span>{isGenerating ? "Generating…" : "Generate"}</span>
        </span>
      </button>

      <Handle type="target" position={Position.Left} />
    </div>
  );
}

