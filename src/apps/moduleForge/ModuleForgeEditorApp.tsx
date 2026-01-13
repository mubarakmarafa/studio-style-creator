import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/supabase";
import { getStudioClientId } from "@/studio/clientId";
import type { ModuleForgeElement, ModuleForgeElementType, ModuleForgeSpec, TemplateModuleKind } from "./moduleForgeTypes";
import { clamp, nanoid, safeJsonParse } from "./moduleForgeUtils";

const LAST_MODULE_FORGE_ID_KEY = "moduleForge:lastModuleId";

const DEFAULT_LAYOUT_CANVAS = { w: 612, h: 792, unit: "pt" as const };
const DEFAULT_MODULE_CANVAS = { w: 640, h: 640, unit: "pt" as const };

const MODULE_STACK_PADDING = 24;
const MODULE_STACK_GAP = 12;

type ModuleLayoutPreset = "fixed" | "fill" | "fit";

function isModuleStackableType(t: ModuleForgeElementType): boolean {
  // We only “stack-layout” these; everything else is considered legacy/non-stacked.
  return t === "Header" || t === "Title" || t === "BodyText" || t === "Divider" || t === "Pattern";
}

function getLayoutPreset(e: ModuleForgeElement): ModuleLayoutPreset {
  const p = String(e.props?.layoutPreset ?? "").toLowerCase();
  if (p === "fill") return "fill";
  if (p === "fit") return "fit";
  return "fixed";
}

function moduleStackLayout(
  elements: ModuleForgeElement[],
  canvasW: number,
  canvasH: number,
): { stacked: ModuleForgeElement[]; legacy: ModuleForgeElement[] } {
  const stacked = elements
    .filter((e) => isModuleStackableType(e.type))
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex);
  const legacy = elements.filter((e) => !isModuleStackableType(e.type)).slice().sort((a, b) => a.zIndex - b.zIndex);

  const pad = MODULE_STACK_PADDING;
  const gap = MODULE_STACK_GAP;
  const innerW = Math.max(1, canvasW - pad * 2);
  const innerH = Math.max(1, canvasH - pad * 2);

  const fixedHeights: number[] = [];
  const fillIdx: number[] = [];

  for (let i = 0; i < stacked.length; i++) {
    const e = stacked[i];
    const preset = getLayoutPreset(e);
    if (preset === "fill") {
      fillIdx.push(i);
      fixedHeights.push(0);
      continue;
    }
    if (preset === "fit") {
      // "fit" shrinks to a reasonable intrinsic height (real fit-to-text happens at assembly time).
      if (e.type === "Divider") {
        fixedHeights.push(Math.max(1, Number(e.props?.thickness ?? 2)));
        continue;
      }
      if (e.type === "Pattern") {
        const spacing = Math.max(6, Number(e.props?.spacing ?? 16) || 16);
        fixedHeights.push(Math.max(24, Math.min(innerH, spacing * 6)));
        continue;
      }
      // Text-ish defaults
      fixedHeights.push(e.type === "Header" ? 44 : e.type === "Title" ? 36 : 72);
      continue;
    }
    if (e.type === "Divider") {
      const thickness = Math.max(1, Number(e.props?.thickness ?? 2));
      fixedHeights.push(thickness);
      continue;
    }
    fixedHeights.push(Math.max(1, Number(e.rect?.h ?? 40)));
  }

  const gapsTotal = stacked.length > 0 ? gap * (stacked.length - 1) : 0;
  const fixedTotal = fixedHeights.reduce((s, h) => s + h, 0);
  const remaining = Math.max(1, innerH - gapsTotal - fixedTotal);
  const fillH = fillIdx.length > 0 ? Math.max(1, remaining / fillIdx.length) : 0;

  let y = pad;
  const laidOut: ModuleForgeElement[] = [];
  for (let i = 0; i < stacked.length; i++) {
    const e = stacked[i];
    const preset = getLayoutPreset(e);
    const h =
      preset === "fill"
        ? fillH
        : e.type === "Divider"
          ? Math.max(1, Number(e.props?.thickness ?? 2))
          : fixedHeights[i];
    laidOut.push({
      ...e,
      rect: { x: pad, y: y, w: innerW, h: h },
    });
    y += h + gap;
  }

  return { stacked: laidOut, legacy };
}

