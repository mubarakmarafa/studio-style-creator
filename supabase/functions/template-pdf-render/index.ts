// Supabase Edge Function: template-pdf-render
// Renders PDFs from template specs and (optionally) processes queued template_job_items in batches.
//
// Env vars (Supabase secrets):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
//
// This function is intentionally permissive (verify_jwt = false) to match the project's current no-auth posture.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

function json(data: unknown, init?: ResponseInit) {
  const h = new Headers(init?.headers ?? {});
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { headers: h, ...init });
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing ${name} env var`);
  return v;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = String(hex ?? "").trim().replace(/^#/, "");
  const norm =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(norm)) return { r: 0.97, g: 0.98, b: 0.99 }; // near-white
  const n = parseInt(norm, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return { r, g, b };
}

function toPdfY(pageH: number, yTop: number, h: number) {
  // Convert top-left origin to PDF bottom-left origin
  return pageH - yTop - h;
}

function toPdfYPoint(pageH: number, yTop: number) {
  // Convert a Y position (top-left origin) to a PDF point Y (bottom-left origin)
  return pageH - yTop;
}

async function renderPdfFromSpec(spec: any): Promise<Uint8Array> {
  const canvasW = Number(spec?.canvas?.w ?? 612) || 612;
  const canvasH = Number(spec?.canvas?.h ?? 792) || 792;
  const elements = Array.isArray(spec?.elements) ? spec.elements : [];

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([canvasW, canvasH]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const sorted = elements
    .slice()
    .sort((a: any, b: any) => (Number(a?.zIndex ?? 0) || 0) - (Number(b?.zIndex ?? 0) || 0));

  for (const e of sorted) {
    const type = String(e?.type ?? "");
    const rect = e?.rect ?? {};
    const x = Number(rect?.x ?? 0) || 0;
    const y = Number(rect?.y ?? 0) || 0;
    const w = Number(rect?.w ?? 0) || 0;
    const h = Number(rect?.h ?? 0) || 0;
    const props = e?.props ?? {};

    if (type === "BackgroundTexture") {
      const fill = parseHexColor(String(props?.fill ?? "#ffffff"));
      page.drawRectangle({
        x: 0,
        y: 0,
        width: canvasW,
        height: canvasH,
        color: rgb(fill.r, fill.g, fill.b),
      });
      continue;
    }

    if (type === "GridLines") {
      const cols = Math.max(1, Number(props?.cols ?? 6) || 6);
      const rows = Math.max(1, Number(props?.rows ?? 8) || 8);
      const stroke = parseHexColor(String(props?.stroke ?? "#e5e7eb"));
      for (let i = 1; i < cols; i++) {
        const lx = (canvasW / cols) * i;
        page.drawLine({
          start: { x: lx, y: 0 },
          end: { x: lx, y: canvasH },
          thickness: 1,
          color: rgb(stroke.r, stroke.g, stroke.b),
        });
      }
      for (let j = 1; j < rows; j++) {
        const ly = (canvasH / rows) * j;
        page.drawLine({
          start: { x: 0, y: ly },
          end: { x: canvasW, y: ly },
          thickness: 1,
          color: rgb(stroke.r, stroke.g, stroke.b),
        });
      }
      continue;
    }

    if (type === "Pattern") {
      const variant = String(props?.variant ?? "grid").toLowerCase();
      const stroke = parseHexColor(String(props?.stroke ?? "#e5e7eb"));
      const outline = Boolean(props?.outline ?? false);
      const outlineThickness = Math.max(0, Number(props?.outlineThickness ?? 2) || 0);
      const spacing = Math.max(6, Number(props?.spacing ?? (variant === "dots" ? 12 : variant === "grid" ? 16 : 16)) || 16);

      if (variant === "lines") {
        for (let yTop = y + spacing; yTop < y + h; yTop += spacing) {
          const yPdf = toPdfYPoint(canvasH, yTop);
          page.drawLine({
            start: { x, y: yPdf },
            end: { x: x + w, y: yPdf },
            thickness: 1,
            color: rgb(stroke.r, stroke.g, stroke.b),
          });
        }
      } else if (variant === "grid") {
        for (let xTop = x + spacing; xTop < x + w; xTop += spacing) {
          page.drawLine({
            start: { x: xTop, y: toPdfYPoint(canvasH, y) },
            end: { x: xTop, y: toPdfYPoint(canvasH, y + h) },
            thickness: 1,
            color: rgb(stroke.r, stroke.g, stroke.b),
          });
        }
        for (let yTop = y + spacing; yTop < y + h; yTop += spacing) {
          const yPdf = toPdfYPoint(canvasH, yTop);
          page.drawLine({
            start: { x, y: yPdf },
            end: { x: x + w, y: yPdf },
            thickness: 1,
            color: rgb(stroke.r, stroke.g, stroke.b),
          });
        }
      } else if (variant === "dots") {
        const r = 1.2;
        for (let xTop = x + spacing / 2; xTop < x + w; xTop += spacing) {
          for (let yTop = y + spacing / 2; yTop < y + h; yTop += spacing) {
            page.drawCircle({
              x: xTop,
              y: toPdfYPoint(canvasH, yTop),
              size: r,
              color: rgb(stroke.r, stroke.g, stroke.b),
            });
          }
        }
      } else {
        // blank
      }

      if (outline && outlineThickness > 0) {
        page.drawRectangle({
          x,
          y: toPdfY(canvasH, y, h),
          width: w,
          height: h,
          borderWidth: outlineThickness,
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
        });
      }
      continue;
    }

    if (type === "Divider") {
      const stroke = parseHexColor(String(props?.stroke ?? "#e5e7eb"));
      const thickness = Math.max(1, Number(props?.thickness ?? 2) || 2);
      page.drawRectangle({
        x,
        y: toPdfY(canvasH, y, Math.max(1, thickness)),
        width: w,
        height: Math.max(1, thickness),
        color: rgb(stroke.r, stroke.g, stroke.b),
      });
      continue;
    }

    if (type === "Container") {
      const stroke = parseHexColor(String(props?.stroke ?? "#d1d5db"));
      page.drawRectangle({
        x,
        y: toPdfY(canvasH, y, h),
        width: w,
        height: h,
        borderWidth: 2,
        borderColor: rgb(stroke.r, stroke.g, stroke.b),
        color: undefined,
      });
      continue;
    }

    if (type === "Slot") {
      const stroke = parseHexColor("#60a5fa");
      const slotKey = String(props?.slotKey ?? "slot");
      page.drawRectangle({
        x,
        y: toPdfY(canvasH, y, h),
        width: w,
        height: h,
        borderWidth: 2,
        borderColor: rgb(stroke.r, stroke.g, stroke.b),
      });
      page.drawText(slotKey, {
        x: x + 6,
        y: toPdfY(canvasH, y, h) + h - 16,
        size: 10,
        font,
        color: rgb(0.15, 0.39, 0.92),
      });
      continue;
    }

    if (type === "Header" || type === "Title" || type === "BodyText") {
      const text = String(props?.text ?? type);
      const fontSize = Math.max(8, Number(props?.fontSize ?? 14) || 14);
      const fwRaw: any = props?.fontWeight ?? (type === "Header" ? 700 : 400);
      const fontWeight =
        typeof fwRaw === "string"
          ? fwRaw.toLowerCase() === "bold"
            ? 700
            : Number(fwRaw) || (type === "Header" ? 700 : 400)
          : Number(fwRaw) || (type === "Header" ? 700 : 400);
      const align = String(props?.textAlign ?? "left").toLowerCase();
      const color = parseHexColor(String(props?.color ?? "#111827"));
      const lines = text.split(/\r?\n/);
      const lineHeight = Math.max(1, Number(props?.lineHeight ?? 1.2) || 1.2);
      const useFont = fontWeight >= 600 ? fontBold : font;
      let dy = 0;
      for (const line of lines) {
        const safe = String(line ?? "");
        const maxWidth = Math.max(0, w - 12);
        const tw = useFont.widthOfTextAtSize(safe, fontSize);
        const xLeft = x + 6;
        const tx =
          align === "center"
            ? Math.max(xLeft, x + (w - tw) / 2)
            : align === "right"
              ? Math.max(xLeft, x + w - 6 - tw)
              : xLeft;
        page.drawText(line, {
          x: tx,
          y: toPdfY(canvasH, y, h) + h - fontSize - 6 - dy,
          size: fontSize,
          font: useFont,
          color: rgb(color.r, color.g, color.b),
          maxWidth,
        });
        dy += fontSize * lineHeight;
        if (dy > h) break;
      }
      continue;
    }
  }

  const bytes = await pdf.save();
  return bytes;
}

async function ensureBuckets(supabase: ReturnType<typeof createClient>) {
  const buckets = [
    { id: "template_assets", public: true },
    { id: "template_pdfs", public: true },
  ] as const;

  for (const b of buckets) {
    const res = await supabase.storage.createBucket(b.id, { public: b.public }).catch((e) => ({ error: e }));
    const err: any = (res as any)?.error;
    if (!err) continue;
    const msg = typeof err?.message === "string" ? err.message : String(err);
    if (msg.toLowerCase().includes("already exists")) continue;
    if (msg.toLowerCase().includes("duplicate")) continue;
    console.warn(`[template-pdf-render] createBucket(${b.id}) failed: ${msg}`);
  }
}

async function markJobProgress(supabase: ReturnType<typeof createClient>, jobId: string) {
  const { count: doneCount } = await supabase
    .from("template_job_items")
    .select("id", { head: true, count: "exact" })
    .eq("job_id", jobId)
    .eq("status", "done");
  const { count: totalCount } = await supabase
    .from("template_job_items")
    .select("id", { head: true, count: "exact" })
    .eq("job_id", jobId);

  const completed = typeof doneCount === "number" ? doneCount : 0;
  const total = typeof totalCount === "number" ? totalCount : 0;
  const status = total > 0 && completed >= total ? "done" : "running";

  await supabase.from("template_jobs").update({ completed, total, status }).eq("id", jobId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders(req) });
  }

  let supabaseUrl = "";
  let serviceKey = "";
  try {
    supabaseUrl = requiredEnv("SUPABASE_URL");
    serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: corsHeaders(req) });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureBuckets(supabase);

  const body = (await req.json().catch(() => ({}))) as any;
  const action = typeof body?.action === "string" ? body.action : "render";

  // 1) Stateless render: return PDF bytes (base64) for a spec
  if (action === "render") {
    const spec = body?.templateSpec ?? body?.spec ?? body?.template_spec_json ?? null;
    if (!spec) return json({ error: "Missing templateSpec" }, { status: 400, headers: corsHeaders(req) });
    try {
      const bytes = await renderPdfFromSpec(spec);
      // Return base64 for convenience
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);
      return json({ ok: true, base64 }, { headers: corsHeaders(req) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: corsHeaders(req) });
    }
  }

  // 2) Batch worker: render queued items for a job and upload PDFs
  if (action === "work") {
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    if (!jobId) return json({ error: "Missing jobId" }, { status: 400, headers: corsHeaders(req) });

    const batchSize = Math.max(1, Math.min(25, Number.isFinite(body?.batchSize) ? Number(body.batchSize) : 5));
    const visibilityTimeoutSeconds = Math.max(
      10,
      Math.min(600, Number.isFinite(body?.visibilityTimeoutSeconds) ? Number(body.visibilityTimeoutSeconds) : 60),
    );

    const { data: jobRow, error: jobErr } = await supabase
      .from("template_jobs")
      .select("id,client_id,status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) return json({ error: jobErr.message }, { status: 500, headers: corsHeaders(req) });
    if (!jobRow) return json({ error: "Job not found" }, { status: 404, headers: corsHeaders(req) });
    const jobClientId = String((jobRow as any).client_id ?? "");

    // Mark job as running
    await supabase.from("template_jobs").update({ status: "running" }).eq("id", jobId);

    // Pick some queued items
    const { data: queued, error: qErr } = await supabase
      .from("template_job_items")
      .select("id,job_id,idx,status,template_spec_json,pdf_path,error,updated_at")
      .eq("job_id", jobId)
      .eq("status", "queued")
      .order("idx", { ascending: true })
      .limit(batchSize);
    if (qErr) return json({ error: qErr.message }, { status: 500, headers: corsHeaders(req) });

    const items = (queued ?? []) as any[];
    if (items.length === 0) {
      await markJobProgress(supabase, jobId);
      return json({ message: "No queued items", count: 0 }, { headers: corsHeaders(req) });
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      processed++;
      const itemId = String(item.id ?? "");
      const idx = Number(item.idx ?? 0) || 0;
      if (!itemId) continue;

      // Soft lock: mark running if still queued
      const { data: upd, error: lockErr } = await supabase
        .from("template_job_items")
        .update({ status: "running", updated_at: new Date().toISOString() } as any)
        .eq("id", itemId)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (lockErr || !upd) {
        // Someone else took it, or transient error.
        failed++;
        continue;
      }

      try {
        const bytes = await renderPdfFromSpec(item.template_spec_json ?? {});
        const path = `${jobId}/${String(idx).padStart(6, "0")}-${itemId.slice(0, 8)}.pdf`;

        const upRes = await supabase.storage
          .from("template_pdfs")
          .upload(path, new Blob([bytes], { type: "application/pdf" }), {
            contentType: "application/pdf",
            upsert: true,
          });
        if (upRes.error) throw new Error(`Storage upload failed: ${upRes.error.message}`);

        await supabase
          .from("template_job_items")
          .update({ status: "done", pdf_path: path, error: null } as any)
          .eq("id", itemId);

        await supabase.from("generated_templates").insert({
          client_id: jobClientId,
          job_id: jobId,
          job_item_id: itemId,
          template_spec_json: item.template_spec_json ?? {},
          pdf_path: path,
        } as any);

        succeeded++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("template_job_items").update({ status: "queued", error: msg } as any).eq("id", itemId);
        failed++;
      }
    }

    await markJobProgress(supabase, jobId);

    // Best-effort visibility timeout: re-queue stale running rows
    try {
      const cutoff = new Date(Date.now() - visibilityTimeoutSeconds * 1000).toISOString();
      await supabase
        .from("template_job_items")
        .update({ status: "queued" } as any)
        .eq("job_id", jobId)
        .eq("status", "running")
        .lt("updated_at", cutoff);
    } catch {
      // ignore
    }

    return json({ message: "Processed items", count: items.length, processed, succeeded, failed }, { headers: corsHeaders(req) });
  }

  return json({ error: "Missing or invalid action", expected: { action: "render" }, or: { action: "work" } }, { status: 400, headers: corsHeaders(req) });
});

