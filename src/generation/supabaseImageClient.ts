import { ENV, ENV_STATE } from "@/env";

type ImageGenerationResponse = {
  contentType: string;
  base64: string;
  raw?: unknown;
};

function truncate(s: string, max = 1200) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated, total ${s.length} chars)`;
}

function functionsBaseUrl(): string {
  if (!ENV_STATE.ok) {
    throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
  }
  if (ENV.SUPABASE_FUNCTIONS_BASE_URL) return ENV.SUPABASE_FUNCTIONS_BASE_URL;
  try {
    const u = new URL(ENV.SUPABASE_URL!);
    return `${u.origin}/functions/v1`;
  } catch {
    throw new Error(
      "Could not infer functions base url. Set VITE_SUPABASE_FUNCTIONS_BASE_URL."
    );
  }
}

export async function generateImage(
  prompt: string,
  opts?: { model?: string; size?: string; quality?: "low" | "medium" | "high"; signal?: AbortSignal }
): Promise<ImageGenerationResponse> {
  const url = `${functionsBaseUrl()}/openai-proxy/image`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ENV.SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY!}`,
    },
    body: JSON.stringify({
      prompt,
      model: opts?.model || "gpt-image-1",
      size: opts?.size || "1024x1024",
      quality: opts?.quality,
    }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "unknown";
    const raw = await res.text().catch(() => "");
    let detail: string | undefined;
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(raw) as any;
        detail =
          parsed?.error?.message ??
          parsed?.error_description ??
          parsed?.message ??
          parsed?.error ??
          // Supabase edge function wraps OpenAI errors as `{ upstream: {...} }`
          parsed?.upstream?.error?.message ??
          parsed?.upstream?.message ??
          undefined;
      } catch {
        // ignore
      }
    }
    const rawHint = raw ? `\nBody:\n${truncate(raw)}` : "";
    throw new Error(
      `Image generation failed ${res.status} (${contentType})${detail ? `: ${detail}` : ""}${rawHint}`
    );
  }

  return (await res.json()) as ImageGenerationResponse;
}

