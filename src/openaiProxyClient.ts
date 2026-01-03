import { ENV } from "./env";
import { ENV_STATE } from "./env";

type ProxyChatResponse = {
  text: string;
  raw?: unknown;
};

type ProxyImageResponse = {
  contentType: string;
  base64: string;
  raw?: unknown;
};

type ProxyStyleFromImageResponse = {
  text: string;
  raw?: unknown;
};

function functionsBaseUrl(): string {
  if (!ENV_STATE.ok) {
    throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
  }
  // Canonical Supabase Functions base URL:
  // - Cloud: https://<project-ref>.supabase.co/functions/v1
  // - Local: http://localhost:54321/functions/v1
  if (ENV.SUPABASE_FUNCTIONS_BASE_URL) return ENV.SUPABASE_FUNCTIONS_BASE_URL;
  try {
    const u = new URL(ENV.SUPABASE_URL!);
    return `${u.origin}/functions/v1`;
  } catch {
    throw new Error(
      "Could not infer functions base url. Set VITE_SUPABASE_FUNCTIONS_BASE_URL.",
    );
  }
}

function truncate(s: string, max = 800) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated, total ${s.length} chars)`;
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${functionsBaseUrl()}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // NOTE: This is a *public* key, safe to use in the browser.
      apikey: ENV.SUPABASE_ANON_KEY!,
      // Some gateways expect Authorization as well.
      Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY!}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "unknown";
    const raw = await res.text().catch(() => "");

    // Try to extract a useful message from JSON errors.
    let detail: string | undefined;
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(raw) as any;
        detail =
          parsed?.error?.message ??
          parsed?.error_description ??
          parsed?.message ??
          parsed?.error ??
          undefined;
      } catch {
        // ignore
      }
    }

    const hint404 =
      res.status === 404
        ? `\n\n404 usually means the function route wasn’t found. Expected:\n- ${url}\n\nConfirm the function is deployed as "openai-proxy" and that your base URL is correct (cloud: https://<ref>.supabase.co/functions/v1).`
        : "";

    throw new Error(
      [
        `Proxy error ${res.status} (${contentType})`,
        `URL: ${url}`,
        detail ? `Message: ${detail}` : undefined,
        raw ? `Body:\n${truncate(raw)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n") + hint404,
    );
  }
  return (await res.json()) as T;
}

export async function proxyChat(
  input: string,
  opts?: { model?: string; signal?: AbortSignal },
): Promise<ProxyChatResponse> {
  return await postJson<ProxyChatResponse>(
    "/openai-proxy/chat",
    { input, model: opts?.model },
    opts?.signal,
  );
}

export async function proxyImage(
  prompt: string,
  opts?: { model?: string; size?: string; signal?: AbortSignal },
): Promise<ProxyImageResponse> {
  return await postJson<ProxyImageResponse>(
    "/openai-proxy/image",
    { prompt, model: opts?.model, size: opts?.size },
    opts?.signal,
  );
}

export async function proxyStyleFromImage(
  imageDataUrl: string,
  opts?: { model?: string; instruction?: string; signal?: AbortSignal },
): Promise<ProxyStyleFromImageResponse> {
  return await postJson<ProxyStyleFromImageResponse>(
    "/openai-proxy/style-from-image",
    { imageDataUrl, model: opts?.model, instruction: opts?.instruction },
    opts?.signal,
  );
}


