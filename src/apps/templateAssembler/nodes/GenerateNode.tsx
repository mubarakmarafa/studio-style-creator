import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

export type GenerateNodeData = {
  combinationCount?: number;
  validationError?: string | null;
  onGenerateRequested?: boolean; // stored, but action triggered via app button outside node for now
};

export type GenerateFlowNode = Node<GenerateNodeData, "generateNode">;

export default function GenerateNode(props: NodeProps<GenerateFlowNode>) {
  const count = Number(props.data?.combinationCount ?? 0);
  const err = (props.data?.validationError ?? null) as string | null;

  return (
    <div className="rounded-xl border bg-card p-3 w-[260px]">
      <div className="text-xs text-muted-foreground">Output</div>
      <div className="font-semibold">Generate</div>
      <div className="mt-2 text-sm">
        Combinations: <span className="font-medium">{Number.isFinite(count) ? count : 0}</span>
      </div>
      {err ? (
        <div className="mt-2 text-xs p-2 rounded border bg-destructive/10 border-destructive/20 text-destructive">{err}</div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">Use the Generate button in the top bar.</div>
      )}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