function computeBounds(elements: ModuleForgeElement[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const e of elements) {
    const r = e.rect as any;
    const x = Number(r?.x);
    const y = Number(r?.y);
    const w = Number(r?.w);
    const h = Number(r?.h);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    if (w <= 0 || h <= 0) continue;
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

function moduleAutoCanvas(spec: ModuleForgeSpec): { w: number; h: number; dx: number; dy: number } {
  // Auto-fit modules to content; canvas is just an editing surface.
  const MIN = 520;
  const PAD = 48;
  const b = computeBounds(spec.elements);
  if (!b) return { w: Math.max(MIN, DEFAULT_MODULE_CANVAS.w), h: Math.max(MIN, DEFAULT_MODULE_CANVAS.h), dx: PAD, dy: PAD };

  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const size = Math.max(MIN, bw + PAD * 2, bh + PAD * 2);

  const alignX = spec.moduleAssist?.alignX ?? "center";
  const alignY = spec.moduleAssist?.alignY ?? "center";

  // Position the content in a square canvas.
  const dx =
    alignX === "left"
      ? PAD - b.minX
      : alignX === "right"
        ? size - PAD - bw - b.minX
        : (size - bw) / 2 - b.minX;
  const dy =
    alignY === "top"
      ? PAD - b.minY
      : alignY === "bottom"
        ? size - PAD - bh - b.minY
        : (size - bh) / 2 - b.minY;
  return { w: size, h: size, dx, dy };
}

function defaultSpec(kind: TemplateModuleKind): ModuleForgeSpec {
  const defaultModuleElements = (): ModuleForgeElement[] => {
    const h = elementDefaults("Header");
    const b = elementDefaults("BodyText");
    const d = elementDefaults("Divider");
    return [
      { id: nanoid("el"), type: "Header", rect: h.rect, props: h.props, zIndex: 1 },
      { id: nanoid("el"), type: "BodyText", rect: b.rect, props: b.props, zIndex: 2 },
      { id: nanoid("el"), type: "Divider", rect: d.rect, props: d.props, zIndex: 3 },
    ];
  };
  return {
    version: 1,
    canvas: kind === "module" ? DEFAULT_MODULE_CANVAS : DEFAULT_LAYOUT_CANVAS,
    kind,
    elements: kind === "module" ? defaultModuleElements() : [],
  };
}

function elementDefaults(type: ModuleForgeElementType): Pick<ModuleForgeElement, "rect" | "props"> {
  switch (type) {
    case "BackgroundTexture":
      return { rect: { x: 0, y: 0, w: 612, h: 792 }, props: { fill: "#f8fafc" } };
    case "GridLines":
      return { rect: { x: 0, y: 0, w: 612, h: 792 }, props: { cols: 6, rows: 8, stroke: "#e5e7eb" } };
    case "Pattern":
      return {
        rect: { x: 48, y: 340, w: 516, h: 200 },
        props: {
          variant: "grid", // lines | grid | dots | blank
          stroke: "#e5e7eb",
          spacing: 16,
          outline: false,
          outlineThickness: 2,
          layoutPreset: "fill",
        },
      };
    case "Header":
      return {
        rect: { x: 48, y: 48, w: 516, h: 44 },
        props: { layoutPreset: "fixed", fontSize: 24, fontWeight: 700, textAlign: "left", lineHeight: 1.2 },
      };
    case "Title":
      return { rect: { x: 48, y: 108, w: 516, h: 36 }, props: { layoutPreset: "fixed" } };
    case "BodyText":
      return {
        rect: { x: 48, y: 160, w: 516, h: 120 },
        props: { layoutPreset: "fill", fontSize: 12, fontWeight: 400, textAlign: "left", lineHeight: 1.35 },
      };
    case "Divider":
      return { rect: { x: 48, y: 300, w: 516, h: 2 }, props: { stroke: "#e5e7eb", thickness: 2, layoutPreset: "fixed" } };
    case "Container":
      return { rect: { x: 48, y: 340, w: 516, h: 200 }, props: { stroke: "#d1d5db", radius: 12 } };
    case "Slot":
      return { rect: { x: 48, y: 560, w: 516, h: 160 }, props: { slotKey: "slot_1" } };
    default:
      return { rect: { x: 48, y: 48, w: 200, h: 80 }, props: {} };
  }
}

function renderSvgPreview(spec: ModuleForgeSpec): string {
  const viewport =
    spec.kind === "module"
      ? moduleAutoCanvas(spec)
      : { w: spec.canvas.w, h: spec.canvas.h, dx: 0, dy: 0 };
  const { w, h, dx, dy } = viewport;

  const els = [...spec.elements].sort((a, b) => a.zIndex - b.zIndex);
  const svgEls = els
    .map((e) => {
      const { x, y, w: ew, h: eh } = e.rect;
      const rx = x + dx;
      const ry = y + dy;
      if (e.type === "BackgroundTexture") {
        const fill = String(e.props?.fill ?? "#ffffff");
        return `<rect x="${rx}" y="${ry}" width="${ew}" height="${eh}" fill="${fill}" />`;
      }
      if (e.type === "GridLines") {
        const cols = Math.max(1, Number(e.props?.cols ?? 6));
        const rows = Math.max(1, Number(e.props?.rows ?? 8));
        const stroke = String(e.props?.stroke ?? "#e5e7eb");
        const lines: string[] = [];
        for (let i = 1; i < cols; i++) {
          const lx = rx + (ew / cols) * i;
          lines.push(`<line x1="${lx}" y1="${ry}" x2="${lx}" y2="${ry + eh}" stroke="${stroke}" stroke-width="1" />`);
        }
        for (let j = 1; j < rows; j++) {
          const ly = ry + (eh / rows) * j;
          lines.push(`<line x1="${rx}" y1="${ly}" x2="${rx + ew}" y2="${ly}" stroke="${stroke}" stroke-width="1" />`);
        }
        return lines.join("");
      }
      if (e.type === "Pattern") {
        const variant = String(e.props?.variant ?? "grid").toLowerCase();
        const stroke = String(e.props?.stroke ?? "#e5e7eb");
        const outline = Boolean(e.props?.outline ?? false);
        const outlineThickness = Math.max(0, Number(e.props?.outlineThickness ?? 2) || 0);
        const spacing = Math.max(6, Number(e.props?.spacing ?? (variant === "dots" ? 12 : variant === "grid" ? 16 : 16)) || 16);

        const parts: string[] = [];
        // background (transparent) — patterns are drawn as strokes
        if (variant === "lines") {
          // Ruled paper: horizontal lines
          for (let gy = ry + spacing; gy < ry + eh; gy += spacing) {
            parts.push(`<line x1="${rx}" y1="${gy}" x2="${rx + ew}" y2="${gy}" stroke="${stroke}" stroke-width="1" />`);
          }
        } else if (variant === "grid") {
          for (let gx = rx + spacing; gx < rx + ew; gx += spacing) {
            parts.push(`<line x1="${gx}" y1="${ry}" x2="${gx}" y2="${ry + eh}" stroke="${stroke}" stroke-width="1" />`);
          }
          for (let gy = ry + spacing; gy < ry + eh; gy += spacing) {
            parts.push(`<line x1="${rx}" y1="${gy}" x2="${rx + ew}" y2="${gy}" stroke="${stroke}" stroke-width="1" />`);
          }
        } else if (variant === "dots") {
          const r = 1.2;
          for (let gx = rx + spacing / 2; gx < rx + ew; gx += spacing) {
            for (let gy = ry + spacing / 2; gy < ry + eh; gy += spacing) {
              parts.push(`<circle cx="${gx}" cy="${gy}" r="${r}" fill="${stroke}" />`);
            }
          }
        } else {
          // blank: nothing
        }

        if (outline && outlineThickness > 0) {
          parts.push(
            `<rect x="${rx}" y="${ry}" width="${ew}" height="${eh}" fill="none" stroke="${stroke}" stroke-width="${outlineThickness}" />`,
          );
        }
        return parts.join("");
      }
      if (e.type === "Divider") {
        const stroke = String(e.props?.stroke ?? "#e5e7eb");
        const thickness = Math.max(1, Number(e.props?.thickness ?? 2));
        return `<rect x="${rx}" y="${ry}" width="${ew}" height="${Math.max(1, thickness)}" fill="${stroke}" />`;
      }
      if (e.type === "Container") {
        const stroke = String(e.props?.stroke ?? "#d1d5db");
        const radius = Math.max(0, Number(e.props?.radius ?? 12));
        return `<rect x="${rx}" y="${ry}" width="${ew}" height="${eh}" rx="${radius}" ry="${radius}" fill="none" stroke="${stroke}" stroke-width="2" />`;
      }
      if (e.type === "Slot") {
        const slotKey = String(e.props?.slotKey ?? "slot");
        // dotted stroke for slots
        return `<rect x="${rx}" y="${ry}" width="${ew}" height="${eh}" fill="none" stroke="#60a5fa" stroke-dasharray="1 6" stroke-linecap="round" stroke-width="2" />
          <text x="${rx + 8}" y="${ry + 20}" font-size="12" fill="#2563eb">${slotKey}</text>`;
      }
      if (e.type === "Header" || e.type === "Title" || e.type === "BodyText") {
        const text = String(e.props?.text ?? e.type);
        const fontSize = Math.max(8, Number(e.props?.fontSize ?? (e.type === "BodyText" ? 12 : e.type === "Title" ? 18 : 24)) || 12);
        const fontWeight = Number(e.props?.fontWeight ?? (e.type === "Header" ? 700 : 400)) || (e.type === "Header" ? 700 : 400);
        const color = String(e.props?.color ?? "#111827");
        const align = String(e.props?.textAlign ?? "left").toLowerCase();
        const pad = 6;
        const x = align === "center" ? rx + ew / 2 : align === "right" ? rx + ew - pad : rx + pad;
        const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
        return `<text x="${x}" y="${ry + pad + fontSize}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anchor}" fill="${color}">${escapeXml(text)}</text>`;
      }
      return `<rect x="${rx}" y="${ry}" width="${ew}" height="${eh}" fill="rgba(0,0,0,0.02)" stroke="#e5e7eb" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svgEls}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export default function ModuleForgeEditorApp() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const initialKind = ((sp.get("kind") ?? "layout").toLowerCase() as TemplateModuleKind) || "layout";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<TemplateModuleKind>(initialKind);
  const [spec, setSpec] = useState<ModuleForgeSpec>(() => defaultSpec(initialKind));

  const [layoutMode, setLayoutMode] = useState<"grid" | "flex">("grid");
  const [layoutPadding, setLayoutPadding] = useState<number>(24);
  const [layoutGap, setLayoutGap] = useState<number>(16);
  const [layoutCols, setLayoutCols] = useState<number>(2);
  const [layoutRows, setLayoutRows] = useState<number>(2);
  const [flexDirection, setFlexDirection] = useState<"row" | "column">("row");
  const [flexWrap, setFlexWrap] = useState<boolean>(true);
  const [flexCount, setFlexCount] = useState<number>(6);
  const [flexPerLine, setFlexPerLine] = useState<number>(3);
  const [flexCrossSize, setFlexCrossSize] = useState<number>(160);
  const [slotKeyBase, setSlotKeyBase] = useState<string>("slot");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => spec.elements.find((e) => e.id === selectedId) ?? null, [spec.elements, selectedId]);
  const moduleViewport = useMemo(() => (kind === "module" ? moduleAutoCanvas(spec) : null), [kind, spec]);
  // For module editing, we want a stable “available space” to distribute Fill heights within.
  const canvasW = spec.canvas.w;
  const canvasH = spec.canvas.h;
  // (kept for legacy module preview assist; not applied to the module editor canvas anymore)
  const canvasDx = kind === "module" ? (moduleViewport?.dx ?? 0) : 0;
  const canvasDy = kind === "module" ? (moduleViewport?.dy ?? 0) : 0;

  const moduleLayout = useMemo(() => (kind === "module" ? moduleStackLayout(spec.elements, canvasW, canvasH) : null), [
    kind,
    spec.elements,
    canvasW,
    canvasH,
  ]);

  // Keep stored rects in sync with the stacked module layout so downstream renderers (SVG/PDF) stay correct.
  useEffect(() => {
    if (kind !== "module") return;
    const laidOut = moduleLayout?.stacked ?? null;
    if (!laidOut) return;
    setSpec((prev) => {
      const nextEls = prev.elements.map((e) => {
        if (!isModuleStackableType(e.type)) return e;
        const n = laidOut.find((x) => x.id === e.id);
        if (!n) return e;
        // Module editor is primarily structural; keep minimal style props (typography for Header/BodyText) but strip content.
        const preset = getLayoutPreset(e);
        const nextProps: Record<string, any> =
          e.type === "Divider"
            ? {
                layoutPreset: preset,
                stroke: String(e.props?.stroke ?? "#e5e7eb"),
                thickness: Math.max(1, Number(e.props?.thickness ?? 2)),
              }
            : e.type === "Pattern"
              ? {
                  layoutPreset: preset,
                  variant: String(e.props?.variant ?? "grid"),
                  stroke: String(e.props?.stroke ?? "#e5e7eb"),
                  spacing: Math.max(6, Number(e.props?.spacing ?? 16) || 16),
                  outline: Boolean(e.props?.outline ?? false),
                  outlineThickness: Math.max(0, Number(e.props?.outlineThickness ?? 2) || 0),
                }
              : e.type === "Header" || e.type === "BodyText" || e.type === "Title"
                ? {
                    layoutPreset: preset,
                    fontSize: Math.max(8, Number(e.props?.fontSize ?? (e.type === "BodyText" ? 12 : e.type === "Title" ? 18 : 24)) || 12),
                    fontWeight: Number(e.props?.fontWeight ?? (e.type === "Header" ? 700 : 400)) || (e.type === "Header" ? 700 : 400),
                    textAlign: String(e.props?.textAlign ?? "left"),
                    lineHeight: Math.max(1, Number(e.props?.lineHeight ?? (e.type === "BodyText" ? 1.35 : e.type === "Title" ? 1.25 : 1.2)) || 1.2),
                    color: String(e.props?.color ?? "#111827"),
                  }
            : { layoutPreset: preset };
        const r1 = e.rect;
        const r2 = n.rect;
        const sameRect =
          Number(r1?.x) === Number(r2?.x) &&
          Number(r1?.y) === Number(r2?.y) &&
          Number(r1?.w) === Number(r2?.w) &&
          Number(r1?.h) === Number(r2?.h);
        const p1 = e.props ?? {};
        const sameProps =
          e.type === "Divider"
            ? String(p1.layoutPreset ?? "fixed") === String(nextProps.layoutPreset ?? "fixed") &&
              String(p1.stroke ?? "#e5e7eb") === String(nextProps.stroke) &&
              Math.max(1, Number(p1.thickness ?? 2)) === Number(nextProps.thickness)
            : e.type === "Pattern"
              ? String(p1.layoutPreset ?? "fixed") === String(nextProps.layoutPreset ?? "fixed") &&
                String(p1.variant ?? "grid") === String(nextProps.variant ?? "grid") &&
                String(p1.stroke ?? "#e5e7eb") === String(nextProps.stroke ?? "#e5e7eb") &&
                Math.max(6, Number(p1.spacing ?? 16) || 16) === Number(nextProps.spacing ?? 16) &&
                Boolean(p1.outline ?? false) === Boolean(nextProps.outline ?? false) &&
                Math.max(0, Number(p1.outlineThickness ?? 2) || 0) === Number(nextProps.outlineThickness ?? 2)
              : e.type === "Header" || e.type === "BodyText" || e.type === "Title"
                ? String(p1.layoutPreset ?? "fixed") === String(nextProps.layoutPreset ?? "fixed") &&
                  Math.max(8, Number(p1.fontSize ?? 12) || 12) === Number(nextProps.fontSize ?? 12) &&
                  Number(p1.fontWeight ?? 400) === Number(nextProps.fontWeight ?? 400) &&
                  String(p1.textAlign ?? "left") === String(nextProps.textAlign ?? "left") &&
                  Math.max(1, Number(p1.lineHeight ?? 1.2) || 1.2) === Number(nextProps.lineHeight ?? 1.2) &&
                  String(p1.color ?? "#111827") === String(nextProps.color ?? "#111827")
            : String(p1.layoutPreset ?? "fixed") === String(nextProps.layoutPreset ?? "fixed") &&
              Object.keys(p1).every((k) => k === "layoutPreset");
        if (sameRect && sameProps) return e;
        return { ...e, rect: r2, props: nextProps };
      });
      // Avoid extra renders if nothing changed.
      const changed = nextEls.some((e, i) => e !== prev.elements[i]);
      return changed ? { ...prev, elements: nextEls } : prev;
    });
  }, [kind, moduleLayout]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [draggingElementId, setDraggingElementId] = useState<string | null>(null);
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);

  // Delete selected element with keyboard (safe around text inputs).
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (!selectedId) return;
      if (ev.key !== "Backspace" && ev.key !== "Delete") return;
      const t = ev.target as HTMLElement | null;
      const tag = String((t as any)?.tagName ?? "").toLowerCase();
      const isEditable =
        tag === "input" || tag === "textarea" || tag === "select" || Boolean((t as any)?.isContentEditable);
      if (isEditable) return;
      ev.preventDefault();
      removeSelected();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  // Keep editor-assist controls seeded from spec when possible.
  useEffect(() => {
    const a = spec.layoutAssist;
    if (!a) return;
    if (a.mode === "grid" || a.mode === "flex") setLayoutMode(a.mode);
    if (Number.isFinite(a.padding as any)) setLayoutPadding(Number(a.padding));
    if (Number.isFinite(a.gap as any)) setLayoutGap(Number(a.gap));
    if (Number.isFinite(a.cols as any)) setLayoutCols(Math.max(1, Number(a.cols)));
    if (Number.isFinite(a.rows as any)) setLayoutRows(Math.max(1, Number(a.rows)));
    if (a.direction === "row" || a.direction === "column") setFlexDirection(a.direction);
    if (typeof a.wrap === "boolean") setFlexWrap(a.wrap);
    if (Number.isFinite(a.count as any)) setFlexCount(Math.max(1, Number(a.count)));
    if (Number.isFinite(a.perLine as any)) setFlexPerLine(Math.max(1, Number(a.perLine)));
    if (Number.isFinite(a.crossSize as any)) setFlexCrossSize(Math.max(1, Number(a.crossSize)));
    if (typeof a.slotKeyBase === "string" && a.slotKeyBase.trim()) setSlotKeyBase(a.slotKeyBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.layoutAssist]);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      if (!moduleId) {
        setName(kind === "layout" ? "Untitled layout" : "Untitled module");
        setSpec(defaultSpec(kind));
        setSelectedId(null);
        return;
      }

      const clientId = getStudioClientId();
      const { data, error } = await supabase
        .from("template_modules")
        .select("id,client_id,kind,name,spec_json,preview_path,created_at,updated_at")
        .eq("id", moduleId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Module not found.");

      setName(String((data as any).name ?? ""));
      const loadedKind = (String((data as any).kind ?? "module") as TemplateModuleKind) || "module";
      setKind(loadedKind);
      const loaded = ((data as any).spec_json ?? defaultSpec("module")) as ModuleForgeSpec;
      // If someone created a totally empty module earlier, seed a sensible default structure.
      if (loadedKind === "module" && Array.isArray(loaded?.elements) && loaded.elements.length === 0) {
        const seeded = defaultSpec("module");
        setSpec({ ...loaded, elements: seeded.elements });
      } else {
        setSpec(loaded);
      }
      setSelectedId(null);
      try {
        localStorage.setItem(LAST_MODULE_FORGE_ID_KEY, moduleId);
      } catch {
        // ignore
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  // Slots-only guarantee for layout modules: strip non-slot elements when user switches kind.
  useEffect(() => {
    if (kind !== "layout") return;
    setSpec((prev) => {
      const nextEls = prev.elements.filter((e) => e.type === "Slot");
      const next = { ...prev, elements: nextEls };
      // seed a default slot if none exist (keeps UX from feeling empty)
      if (next.elements.length === 0) {
        const base = elementDefaults("Slot");
        next.elements = [{ id: nanoid("el"), type: "Slot", rect: base.rect, props: base.props, zIndex: 1 }];
      }
      return next;
    });
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    if (!jsonOpen) return;
    setRawJson(JSON.stringify({ name, kind, spec }, null, 2));
    setRawErr(null);
  }, [jsonOpen, name, kind, spec]);

  function updateElement(id: string, patch: Partial<ModuleForgeElement>) {
    setSpec((prev) => ({
      ...prev,
      elements: prev.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as any) : e)),
    }));
  }

  function addElement(type: ModuleForgeElementType) {
    setSpec((prev) => {
      const nextZ = (prev.elements.reduce((m, e) => Math.max(m, e.zIndex), 0) || 0) + 1;
      const base = elementDefaults(type);
      const el: ModuleForgeElement = { id: nanoid("el"), type, rect: base.rect, props: base.props, zIndex: nextZ };
      return { ...prev, elements: [...prev.elements, el] };
    });
  }

  function reorderModuleStack(dragId: string, insertIndex: number) {
    setSpec((prev) => {
      const legacy = prev.elements.filter((e) => !isModuleStackableType(e.type)).slice().sort((a, b) => a.zIndex - b.zIndex);
      const stack = prev.elements.filter((e) => isModuleStackableType(e.type)).slice().sort((a, b) => a.zIndex - b.zIndex);
      const fromIdx = stack.findIndex((e) => e.id === dragId);
      if (fromIdx < 0) return prev;

      const next = stack.slice();
      const [moved] = next.splice(fromIdx, 1);
      const idx = clamp(insertIndex, 0, next.length);
      next.splice(idx, 0, moved);

      const combined = [...legacy, ...next].map((e, i) => ({ ...e, zIndex: i + 1 }));
      return { ...prev, elements: combined };
    });
  }

  function replaceSlots(nextSlots: ModuleForgeElement[]) {
    setSpec((prev) => {
      const keep = kind === "layout" ? [] : prev.elements.filter((e) => e.type !== "Slot");
      const maxZ = keep.reduce((m, e) => Math.max(m, e.zIndex), 0) || 0;
      const remapped = nextSlots.map((s, i) => ({ ...s, zIndex: maxZ + 1 + i }));
      const next: ModuleForgeSpec = {
        ...prev,
        elements: [...keep, ...remapped],
        layoutAssist:
          kind === "layout"
            ? {
                mode: layoutMode,
                padding: layoutPadding,
                gap: layoutGap,
                cols: layoutMode === "grid" ? layoutCols : undefined,
                rows: layoutMode === "grid" ? layoutRows : undefined,
                direction: layoutMode === "flex" ? flexDirection : undefined,
                wrap: layoutMode === "flex" ? flexWrap : undefined,
                count: layoutMode === "flex" ? flexCount : undefined,
                perLine: layoutMode === "flex" ? flexPerLine : undefined,
                crossSize: layoutMode === "flex" ? flexCrossSize : undefined,
                slotKeyBase: slotKeyBase.trim() || "slot",
              }
            : prev.layoutAssist,
      };
      return next;
    });
    setSelectedId(null);
  }

  function generateGridSlots() {
    const pad = clamp(Number(layoutPadding), 0, 5000);
    const gap = clamp(Number(layoutGap), 0, 5000);
    const cols = clamp(Number(layoutCols), 1, 64);
    const rows = clamp(Number(layoutRows), 1, 64);
    const innerW = Math.max(1, spec.canvas.w - pad * 2 - gap * (cols - 1));
    const innerH = Math.max(1, spec.canvas.h - pad * 2 - gap * (rows - 1));
    const cellW = innerW / cols;
    const cellH = innerH / rows;
    const base = (slotKeyBase || "slot").trim() || "slot";
    const out: ModuleForgeElement[] = [];
    let idx = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          id: nanoid("el"),
          type: "Slot",
          zIndex: idx,
          rect: {
            x: pad + c * (cellW + gap),
            y: pad + r * (cellH + gap),
            w: cellW,
            h: cellH,
          },
          props: { slotKey: `${base}_${idx}` },
        });
        idx++;
      }
    }
    replaceSlots(out);
  }

  function generateFlexSlots() {
    const pad = clamp(Number(layoutPadding), 0, 5000);
    const gap = clamp(Number(layoutGap), 0, 5000);
    const count = clamp(Number(flexCount), 1, 5000);
    const perLine = clamp(Number(flexWrap ? flexPerLine : count), 1, 5000);
    const crossSize = clamp(Number(flexCrossSize), 1, 5000);
    const base = (slotKeyBase || "slot").trim() || "slot";
    const out: ModuleForgeElement[] = [];

    if (flexDirection === "row") {
      const innerW = Math.max(1, spec.canvas.w - pad * 2 - gap * (perLine - 1));
      const itemW = innerW / perLine;
      for (let i = 0; i < count; i++) {
        const line = Math.floor(i / perLine);
        const col = i % perLine;
        out.push({
          id: nanoid("el"),
          type: "Slot",
          zIndex: i + 1,
          rect: {
            x: pad + col * (itemW + gap),
            y: pad + line * (crossSize + gap),
            w: itemW,
            h: crossSize,
          },
          props: { slotKey: `${base}_${i + 1}` },
        });
      }
    } else {
      const innerH = Math.max(1, spec.canvas.h - pad * 2 - gap * (perLine - 1));
      const itemH = innerH / perLine;
      for (let i = 0; i < count; i++) {
        const line = Math.floor(i / perLine);
        const row = i % perLine;
        out.push({
          id: nanoid("el"),
          type: "Slot",
          zIndex: i + 1,
          rect: {
            x: pad + line * (crossSize + gap),
            y: pad + row * (itemH + gap),
            w: crossSize,
            h: itemH,
          },
          props: { slotKey: `${base}_${i + 1}` },
        });
      }
    }

    replaceSlots(out);
  }

  function removeSelected() {
    if (!selectedId) return;
    setSpec((prev) => ({ ...prev, elements: prev.elements.filter((e) => e.id !== selectedId) }));
    setSelectedId(null);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const cleanedName = name.trim() || (kind === "layout" ? "Untitled layout" : "Untitled module");
      const clientId = getStudioClientId();
      const nextSpec = { ...spec, kind } satisfies ModuleForgeSpec;

      if (!moduleId) {
        const { data, error } = await supabase
          .from("template_modules")
          .insert({
            client_id: clientId,
            kind,
            name: cleanedName,
            spec_json: nextSpec as any,
            preview_path: null,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        const id = String((data as any)?.id ?? "");
        if (!id) throw new Error("Save succeeded but no id returned.");
        navigate(`/module-forge/edit/${encodeURIComponent(id)}`, { replace: true });
        return;
      }

      // Preview generation (SVG). This is best-effort and won’t block saving.
      let previewPath: string | null = null;
      try {
        const svg = renderSvgPreview(nextSpec);
        const blob = new Blob([svg], { type: "image/svg+xml" });
        previewPath = `${moduleId}/preview.svg`;
        const up = await supabase.storage.from("template_assets").upload(previewPath, blob, {
          upsert: true,
          contentType: "image/svg+xml",
        });
        if (up.error) {
          previewPath = null;
        }
      } catch {
        previewPath = null;
      }

      const { error } = await supabase
        .from("template_modules")
        .update({
          kind,
          name: cleanedName,
          spec_json: nextSpec as any,
          ...(previewPath ? { preview_path: previewPath } : {}),
        } as any)
        .eq("id", moduleId)
        .eq("client_id", clientId);
      if (error) throw error;

      setName(cleanedName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteModule() {
    if (!moduleId) return;
    const ok = window.confirm("Delete this module/layout?");
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      const clientId = getStudioClientId();
      const { error } = await supabase.from("template_modules").delete().eq("id", moduleId).eq("client_id", clientId);
      if (error) throw error;
      navigate("/module-forge/library");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  function onDrop(ev: DragEvent) {
    ev.preventDefault();
    const reorderId = (ev.dataTransfer.getData("application/x-moduleforge-reorder") || "").trim();
    if (kind === "module" && reorderId) {
      const idx = typeof dragInsertIndex === "number" ? dragInsertIndex : 0;
      reorderModuleStack(reorderId, idx);
      setDraggingElementId(null);
      setDragInsertIndex(null);
      return;
    }
    const t = (ev.dataTransfer.getData("application/x-moduleforge-element") || "") as ModuleForgeElementType;
    if (!t) return;
    if (kind === "layout" && t !== "Slot") return; // layout editor is slots-only
    addElement(t);
  }

  function onDragOver(ev: DragEvent) {
    ev.preventDefault();
  }

  if (loading) {
    return <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="h-full w-full overflow-hidden flex">
      {/* Left palette */}
      <aside className="w-64 shrink-0 border-r bg-muted/20 overflow-auto">
        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Template Module Forge</div>
            <div className="font-semibold">Editor</div>
          </div>

          <div className="space-y-2">
            <Link className="text-xs underline text-muted-foreground" to="/module-forge/library">
              ← Back to library
            </Link>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "layout" ? "Layout name" : "Module name"}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Kind</label>
            <div className="flex gap-2">
              <button
                className={`flex-1 px-3 py-2 text-sm border rounded ${kind === "layout" ? "bg-accent" : "hover:bg-accent"}`}
                onClick={() => setKind("layout")}
              >
                Layout
              </button>
              <button
                className={`flex-1 px-3 py-2 text-sm border rounded ${kind === "module" ? "bg-accent" : "hover:bg-accent"}`}
                onClick={() => setKind("module")}
              >
                Module
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Layouts are <span className="font-medium">slots-only</span> (dotted boxes). Modules contain content elements.
            </div>
          </div>

          {kind === "module" ? (
            <div className="space-y-2 border rounded-lg bg-background p-3">
              <div className="text-xs font-semibold text-muted-foreground">Module editing</div>
              <div className="text-[11px] text-muted-foreground">
                Modules are edited as a stacked column. Use <span className="font-medium">Fill</span> on an element to make it grow like flexbox.
              </div>
            </div>
          ) : null}

          {kind === "layout" ? (
            <div className="space-y-3 border rounded-lg bg-background p-3">
              <div className="text-xs font-semibold text-muted-foreground">Layout creator</div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Mode</label>
                <select
                  className="w-full border rounded px-2 py-2 text-sm bg-background"
                  value={layoutMode}
                  onChange={(e) => setLayoutMode(e.target.value as any)}
                >
                  <option value="grid">Grid (CSS grid-ish)</option>
                  <option value="flex">Flex (flexbox-ish)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Padding</label>
                  <input
                    className="w-full border rounded px-2 py-2 text-sm bg-background"
                    type="number"
                    value={layoutPadding}
                    onChange={(e) => setLayoutPadding(clamp(Number(e.target.value), 0, 5000))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Gap</label>
                  <input
                    className="w-full border rounded px-2 py-2 text-sm bg-background"
                    type="number"
                    value={layoutGap}
                    onChange={(e) => setLayoutGap(clamp(Number(e.target.value), 0, 5000))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Slot key base</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={slotKeyBase}
                  onChange={(e) => setSlotKeyBase(e.target.value)}
                  placeholder="slot"
                />
              </div>

              {layoutMode === "grid" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Cols</label>
                      <input
                        className="w-full border rounded px-2 py-2 text-sm bg-background"
                        type="number"
                        value={layoutCols}
                        onChange={(e) => setLayoutCols(clamp(Number(e.target.value), 1, 64))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Rows</label>
                      <input
                        className="w-full border rounded px-2 py-2 text-sm bg-background"
                        type="number"
                        value={layoutRows}
                        onChange={(e) => setLayoutRows(clamp(Number(e.target.value), 1, 64))}
                      />
                    </div>
                  </div>

                  <button
                    className="w-full px-3 py-2 text-sm border rounded hover:bg-accent"
                    onClick={generateGridSlots}
                    title="Replace all slots with a new grid"
                  >
                    Generate grid slots
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Direction</label>
                    <select
                      className="w-full border rounded px-2 py-2 text-sm bg-background"
                      value={flexDirection}
                      onChange={(e) => setFlexDirection(e.target.value as any)}
                    >
                      <option value="row">Row</option>
                      <option value="column">Column</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">Wrap</div>
                    <input type="checkbox" checked={flexWrap} onChange={(e) => setFlexWrap(e.target.checked)} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Count</label>
                      <input
                        className="w-full border rounded px-2 py-2 text-sm bg-background"
                        type="number"
                        value={flexCount}
                        onChange={(e) => setFlexCount(clamp(Number(e.target.value), 1, 5000))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{flexDirection === "row" ? "Per row" : "Per col"}</label>
                      <input
                        className="w-full border rounded px-2 py-2 text-sm bg-background"
                        type="number"
                        value={flexPerLine}
                        onChange={(e) => setFlexPerLine(clamp(Number(e.target.value), 1, 5000))}
                        disabled={!flexWrap}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{flexDirection === "row" ? "Item height" : "Item width"}</label>
                    <input
                      className="w-full border rounded px-2 py-2 text-sm bg-background"
                      type="number"
                      value={flexCrossSize}
                      onChange={(e) => setFlexCrossSize(clamp(Number(e.target.value), 1, 5000))}
                    />
                  </div>

                  <button
                    className="w-full px-3 py-2 text-sm border rounded hover:bg-accent"
                    onClick={generateFlexSlots}
                    title="Replace all slots with a new flex layout"
                  >
                    Generate flex slots
                  </button>
                </>
              )}

              <div className="text-[11px] text-muted-foreground">
                This generates slot rectangles (like a grid/flex helper). You can still fine-tune slots in the Inspector.
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Elements</label>
            <div className="grid gap-2">
              {(
                [
                  ...(kind === "layout"
                    ? (["Slot"] as const)
                : (["Header", "BodyText", "Divider", "Pattern"] as const)),
                ] as const
              ).map((t) => (
                <div
                  key={t}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-moduleforge-element", t);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className="px-3 py-2 text-sm border rounded bg-background hover:bg-accent cursor-grab active:cursor-grabbing"
                  title="Drag onto canvas"
                >
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <button
              className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="px-3 py-2 text-sm border rounded hover:bg-accent" onClick={() => setJsonOpen((v) => !v)}>
              {jsonOpen ? "Hide JSON" : "View JSON"}
            </button>
            <button
              className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
              onClick={removeSelected}
              disabled={!selectedId}
            >
              Delete selected
            </button>
            <button
              className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
              onClick={deleteModule}
              disabled={!moduleId || deleting}
            >
              {deleting ? "Deleting…" : "Delete module"}
            </button>
          </div>

          {err ? (
            <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">{err}</div>
          ) : null}
        </div>
      </aside>

      {/* Canvas */}
      <section className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        <div className="border-b px-4 py-2 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Canvas: {canvasW}×{canvasH} {spec.canvas.unit}
          </div>
          <div className="text-xs text-muted-foreground">{selected ? `Selected: ${selected.type}` : "No selection"}</div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/10 p-6">
          <div
            className="relative border bg-white shadow-sm mx-auto"
            style={{ width: canvasW, height: canvasH }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onMouseDown={() => setSelectedId(null)}
          >
            {kind === "module" ? (
              <>
                {/* Legacy/non-stacked elements (kept as-is, selectable/deletable) */}
                {(moduleLayout?.legacy ?? []).map((e) => {
                  const isSel = e.id === selectedId;
                  const patternVariant = String((e.props as any)?.variant ?? "grid").toLowerCase();
                  const patternStroke = String((e.props as any)?.stroke ?? "#e5e7eb");
                  const patternOutline = Boolean((e.props as any)?.outline ?? false);
                  const patternOutlineThickness = Math.max(0, Number((e.props as any)?.outlineThickness ?? 2) || 0);
                  const patternSpacing = Math.max(
                    6,
                    Number((e.props as any)?.spacing ?? (patternVariant === "dots" ? 12 : patternVariant === "grid" ? 16 : 16)) ||
                      16,
                  );

                  const patternBackground =
                    e.type !== "Pattern"
                      ? undefined
                      : patternVariant === "blank"
                        ? "transparent"
                        : patternVariant === "lines"
                          ? `repeating-linear-gradient(to bottom, transparent 0, transparent ${patternSpacing - 1}px, ${patternStroke} ${patternSpacing - 1}px, ${patternStroke} ${patternSpacing}px)`
                          : patternVariant === "grid"
                            ? `linear-gradient(${patternStroke} 1px, transparent 1px), linear-gradient(90deg, ${patternStroke} 1px, transparent 1px)`
                            : `radial-gradient(circle, ${patternStroke} 1.2px, transparent 1.4px)`;

                  return (
                    <div
                      key={e.id}
                      className={`absolute border ${
                        isSel ? "border-primary bg-primary/5" : "border-transparent"
                      } hover:border-border`}
                      style={{
                        left: e.rect.x,
                        top: e.rect.y,
                        width: e.rect.w,
                        height: e.rect.h,
                        zIndex: e.zIndex,
                        background:
                          e.type === "BackgroundTexture"
                            ? String(e.props?.fill ?? "#f8fafc")
                            : e.type === "Divider"
                              ? String(e.props?.stroke ?? "#e5e7eb")
                              : e.type === "Pattern"
                                ? patternBackground
                              : "transparent",
                        backgroundSize:
                          e.type === "Pattern"
                            ? patternVariant === "grid"
                              ? `${patternSpacing}px ${patternSpacing}px`
                              : patternVariant === "dots"
                                ? `${patternSpacing}px ${patternSpacing}px`
                                : undefined
                            : undefined,
                        borderStyle: e.type === "Slot" ? "dotted" : "solid",
                        borderColor:
                          e.type === "Slot"
                            ? "#60a5fa"
                            : e.type === "Pattern" && patternOutline
                              ? patternStroke
                              : undefined,
                        borderWidth:
                          e.type === "Pattern" && patternOutline
                            ? Math.max(1, Math.min(24, patternOutlineThickness || 1))
                            : undefined,
                      }}
                      onMouseDown={(ev) => {
                        ev.stopPropagation();
                        setSelectedId(e.id);
                      }}
                      title={`Legacy: ${e.type}`}
                    >
                      <div className="text-[11px] text-muted-foreground p-1 select-none">
                        Legacy: {e.type}
                        {e.type === "Pattern" ? ` (${patternVariant || "grid"})` : ""}
                      </div>
                    </div>
                  );
                })}

                {/* Stacked module elements */}
                {(moduleLayout?.stacked ?? []).map((e, idx, arr) => {
                  const isSel = e.id === selectedId;
                  const preset = getLayoutPreset(e);
                  const showDropIndicator = draggingElementId && dragInsertIndex === idx;
                  const patternVariant = String((e.props as any)?.variant ?? "grid").toLowerCase();
                  const patternStroke = String((e.props as any)?.stroke ?? "#e5e7eb");
                  const patternOutline = Boolean((e.props as any)?.outline ?? false);
                  const patternOutlineThickness = Math.max(0, Number((e.props as any)?.outlineThickness ?? 2) || 0);
                  const patternSpacing = Math.max(6, Number((e.props as any)?.spacing ?? 16) || 16);
                  const patternBackground =
                    e.type !== "Pattern"
                      ? undefined
                      : patternVariant === "blank"
                        ? "transparent"
                        : patternVariant === "lines"
                          ? `repeating-linear-gradient(to bottom, transparent 0, transparent ${patternSpacing - 1}px, ${patternStroke} ${patternSpacing - 1}px, ${patternStroke} ${patternSpacing}px)`
                          : patternVariant === "grid"
                            ? `linear-gradient(${patternStroke} 1px, transparent 1px), linear-gradient(90deg, ${patternStroke} 1px, transparent 1px)`
                            : `radial-gradient(circle, ${patternStroke} 1.2px, transparent 1.4px)`;
                  const bg =
                    e.type === "Header"
                      ? "rgba(59,130,246,0.12)"
                      : e.type === "BodyText"
                        ? "rgba(16,185,129,0.12)"
                        : e.type === "Title"
                          ? "rgba(168,85,247,0.12)"
                          : e.type === "Pattern"
                            ? "transparent"
                          : "rgba(107,114,128,0.10)";
                  return (
                    <div key={e.id}>
                      {showDropIndicator ? (
                        <div
                          className="absolute left-0 right-0"
                          style={{ top: e.rect.y - MODULE_STACK_GAP / 2, height: 0, zIndex: 9999 }}
                        >
                          <div className="h-0.5 bg-primary w-full" />
                        </div>
                      ) : null}
                      <div
                        draggable
                        className={`absolute border rounded ${
                          isSel ? "border-primary bg-primary/5" : "border-border/20 bg-transparent"
                        } hover:border-border cursor-grab active:cursor-grabbing`}
                        style={{
                          left: e.rect.x,
                          top: e.rect.y,
                          width: e.rect.w,
                          height: e.rect.h,
                          zIndex: e.zIndex,
                          background: e.type === "Pattern" ? patternBackground : "transparent",
                          backgroundSize:
                            e.type === "Pattern" && (patternVariant === "grid" || patternVariant === "dots")
                              ? `${patternSpacing}px ${patternSpacing}px`
                              : undefined,
                          borderColor: e.type === "Pattern" && patternOutline ? patternStroke : undefined,
                          borderWidth:
                            e.type === "Pattern" && patternOutline
                              ? Math.max(1, Math.min(24, patternOutlineThickness || 1))
                              : undefined,
                        }}
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData("application/x-moduleforge-reorder", e.id);
                          ev.dataTransfer.effectAllowed = "move";
                          setDraggingElementId(e.id);
                          setDragInsertIndex(idx);
                        }}
                        onDragEnd={() => {
                          setDraggingElementId(null);
                          setDragInsertIndex(null);
                        }}
                        onDragOver={(ev) => {
                          ev.preventDefault();
                          // Decide insertion point by comparing cursor Y to the element’s midpoint.
                          const rect = (ev.currentTarget as HTMLDivElement).getBoundingClientRect();
                          const y = ev.clientY - rect.top;
                          const before = y < rect.height / 2;
                          const nextIndex = before ? idx : idx + 1;
                          if (nextIndex !== dragInsertIndex) setDragInsertIndex(nextIndex);
                        }}
                        onMouseDown={(ev) => {
                          ev.stopPropagation();
                          setSelectedId(e.id);
                        }}
                        title={`${e.type} (${preset === "fill" ? "Fill" : "Fixed"})`}
                      >
                        <div
                          className="h-full w-full relative overflow-hidden"
                          style={{
                            background: e.type === "Divider" ? "transparent" : bg,
                          }}
                        >
                          <div className="absolute left-2 top-2 text-[11px] text-muted-foreground select-none">{e.type}</div>
                          <div className="absolute right-2 top-2 text-[10px] text-muted-foreground select-none">
                            {preset === "fill" ? "Fill" : "Fixed"}
                          </div>
                          {e.type === "Divider" ? (
                            <div
                              className="absolute left-2 right-2"
                              style={{
                                top: Math.max(0, (e.rect.h - Math.max(1, Number(e.props?.thickness ?? 2))) / 2),
                                height: Math.max(1, Number(e.props?.thickness ?? 2)),
                                background: String(e.props?.stroke ?? "#e5e7eb"),
                              }}
                            />
                          ) : (
                            <div className="absolute inset-2 rounded border border-border/30" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(() => {
                  const stacked = moduleLayout?.stacked ?? [];
                  if (!draggingElementId) return null;
                  if (dragInsertIndex !== stacked.length) return null;
                  const last = stacked[stacked.length - 1];
                  const top = last ? last.rect.y + last.rect.h + MODULE_STACK_GAP / 2 : MODULE_STACK_PADDING;
                  return (
                    <div className="absolute left-0 right-0" style={{ top, height: 0, zIndex: 9999 }}>
                      <div className="h-0.5 bg-primary w-full" />
                    </div>
                  );
                })()}
              </>
            ) : (
              (kind === "layout" ? spec.elements.filter((e) => e.type === "Slot") : spec.elements)
                .slice()
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((e) => {
                  const isSel = e.id === selectedId;
                  return (
                    <div
                      key={e.id}
                      className={`absolute border ${isSel ? "border-primary" : "border-transparent"} hover:border-border`}
                      style={{
                        left: e.rect.x + canvasDx,
                        top: e.rect.y + canvasDy,
                        width: e.rect.w,
                        height: e.rect.h,
                        zIndex: e.zIndex,
                        background:
                          e.type === "BackgroundTexture"
                            ? String(e.props?.fill ?? "#f8fafc")
                            : e.type === "Divider"
                              ? String(e.props?.stroke ?? "#e5e7eb")
                              : "transparent",
                        borderStyle: e.type === "Slot" ? "dotted" : "solid",
                        borderColor: e.type === "Slot" ? "#60a5fa" : undefined,
                      }}
                      onMouseDown={(ev) => {
                        ev.stopPropagation();
                        setSelectedId(e.id);
                      }}
                      title={e.type}
                    >
                      {e.type === "Header" || e.type === "Title" || e.type === "BodyText" ? (
                        <div
                          style={{
                            color: String(e.props?.color ?? "#111827"),
                            fontSize: Math.max(8, Number(e.props?.fontSize ?? 14)),
                            lineHeight: String(e.props?.lineHeight ?? 1.2),
                            padding: 6,
                            overflow: "hidden",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {String(e.props?.text ?? e.type)}
                        </div>
                      ) : e.type === "Slot" ? (
                        <div className="text-[11px] text-blue-600 p-1 select-none">{String(e.props?.slotKey ?? "slot")}</div>
                      ) : null}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </section>

      {/* Inspector */}
      <aside className="w-80 shrink-0 border-l bg-muted/20 overflow-auto">
        <div className="p-4 space-y-4">
          <div className="font-semibold">Inspector</div>

          {selected ? (
            <>
              <div className="text-xs text-muted-foreground">Element</div>
              <div className="text-sm font-medium">{selected.type}</div>

              {kind === "module" && isModuleStackableType(selected.type) ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Sizing</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["fixed", "fit", "fill"] as const).map((p) => {
                        const active = getLayoutPreset(selected) === p;
                        return (
                          <button
                            key={p}
                            className={`px-3 py-2 text-sm border rounded ${active ? "bg-accent" : "hover:bg-accent"}`}
                            onClick={() => updateElement(selected.id, { props: { ...(selected.props ?? {}), layoutPreset: p } })}
                            title={
                              p === "fill"
                                ? "Fill remaining space (flex-grow)"
                                : p === "fit"
                                  ? "Shrink to fit content (best used for text elements)"
                                  : "Fixed height"
                            }
                          >
                            {p === "fill" ? "Fill" : p === "fit" ? "Fit" : "Fixed"}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Stacked layout auto-positions elements; use <span className="font-medium">Fill</span> to grow.
                    </div>
                  </div>

                  {getLayoutPreset(selected) === "fixed" && selected.type !== "Divider" ? (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Height</label>
                      <input
                        className="w-full border rounded px-2 py-2 text-sm bg-background"
                        type="number"
                        value={Number(selected.rect?.h ?? 40)}
                        onChange={(e) =>
                          updateElement(selected.id, { rect: { ...selected.rect, h: clamp(Number(e.target.value), 1, 5000) } })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <div key={k} className="space-y-1">
                      <label className="text-xs text-muted-foreground">{k.toUpperCase()}</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm bg-background"
                        type="number"
                        value={selected.rect[k]}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          updateElement(selected.id, {
                            rect: {
                              ...selected.rect,
                              [k]: k === "w" || k === "h" ? clamp(v, 1, 5000) : clamp(v, -5000, 5000),
                            },
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {selected.type === "Slot" ? (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">slotKey</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    value={String(selected.props?.slotKey ?? "")}
                    onChange={(e) => updateElement(selected.id, { props: { ...selected.props, slotKey: e.target.value } })}
                  />
                </div>
              ) : null}

              {selected.type === "BackgroundTexture" ? (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">fill</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    value={String(selected.props?.fill ?? "")}
                    onChange={(e) => updateElement(selected.id, { props: { ...selected.props, fill: e.target.value } })}
                    placeholder="#ffffff"
                  />
                </div>
              ) : null}

              {selected.type === "Container" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">stroke</label>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                      value={String(selected.props?.stroke ?? "")}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, stroke: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">radius</label>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                      type="number"
                      value={Number(selected.props?.radius ?? 0)}
                      onChange={(e) =>
                        updateElement(selected.id, { props: { ...selected.props, radius: clamp(Number(e.target.value), 0, 200) } })
                      }
                    />
                  </div>
                </div>
              ) : null}

              {selected.type === "GridLines" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">cols</label>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                      type="number"
                      value={Number(selected.props?.cols ?? 6)}
                      onChange={(e) =>
                        updateElement(selected.id, { props: { ...selected.props, cols: clamp(Number(e.target.value), 1, 64) } })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">rows</label>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                      type="number"
                      value={Number(selected.props?.rows ?? 8)}
                      onChange={(e) =>
                        updateElement(selected.id, { props: { ...selected.props, rows: clamp(Number(e.target.value), 1, 64) } })
                      }
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs text-muted-foreground">stroke</label>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      value={String(selected.props?.stroke ?? "")}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, stroke: e.target.value } })}
                    />
                  </div>
                </div>
              ) : null}

              {selected.type === "Pattern" ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">variant</label>
                    <select
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      value={String(selected.props?.variant ?? "grid")}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, variant: e.target.value } })}
                    >
                      {["lines", "grid", "dots", "blank"].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  {String(selected.props?.variant ?? "grid").toLowerCase() !== "blank" ? (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">spacing</label>
                      <input
                        className="w-full border rounded px-3 py-2 text-sm bg-background"
                        type="number"
                        value={Number(selected.props?.spacing ?? 16)}
                        onChange={(e) =>
                          updateElement(selected.id, { props: { ...selected.props, spacing: clamp(Number(e.target.value), 6, 200) } })
                        }
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">stroke</label>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      value={String(selected.props?.stroke ?? "#e5e7eb")}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, stroke: e.target.value } })}
                      placeholder="#e5e7eb"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(selected.props?.outline ?? false)}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, outline: e.target.checked } })}
                    />
                    Outline
                  </label>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">outline thickness</label>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      type="number"
                      value={Number(selected.props?.outlineThickness ?? 2)}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          props: { ...selected.props, outlineThickness: clamp(Number(e.target.value), 0, 48) },
                        })
                      }
                      disabled={!Boolean(selected.props?.outline ?? false)}
                    />
                  </div>
                </div>
              ) : null}

              {selected.type === "Header" || selected.type === "BodyText" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">font size</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm bg-background"
                        type="number"
                        value={Number(selected.props?.fontSize ?? (selected.type === "BodyText" ? 12 : 24))}
                        onChange={(e) =>
                          updateElement(selected.id, {
                            props: { ...selected.props, fontSize: clamp(Number(e.target.value), 8, 200) },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">weight</label>
                      <select
                        className="w-full border rounded px-2 py-1 text-sm bg-background"
                        value={String(selected.props?.fontWeight ?? (selected.type === "Header" ? 700 : 400))}
                        onChange={(e) =>
                          updateElement(selected.id, { props: { ...selected.props, fontWeight: Number(e.target.value) } })
                        }
                      >
                        <option value="400">Normal</option>
                        <option value="600">Semibold</option>
                        <option value="700">Bold</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">alignment</label>
                    <select
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      value={String(selected.props?.textAlign ?? "left")}
                      onChange={(e) => updateElement(selected.id, { props: { ...selected.props, textAlign: e.target.value } })}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                </div>
              ) : null}

              {/* No text/typography controls for module elements: structural wireframe editor only. */}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Select an element to edit its properties.</div>
          )}

          {jsonOpen ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Raw JSON</div>
                <button
                  className="text-xs underline text-muted-foreground"
                  onClick={() => {
                    const parsed = safeJsonParse<any>(rawJson);
                    if (!parsed.ok) {
                      setRawErr(parsed.error);
                      return;
                    }
                    const next = parsed.value ?? {};
                    if (typeof next?.name === "string") setName(next.name);
                    if (next?.kind === "layout" || next?.kind === "module") setKind(next.kind);
                    if (next?.spec?.version === 1) setSpec(next.spec);
                    setRawErr(null);
                  }}
                >
                  Apply
                </button>
              </div>
              <textarea
                className="w-full border rounded px-3 py-2 text-xs font-mono bg-background"
                rows={18}
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
              />
              {rawErr ? (
                <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">{rawErr}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

