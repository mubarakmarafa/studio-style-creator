import type { Node, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { useTemplateAssemblerCtx } from "../templateAssemblerContext";

export type PromptNodeData = {
  prompt?: string;
};

export type PromptFlowNode = Node<PromptNodeData, "promptNode">;

export default function PromptNode(props: NodeProps<PromptFlowNode>) {
  const { updateNodeData } = useTemplateAssemblerCtx();
  const prompt = String(props.data?.prompt ?? "");

  return (
    <div className="rounded-xl border bg-card p-3 w-[320px]">
      <div className="text-xs text-muted-foreground">Optional</div>
      <div className="font-semibold">Prompt</div>
      <div className="mt-2 text-xs text-muted-foreground">
        Describe the content you want (e.g. <span className="font-medium">meeting summary</span>). When connected (or present), the
        Assembler will inject text into module blocks during generation.
      </div>

      <div className="mt-3 space-y-1">
        <label className="text-xs text-muted-foreground">Prompt</label>
        <textarea
          className="w-full border rounded px-3 py-2 text-sm bg-background"
          rows={4}
          value={prompt}
          onChange={(e) => updateNodeData(props.id, { prompt: e.target.value })}
          placeholder="meeting summary"
        />
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

