import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
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
        onClick={() => requestGenerate(props.id)}
        disabled={Boolean(err) || !Number.isFinite(count) || count <= 0}
        title={err ? "Fix validation errors first" : "Generate preview templates"}
      >
        Generate
      </button>

      <Handle type="target" position={Position.Left} />
    </div>
  );
}

