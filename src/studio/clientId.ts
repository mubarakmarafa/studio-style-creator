import { ENV } from "@/env";

const STORAGE_KEY = "studio:clientId";

function generateClientId(): string {
  return `client_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 24);
}

export function getStudioClientId(): string {
  // Prefer explicit env override (useful for multi-device consistency).
  const fromEnv = (ENV.STYLE_BUILDER_CLIENT_ID ?? "").trim();
  if (fromEnv) return fromEnv;

  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim()) return existing.trim();
    const created = generateClientId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // localStorage not available (very rare); fall back to ephemeral.
    return generateClientId();
  }
}

