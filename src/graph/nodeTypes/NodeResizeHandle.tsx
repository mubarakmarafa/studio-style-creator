import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useReactFlow } from "@xyflow/react";
import { cn } from "@/lib/utils";

type NodeUi = {
  width?: number;
  height?: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function getNodeUiSize(data: unknown): NodeUi {
  const ui = (data as any)?.ui;
  const width = typeof ui?.width === "number" ? ui.width : undefined;
  const height = typeof ui?.height === "number" ? ui.height : undefined;
  return { width, height };
}

export function NodeResizeHandle({
  nodeId,
  selected,
  minWidth = 220,
  minHeight = 120,
  maxWidth = 1200,
  maxHeight = 900,
}: {
  nodeId: string;
  selected: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const rf = useReactFlow();
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!selected) return;

      const el = e.currentTarget.parentElement as HTMLElement | null;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
      };

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [selected],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragRef.current;
      if (!s || !selected) return;
      e.stopPropagation();

      const nextW = clamp(s.startW + (e.clientX - s.startX), minWidth, maxWidth);
      const nextH = clamp(s.startH + (e.clientY - s.startY), minHeight, maxHeight);

      rf.setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const prevUi = ((n.data as any)?.ui ?? {}) as NodeUi;
          return { ...n, data: { ...(n.data as any), ui: { ...prevUi, width: nextW, height: nextH } } };
        }),
      );

      // Ensures handles/edges update while resizing.
      (rf as any).updateNodeInternals?.(nodeId);
    },
    [maxHeight, maxWidth, minHeight, minWidth, nodeId, rf, selected],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  if (!selected) return null;

  return (
    <div
      className={cn(
        "nodrag absolute bottom-1 right-1 w-4 h-4 rounded-sm border border-foreground/20 bg-background/70",
        "cursor-se-resize hover:bg-accent",
      )}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}


