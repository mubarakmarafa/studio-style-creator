import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./schema";

const STORAGE_KEY = "style-builder-workspace";
const STORAGE_VERSION = "1.0.0";

export type WorkspaceSnapshot = {
  version: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  subject?: string;
  savedAt: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;
  // Browser differences: name/code/message vary.
  return (
    anyErr?.name === "QuotaExceededError" ||
    anyErr?.code === 22 ||
    anyErr?.code === 1014 ||
    String(anyErr?.message || "").toLowerCase().includes("quota")
  );
}

function stripLargeImages(nodes: Node<NodeData>[]): Node<NodeData>[] {
  const MAX_DATA_URL_CHARS = 250_000; // ~250KB; helps stay under localStorage quotas

  return nodes.map((n) => {
    const data: any = n.data;
    const image: unknown = data?.image;
    if (typeof image !== "string") return n;

    const shouldStrip = image.startsWith("data:") && image.length > MAX_DATA_URL_CHARS;
    if (!shouldStrip) return n;

    return { ...n, data: { ...(n.data as any), image: "" } };
  });
}

export function loadWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return null;

    const version = typeof parsed.version === "string" ? parsed.version : "";
    const nodes = (parsed as any).nodes;
    const edges = (parsed as any).edges;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;

    const subject = typeof (parsed as any).subject === "string" ? (parsed as any).subject : undefined;
    const savedAt = typeof (parsed as any).savedAt === "number" ? (parsed as any).savedAt : 0;

    // Version check: we currently accept same-major format.
    if (!version) return null;

    return {
      version,
      nodes: nodes as Node<NodeData>[],
      edges: edges as Edge[],
      subject,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(snapshot: Omit<WorkspaceSnapshot, "version" | "savedAt">): void {
  const full: WorkspaceSnapshot = {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    ...snapshot,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch (e) {
    // If localStorage is full (common with big data URLs), retry with stripped images.
    if (isQuotaExceededError(e)) {
      try {
        const compact: WorkspaceSnapshot = {
          ...full,
          nodes: stripLargeImages(full.nodes),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
        console.warn(
          "[workspacePersistence] localStorage quota exceeded; saved workspace without large images."
        );
        return;
      } catch (e2) {
        console.error("[workspacePersistence] Failed to save workspace (even after stripping images):", e2);
        return;
      }
    }

    console.error("[workspacePersistence] Failed to save workspace:", e);
  }
}

export function clearWorkspaceSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("[workspacePersistence] Failed to clear workspace:", e);
  }
}


