// Supabase Edge Function: sticker-worker
// Drains PGMQ queue messages and generates sticker images server-side.
//
// Env vars (Supabase secrets):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - OPENAI_API_KEY
//
// Suggested: run via Supabase Cron every few seconds/minutes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  vt: string;
  enqueued_at: string;
  message: any;
};

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

function generateJsonPrompt(template: any, subject: string): string {
  const subj = String(subject ?? "").trim();
  const next =
    subj.length > 0
      ? {
          ...(template ?? {}),
          object_specification: {
            ...((template?.object_specification ?? {}) as any),
            subject: subj,
          },
        }
      : template;
  return JSON.stringify(next);
}

async function openaiGeneratePng(prompt: string): Promise<Uint8Array> {
  const key = requiredEnv("OPENAI_API_KEY");

  const upstream = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    }),
  });

  const rawText = await upstream.text();
  if (!upstream.ok) {
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // ignore
    }
    throw new Error(
      `OpenAI image request failed (${upstream.status}): ${JSON.stringify(parsed ?? rawText).slice(0, 800)}`,
    );
  }

  const raw = JSON.parse(rawText) as any;
  const b64: string | undefined = raw?.data?.[0]?.b64_json;
  const imageUrl: string | undefined = raw?.data?.[0]?.url;

  if (b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch OpenAI image URL (${imgRes.status})`);
    return new Uint8Array(await imgRes.arrayBuffer());
  }

  throw new Error("No image returned from OpenAI");
}

async function ensureBuckets(supabase: ReturnType<typeof createClient>) {
  const buckets = [
    { id: "stickers", public: true },
    { id: "sticker_thumbnails", public: true },
  ] as const;

  for (const b of buckets) {
    const res = await supabase.storage.createBucket(b.id, { public: b.public }).catch((e) => ({ error: e }));
    const err: any = (res as any)?.error;
    if (!err) continue;
    const msg = typeof err?.message === "string" ? err.message : String(err);
    if (msg.toLowerCase().includes("already exists")) continue;
    if (msg.toLowerCase().includes("duplicate")) continue;
    console.warn(`[sticker-worker] createBucket(${b.id}) failed: ${msg}`);
  }
}

async function markJobProgress(supabase: ReturnType<typeof createClient>, jobId: string) {
  const { count: doneCount } = await supabase
    .from("stickers")
    .select("id", { head: true, count: "exact" })
    .eq("job_id", jobId)
    .eq("status", "done");
  const { count: totalCount } = await supabase
    .from("stickers")
    .select("id", { head: true, count: "exact" })
    .eq("job_id", jobId);

  const completed = typeof doneCount === "number" ? doneCount : 0;
  const total = typeof totalCount === "number" ? totalCount : 0;
  const status = total > 0 && completed >= total ? "done" : "running";

  await supabase.from("sticker_jobs").update({ completed, total, status }).eq("id", jobId);
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
    // OPENAI_API_KEY is validated during generation.
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

  const body = (await req.json().catch(() => ({}))) as any;
  const batchSize = Math.max(1, Math.min(25, Number.isFinite(body?.batchSize) ? Number(body.batchSize) : 5));
  const visibilityTimeoutSeconds = Math.max(
    10,
    Math.min(600, Number.isFinite(body?.visibilityTimeoutSeconds) ? Number(body.visibilityTimeoutSeconds) : 60),
  );
  const maxAttempts = Math.max(1, Math.min(10, Number.isFinite(body?.maxAttempts) ? Number(body.maxAttempts) : 5));

  let msgs: QueueMessage[] = [];
  try {
    msgs = (await SQL`select * from pgmq.read('sticker_tasks', ${visibilityTimeoutSeconds}, ${batchSize})`) as any;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return json(
      { error: `Error reading queue: ${detail}` },
      { status: 500, headers: corsHeaders(req) },
    );
  }
  if (msgs.length === 0) {
    return json({ message: "No messages", count: 0 }, { headers: corsHeaders(req) });
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const m of msgs) {
    processed++;
    const msgId = (m as any).msg_id;
    let payload: any = (m as any).message ?? {};
    // postgresjs returns json/jsonb as strings by default. Parse if needed.
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        // leave as-is
      }
    }
    const stickerId = typeof payload?.stickerId === "string" ? payload.stickerId : "";
    const jobIdHint = typeof payload?.jobId === "string" ? payload.jobId : "";
    if (!stickerId) {
      // Bad message; delete it to avoid poison pill.
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      failed++;
      continue;
    }

    // Load sticker + job + style
    const { data: stickerRow, error: sErr } = await supabase
      .from("stickers")
      .select("id, job_id, subject, status, attempts, image_url")
      .eq("id", stickerId)
      .maybeSingle();
    if (sErr || !stickerRow) {
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      failed++;
      continue;
    }

    const jobId = (stickerRow as any).job_id as string;
    const subject = (stickerRow as any).subject as string;
    const attempts = Number((stickerRow as any).attempts ?? 0) || 0;
    const stickerStatus = String((stickerRow as any).status ?? "");
    const imageUrl = (stickerRow as any).image_url as string | null;

    // If the sticker is already completed, drop duplicate queue messages safely.
    if (stickerStatus === "done" && imageUrl) {
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      succeeded++;
      continue;
    }

    // Only process queued stickers. If another worker already picked it up, drop this duplicate.
    if (stickerStatus !== "queued") {
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      failed++;
      continue;
    }

    if (attempts >= maxAttempts) {
      await supabase
        .from("stickers")
        .update({ status: "error", error: `Max attempts exceeded (${maxAttempts})` })
        .eq("id", stickerId);
      await markJobProgress(supabase, jobId);
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      failed++;
      continue;
    }

    await supabase.from("stickers").update({ status: "running", attempts: attempts + 1 }).eq("id", stickerId);
    await supabase.from("sticker_jobs").update({ status: "running" }).eq("id", jobId);

    const { data: jobRow, error: jErr } = await supabase
      .from("sticker_jobs")
      .select("id, style_id, status")
      .eq("id", jobId)
      .maybeSingle();
    if (jErr || !jobRow) {
      // leave message (retry)
      failed++;
      continue;
    }

    if (String((jobRow as any).status) === "cancelled") {
      // Job cancelled: delete message and stop processing.
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      failed++;
      continue;
    }

    const { data: styleRow, error: stErr } = await supabase
      .from("sticker_styles")
      .select("id, compiled_template")
      .eq("id", (jobRow as any).style_id)
      .maybeSingle();
    if (stErr || !styleRow) {
      failed++;
      continue;
    }

    try {
      const prompt = generateJsonPrompt((styleRow as any).compiled_template, subject);
      const png = await openaiGeneratePng(prompt);
      const path = `${jobId}/${stickerId}.png`;

      const upRes = await supabase.storage
        .from("stickers")
        .upload(path, new Blob([png], { type: "image/png" }), { contentType: "image/png", upsert: true });
      if (upRes.error) throw new Error(`Storage upload failed: ${upRes.error.message}`);

      const publicUrl = supabase.storage.from("stickers").getPublicUrl(path).data.publicUrl;

      await supabase
        .from("stickers")
        .update({ status: "done", image_path: path, image_url: publicUrl, error: null })
        .eq("id", stickerId);

      await markJobProgress(supabase, jobId);
      await SQL`select pgmq.delete('sticker_tasks', ${msgId}::bigint)`;
      succeeded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("stickers").update({ status: "queued", error: msg }).eq("id", stickerId);
      // Do NOT delete message; it will become visible again after VT.
      await markJobProgress(supabase, jobIdHint || jobId);
      failed++;
    }
  }

  return json(
    { message: "Processed messages", count: msgs.length, processed, succeeded, failed },
    { headers: corsHeaders(req) },
  );
});

