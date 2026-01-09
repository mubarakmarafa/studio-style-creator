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

async function handleStyleFromImage(
  req: Request,
  body: { imageDataUrl?: string; model?: string; instruction?: string } | null,
): Promise<Response> {
  if (!OPENAI_API_KEY) {
    return json(
      { error: "Missing OPENAI_API_KEY (set as a Supabase secret)" },
      { status: 500, headers: corsHeaders(req) },
    );
  }

  const imageDataUrl = body?.imageDataUrl?.trim();
  const model = body?.model?.trim() || "gpt-5.2";
  const instruction =
    body?.instruction?.trim() ||
    [
      "You are a style-extraction assistant for an image-generation 'Style Builder'.",
      "Act like a thoughtful art critic: assess the image's visual language and artistic principles, not just a literal inventory of objects.",
      "",
      "Goal: produce a repeatable style template that can be reused with different subjects.",
      "The description MUST include a [subject] placeholder (exactly bracketed).",
      "",
      "CRITICAL: Keep the description SUBJECT-AGNOSTIC.",
      "- Do NOT mention what is depicted in the source image (no specific objects/people/animals/clothing).",
      "- Do NOT use anatomy-specific terms (e.g., head, face, eyes, hair) or item-specific terms (e.g., glasses) unless universally applicable to any [subject].",
      "- Express composition/framing generically using [subject] only (e.g., 'tight crop where [subject] dominates the frame').",
      "",
      "When writing the description, prioritize artistic qualities (some may be subjective):",
      "- composition principles (focal point hierarchy, balance, rhythm, negative space, framing, depth cues)",
      "- mood/atmosphere",
      "- stylistic influences (movement/era references if plausible; hedge if unsure)",
      "- color strategy (harmony/contrast, temperature, saturation, accent colors)",
      "- mark-making/line character and edge handling",
      "- surface/texture/material feel",
      "- lighting intent and shadow/specular behavior",
      "- camera/perspective choices",
      "",
      "Also include concrete constraints when present (background rules, transparent alpha PNG, sticker/die-cut border, medium/rendering pipeline).",
      "Avoid: brand names/logos, artist-name imitation, overly literal scene narration.",
      "",
      "Return ONLY valid JSON (no markdown, no code fences) with this shape:",
      '{ "description": string }',
    ].join("\n");

  if (!imageDataUrl) {
    return json(
      { error: "Missing imageDataUrl" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  // OpenAI accepts data URLs and https URLs, but OpenAI may not be able to reach
  // some URLs (timeouts / blocked networks). To make this robust, if a URL is provided,
  // we fetch it here and pass OpenAI a data URL.
  const isDataImage = imageDataUrl.startsWith("data:image/");
  const isHttpUrl = imageDataUrl.startsWith("http://") || imageDataUrl.startsWith("https://");
  if (!isDataImage && !isHttpUrl) {
    return json(
      { error: "imageDataUrl must be a data URL starting with data:image/... or a public http(s) URL" },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  let finalImageUrl = imageDataUrl;
  if (isHttpUrl) {
    try {
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 12_000);
      const res = await fetch(imageDataUrl, { signal: ctl.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        return json(
          { error: "Failed to download image URL", status: res.status, statusText: res.statusText },
          { status: 400, headers: corsHeaders(req) },
        );
      }
      const ct = res.headers.get("content-type") ?? "image/png";
      if (!ct.startsWith("image/")) {
        return json(
          { error: "Downloaded URL is not an image", content_type: ct },
          { status: 400, headers: corsHeaders(req) },
        );
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Hard cap to avoid huge payloads
      const MAX_BYTES = 10 * 1024 * 1024; // 10MB
      if (bytes.byteLength > MAX_BYTES) {
        return json(
          { error: "Image too large", bytes: bytes.byteLength, maxBytes: MAX_BYTES },
          { status: 400, headers: corsHeaders(req) },
        );
      }
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      finalImageUrl = `data:${ct};base64,${b64}`;
    } catch (e) {
      return json(
        { error: "Failed to download image URL", message: e instanceof Error ? e.message : String(e) },
        { status: 400, headers: corsHeaders(req) },
      );
    }
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_image", image_url: finalImageUrl },
          ],
        },
      ],
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
  body: { prompt?: string; model?: string; size?: string; quality?: "low" | "medium" | "high" } | null,
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
  const quality = body?.quality;

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
      ...(quality ? { quality } : {}),
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

async function handleRefinePrompt(
  req: Request,
  body: {
    originalPromptJson?: string;
    compiledTemplate?: unknown;
    upstreamNodes?: unknown;
    feedback?: string;
    sourceImageDataUrl?: string;
    generatedImageDataUrl?: string;
    model?: string;
  } | null,
): Promise<Response> {
  if (!OPENAI_API_KEY) {
    return json(
      { error: "Missing OPENAI_API_KEY (set as a Supabase secret)" },
      { status: 500, headers: corsHeaders(req) },
    );
  }

  const model = body?.model?.trim() || "gpt-5.2";
  const feedback = body?.feedback?.trim() || "";
  const originalPromptJson = body?.originalPromptJson?.trim() || "";

  if (!feedback) {
    return json(
      { error: "Missing feedback" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  if (!originalPromptJson) {
    return json(
      { error: "Missing originalPromptJson" },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  const sourceImageDataUrl = body?.sourceImageDataUrl?.trim();
  const generatedImageDataUrl = body?.generatedImageDataUrl?.trim();
  if (sourceImageDataUrl && !sourceImageDataUrl.startsWith("data:image/")) {
    return json(
      { error: "sourceImageDataUrl must be a data URL starting with data:image/..." },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  if (generatedImageDataUrl && !generatedImageDataUrl.startsWith("data:image/")) {
    return json(
      { error: "generatedImageDataUrl must be a data URL starting with data:image/..." },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  const compiledTemplate = body?.compiledTemplate ?? null;
  const upstreamNodes = body?.upstreamNodes ?? null;

  const instruction = [
    "You are a refinement assistant for an image-generation graph editor ('Style Builder').",
    "You will receive:",
    "- The ORIGINAL prompt JSON used for image generation (stringified JSON).",
    "- The current compiled template object (already parsed).",
    "- A list of upstream nodes (type/label/data) when available.",
    "- The SOURCE reference image (optional).",
    "- The GENERATED image we want to improve (optional).",
    "- The user's feedback (required).",
    "",
    "Your task: produce an improved prompt/template for the next run that addresses the user's feedback while preserving what already works.",
    "IMPORTANT RULES:",
    "- Return ONLY valid JSON. No markdown. No code fences. No extra keys outside the schema.",
    "- Do not include the base64 image data in your output.",
    "- Keep the JSON compact and consistent (strings where strings are expected).",
    "",
    "Return JSON with this schema:",
    "{",
    '  "improvedTemplate": object,',
    '  "nodeFieldEdits": object,',
    '  "notes": string',
    "}",
    "",
    "Where:",
    "- improvedTemplate is the full improved version of the compiled template object.",
    "- nodeFieldEdits is OPTIONAL guidance for updating node fields in a graph, keyed by node type.",
    "  Example:",
    "  {",
    '    "subject": { "subject": \"...\" },',
    '    "styleDescription": { "description": \"...\" },',
    '    "colorPalette": { \"range\": \"...\", \"hexes\": [\"#...\"] },',
    '    "output": { \"format\": \"PNG\", \"canvas_ratio\": \"1:1\" }',
    "  }",
    "",
    "Context:",
    `User feedback:\n${feedback}`,
    "",
    "ORIGINAL_PROMPT_JSON:",
    originalPromptJson,
    "",
    "COMPILED_TEMPLATE_OBJECT (JSON):",
    JSON.stringify(compiledTemplate),
    "",
    "UPSTREAM_NODES (JSON, may be null):",
    JSON.stringify(upstreamNodes),
  ].join("\n");

  const content: any[] = [{ type: "input_text", text: instruction }];
  if (sourceImageDataUrl) {
    content.push({ type: "input_image", image_url: sourceImageDataUrl });
  }
  if (generatedImageDataUrl) {
    content.push({ type: "input_image", image_url: generatedImageDataUrl });
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content,
        },
      ],
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
    if (action === "styleFromImage" || action === "style-from-image") {
      return await handleStyleFromImage(req, body);
    }
    if (action === "refinePrompt" || action === "refine-prompt") {
      return await handleRefinePrompt(req, body);
    }
    return json(
      {
        error: "Missing or invalid action",
        expected: { action: "chat" } as const,
        or: { action: "image" } as const,
        also: { action: "refinePrompt" } as const,
      },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Legacy routes: /functions/v1/openai-proxy/<route>
  if (path.endsWith("/chat")) return await handleChat(req, body);
  if (path.endsWith("/image")) return await handleImage(req, body);
  if (path.endsWith("/style-from-image")) return await handleStyleFromImage(req, body);

  return json(
    { error: "Not found. Use /openai-proxy with {action}, or /chat /image." },
    { status: 404, headers: corsHeaders(req) },
  );
});


