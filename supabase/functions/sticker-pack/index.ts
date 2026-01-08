// Supabase Edge Function: sticker-pack
// Creates sticker_jobs + stickers rows and enqueues one queue message per sticker.
//
// Env vars (Supabase secrets):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

type Json = Record<string, unknown>;

function json(data: unknown, init?: ResponseInit) {
  const h = new Headers(init?.headers ?? {});
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(data), {
    headers: h,
    ...init,
  });
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

const SQL = (() => {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return null;
  return postgres(dbUrl, { prepare: false });
})();

async function ensureBuckets(supabase: ReturnType<typeof createClient>) {
  // Create buckets if missing. Ignore "already exists" errors.
  const buckets = [
    { id: "stickers", public: true },
    { id: "sticker_thumbnails", public: true },
  ] as const;

  for (const b of buckets) {
    const res = await supabase.storage.createBucket(b.id, { public: b.public }).catch((e) => ({
      error: e,
    }));
    // Some environments throw instead of returning { error }.
    const err: any = (res as any)?.error;
    if (!err) continue;
    const msg = typeof err?.message === "string" ? err.message : String(err);
    if (msg.toLowerCase().includes("already exists")) continue;
    if (msg.toLowerCase().includes("duplicate")) continue;
    // Best-effort; do not fail job creation if buckets exist but creation call is unsupported.
    console.warn(`[sticker-pack] createBucket(${b.id}) failed: ${msg}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders(req) });
    }

    const body = (await req.json().catch(() => null)) as any | null;
    const action = typeof body?.action === "string" ? body.action : "create";
    if (action !== "create" && action !== "resume" && action !== "cancel") {
      return json(
        {
          error: "Missing or invalid action",
          expected: { action: "create" },
          also_supported: [{ action: "resume" }, { action: "cancel" }],
        },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    let supabaseUrl = "";
    let serviceKey = "";
    try {
      supabaseUrl = requiredEnv("SUPABASE_URL");
      serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500, headers: corsHeaders(req) },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await ensureBuckets(supabase);
    if (!SQL) {
      return json(
        { error: "Missing SUPABASE_DB_URL env var (required for queue operations)" },
        { status: 500, headers: corsHeaders(req) },
      );
    }

    // Cancel: delete job + stickers and remove any generated images from Storage.
    if (action === "cancel") {
      const jobId = typeof body?.jobId === "string" ? body.jobId : "";
      if (!jobId) {
        return json({ error: "Missing jobId" }, { status: 400, headers: corsHeaders(req) });
      }

      // Best-effort: mark as cancelled first so workers can skip.
      await supabase.from("sticker_jobs").update({ status: "cancelled" }).eq("id", jobId);

      const { data: stickerRows, error: stErr } = await supabase
        .from("stickers")
        .select("id,image_path")
        .eq("job_id", jobId);
      if (stErr) {
        return json({ error: "Failed to load stickers for job", detail: stErr.message }, { status: 500, headers: corsHeaders(req) });
      }

      // Delete images from Storage (by explicit paths and by prefix listing to catch any strays).
      const paths = new Set<string>();
      for (const r of (stickerRows ?? []) as any[]) {
        const p = String(r.image_path ?? "").trim();
        if (p) paths.add(p);
      }

      // List all objects under `${jobId}/` (pagination via offset).
      let offset = 0;
      const limit = 1000;
      while (true) {
        const { data: listed, error: listErr } = await supabase.storage.from("stickers").list(jobId, { limit, offset });
        if (listErr) break; // best-effort
        const files = (listed ?? []).filter((x: any) => x && x.name && !x.id?.endsWith?.("/"));
        for (const f of files as any[]) {
          paths.add(`${jobId}/${String(f.name)}`);
        }
        if (!listed || listed.length < limit) break;
        offset += limit;
      }

      let deletedFiles = 0;
      const toDelete = Array.from(paths);
      for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const res = await supabase.storage.from("stickers").remove(chunk);
        if (!res.error) deletedFiles += chunk.length;
      }

      const { error: delStickersErr, count: stickerCount } = await supabase
        .from("stickers")
        .delete({ count: "exact" })
        .eq("job_id", jobId);
      if (delStickersErr) {
        return json({ error: "Failed to delete stickers", detail: delStickersErr.message }, { status: 500, headers: corsHeaders(req) });
      }

      const { error: delJobErr } = await supabase.from("sticker_jobs").delete().eq("id", jobId);
      if (delJobErr) {
        return json({ error: "Failed to delete job", detail: delJobErr.message }, { status: 500, headers: corsHeaders(req) });
      }

      return json(
        { jobId, deletedStickers: typeof stickerCount === "number" ? stickerCount : 0, deletedFiles },
        { headers: corsHeaders(req) },
      );
    }

    // Resume: re-enqueue messages for any queued stickers in an existing job.
    if (action === "resume") {
      const jobId = typeof body?.jobId === "string" ? body.jobId : "";
      if (!jobId) {
        return json({ error: "Missing jobId" }, { status: 400, headers: corsHeaders(req) });
      }

      // Ensure job exists
      const { data: jobRow, error: jobErr } = await supabase
        .from("sticker_jobs")
        .select("id,status,total,completed")
        .eq("id", jobId)
        .maybeSingle();
      if (jobErr) {
        return json({ error: "Failed to load job", detail: jobErr.message }, { status: 500, headers: corsHeaders(req) });
      }
      if (!jobRow) {
        return json({ error: "Job not found" }, { status: 404, headers: corsHeaders(req) });
      }

      const queued = (await SQL`
        select id, job_id
        from public.stickers
        where job_id = ${jobId}::uuid
          and status = 'queued'
      `) as any[];

      let enqueued = 0;
      for (const r of queued) {
        const msg = { stickerId: String(r.id), jobId: String(r.job_id) };
        await SQL`select pgmq.send('sticker_tasks', ${JSON.stringify(msg)}::jsonb, 0)`;
        enqueued++;
      }

      if (enqueued > 0) {
        await supabase.from("sticker_jobs").update({ status: "running" }).eq("id", jobId);
      }

      return json({ jobId, enqueued }, { headers: corsHeaders(req) });
    }

    const styleId = typeof body?.styleId === "string" ? body.styleId : "";
    const subjectListId = typeof body?.subjectListId === "string" ? body.subjectListId : "";
    if (!styleId || !subjectListId) {
      return json(
        { error: "Missing styleId or subjectListId" },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    // Load subjects
    const { data: subjRow, error: subjErr } = await supabase
      .from("subject_lists")
      .select("id, subjects")
      .eq("id", subjectListId)
      .maybeSingle();
    if (subjErr) {
      return json(
        { error: "Failed to load subject list", detail: subjErr.message },
        { status: 500, headers: corsHeaders(req) },
      );
    }
    if (!subjRow) {
      return json({ error: "Subject list not found" }, { status: 404, headers: corsHeaders(req) });
    }

    const subjects = Array.isArray((subjRow as any).subjects) ? ((subjRow as any).subjects as unknown[]) : [];
    const subjectStrings = subjects.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0);
    if (subjectStrings.length === 0) {
      return json(
        { error: "Subject list has no subjects" },
        { status: 400, headers: corsHeaders(req) },
      );
    }

    // Validate style exists
    const { data: styleRow, error: styleErr } = await supabase
      .from("sticker_styles")
      .select("id")
      .eq("id", styleId)
      .maybeSingle();
    if (styleErr) {
      return json(
        { error: "Failed to load style", detail: styleErr.message },
        { status: 500, headers: corsHeaders(req) },
      );
    }
    if (!styleRow) {
      return json({ error: "Style not found" }, { status: 404, headers: corsHeaders(req) });
    }

    // Create job
    const { data: jobRow, error: jobErr } = await supabase
      .from("sticker_jobs")
      .insert({
        style_id: styleId,
        subject_list_id: subjectListId,
        total: subjectStrings.length,
        completed: 0,
        status: "queued",
      })
      .select("id,total")
      .single();
    if (jobErr) {
      return json(
        { error: "Failed to create job", detail: jobErr.message },
        { status: 500, headers: corsHeaders(req) },
      );
    }

    // Create stickers
    const stickerRows = subjectStrings.map((subject) => ({
      job_id: jobRow.id,
      subject,
      status: "queued",
      attempts: 0,
    }));

    const { data: stickers, error: stickersErr } = await supabase
      .from("stickers")
      .insert(stickerRows)
      .select("id");
    if (stickersErr) {
      return json(
        { error: "Failed to create stickers", detail: stickersErr.message },
        { status: 500, headers: corsHeaders(req) },
      );
    }

    // Do not rely solely on PostgREST returning all inserted rows. Query by job_id to be safe.
    const insertedIds =
      Array.isArray(stickers) && stickers.length > 0
        ? stickers.map((s: any) => String(s?.id)).filter((x) => x.length > 0)
        : [];
    const needsFallback = insertedIds.length !== subjectStrings.length;
    const idRows =
      !needsFallback
        ? insertedIds.map((id) => ({ id }))
        : ((await supabase.from("stickers").select("id").eq("job_id", jobRow.id))?.data as any[] | null) ?? [];

    const messages: Json[] = (idRows ?? []).map((s: any) => ({ stickerId: s.id, jobId: jobRow.id }));

    // Enqueue tasks via direct Postgres connection (doesn't depend on PostgREST schema exposure).
    for (const msg of messages) {
      try {
        await SQL`select pgmq.send('sticker_tasks', ${JSON.stringify(msg)}::jsonb, 0)`;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        // Mark job as error so UI can surface it.
        await supabase.from("sticker_jobs").update({ status: "error", error: detail }).eq("id", jobRow.id);
        return json(
          { error: "Failed to enqueue sticker task", detail, jobId: jobRow.id },
          { status: 500, headers: corsHeaders(req) },
        );
      }
    }

    return json(
      { jobId: jobRow.id, total: jobRow.total },
      { headers: corsHeaders(req) },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[sticker-pack] unhandled error:", e);
    return json(
      { error: "Unhandled error", message: msg, stack },
      { status: 500, headers: corsHeaders(req) },
    );
  }
});

