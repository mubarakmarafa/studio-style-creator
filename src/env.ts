function str(name: string): string | undefined {
  const v = import.meta.env[name];
  if (!v) return undefined;
  return typeof v === "string" ? v : String(v);
}

const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter(
  (k) => !str(k),
);

export const ENV_STATE = {
  ok: missing.length === 0,
  missing,
  message:
    missing.length === 0
      ? undefined
      : `Missing ${missing.join(
          ", ",
        )}. Ensure you created a .env.local in the project root and RESTARTED the dev server.`,
} as const;

export const ENV = {
  // May be undefined if not configured yet. Use ENV_STATE.ok to gate usage.
  SUPABASE_URL: str("VITE_SUPABASE_URL"),
  SUPABASE_ANON_KEY: str("VITE_SUPABASE_ANON_KEY"),
  SUPABASE_FUNCTIONS_BASE_URL: str("VITE_SUPABASE_FUNCTIONS_BASE_URL"),
} as const;


