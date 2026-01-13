import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalSize = "md" | "lg" | "xl";

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
}) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const sizeClass =
    size === "xl"
      ? "w-[min(1120px,calc(100vw-2rem))]"
      : size === "lg"
        ? "w-[min(920px,calc(100vw-2rem))]"
        : "w-[min(720px,calc(100vw-2rem))]";

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onMouseDown={(e) => {
        // Close when clicking outside content.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className={`relative ${sizeClass} max-h-[calc(100vh-2rem)] overflow-auto rounded-xl border bg-background shadow-xl`}>
        <div className="p-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div id={titleId} className="text-base font-semibold">
                {title}
              </div>
              {description ? (
                <div id={descId} className="text-sm text-muted-foreground mt-1">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              className="text-sm px-2 py-1 border rounded hover:bg-accent"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

