// Supabase Edge Function: openai-proxy
// - POST /openai-proxy           -> action router (recommended)
// - POST /openai-proxy/chat      -> text response (legacy)
// - POST /openai-proxy/image     -> base64 image (legacy)
//
// Store your key with:
//   supabase secrets set OPENAI_API_KEY=...
//
// This function is intentionally minimal and intended for *testing*.
// If you plan to ship it, add auth (verify_jwt: true), rate limiting, logging, and stricter CORS.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (!OPENAI_API_KEY) {
  console.warn("Missing OPENAI_API_KEY secret.");
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function handleChat(
  req: Request,
  body: { input?: string; model?: string } | null,
): Promise<Response> {
  if (!OPENAI_API_KEY) {
    return json(
      { error: "Missing OPENAI_API_KEY (set as a Supabase secret)" },
      { status: 500, headers: corsHeaders(req) },
    );
  }

  const input = body?.input?.trim();
  const model = body?.model?.trim() || "gpt-4.1-mini";

  if (!input) {
    return json(
      { error: "Missing input" },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Using the OpenAI Responses API for modern text responses.
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input,
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
    return json(
      {
        error: "OpenAI request failed",
        upstream_status: upstream.status,
        upstream: parsed ?? rawText,
      },
      { status: upstream.status, headers: corsHeaders(req) },
    );
  }

  const raw = JSON.parse(rawText) as any;
  const text =
    raw?.output_text ??
    raw?.output?.[0]?.content?.[0]?.text ??
    raw?.output?.[0]?.content?.[0]?.value ??
    "";

  return json({ text, raw }, { headers: corsHeaders(req) });
}

async function handleImage(
  req: Request,
  body: { prompt?: string; model?: string; size?: string } | null,
): Promise<Response> {
  if (!OPENAI_API_KEY) {
    return json(
      { error: "Missing OPENAI_API_KEY (set as a Supabase secret)" },
      { status: 500, headers: corsHeaders(req) },
    );
  }

  const prompt = body?.prompt?.trim();
  const model = body?.model?.trim() || "gpt-image-1";
  const size = body?.size?.trim() || "1024x1024";

  if (!prompt) {
    return json(
      { error: "Missing prompt" },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Image generation endpoint.
  // OpenAI expects POST /v1/images/generations for image generation.
  // If you specifically want "gpt-image-1.5" and OpenAI supports it, set the model from the client and it will pass through.
  const upstream = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
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
    return json(
      {
        error: "OpenAI image request failed",
        upstream_status: upstream.status,
        upstream: parsed ?? rawText,
        hint:
          "If this is a model access issue, try using gpt-image-1 or check your OpenAI account/model access.",
      },
      { status: upstream.status, headers: corsHeaders(req) },
    );
  }

  const raw = JSON.parse(rawText) as any;
  // Some OpenAI image APIs return base64 directly, others return a URL.
  let b64: string | undefined = raw?.data?.[0]?.b64_json;
  let contentType: string | undefined = "image/png";

  const imageUrl: string | undefined = raw?.data?.[0]?.url;
  if (!b64 && imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return json(
        {
          error: "Failed to fetch image URL returned by OpenAI",
          upstream_status: imgRes.status,
          upstream: await imgRes.text().catch(() => ""),
        },
        { status: 502, headers: corsHeaders(req) },
      );
    }
    contentType = imgRes.headers.get("content-type") ?? contentType;
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    // Base64 encode
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    b64 = btoa(binary);
  }

  if (!b64) {
    return json(
      { error: "No image returned from OpenAI", raw },
      { status: 502, headers: corsHeaders(req) },
    );
  }

  // OpenAI images are typically PNG; we’ll default to that unless OpenAI indicates otherwise.
  return json(
    { contentType: contentType ?? "image/png", base64: b64, raw },
    { headers: corsHeaders(req) },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders(req) },
    );
  }

  const body = (await req.json().catch(() => null)) as any | null;

  // Preferred: POST /openai-proxy with an action in the body.
  if (path.endsWith("/openai-proxy") || path === "/openai-proxy") {
    const action = typeof body?.action === "string" ? body.action : undefined;
    if (action === "chat") {
      return await handleChat(req, body);
    }
    if (action === "image") {
      return await handleImage(req, body);
    }
    return json(
      {
        error: "Missing or invalid action",
        expected: { action: "chat" } as const,
        or: { action: "image" } as const,
      },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Legacy routes: /functions/v1/openai-proxy/<route>
  if (path.endsWith("/chat")) return await handleChat(req, body);
  if (path.endsWith("/image")) return await handleImage(req, body);

  return json(
    { error: "Not found. Use /openai-proxy with {action}, or /chat /image." },
    { status: 404, headers: corsHeaders(req) },
  );
});


