# OpenAI API Key Test (Vite + Supabase Edge Function)

This is a tiny Vite app to test:
- **Chat** (text response)
- **Image generation** (base64 image) — default model is `gpt-image-1` (you can type `gpt-image-1.5` if your account supports it)

Your **OpenAI API key never goes to the browser**. It’s stored on Supabase as a **secret** (`OPENAI_API_KEY`) and used only inside a Supabase **Edge Function**.

## 1) Create your Vite env file

Create **`.env.local`** in the project root:

```bash
VITE_SUPABASE_URL=https://thnhctjkonxzggdfyixw.supabase.co
# Recommended (safe to use in the browser): Supabase publishable key
VITE_SUPABASE_ANON_KEY=sb_publishable_2C2mZT_vil6-rj6WNhTK3w_Wa4Q6ecA
# Optional override (if inference fails):
# VITE_SUPABASE_FUNCTIONS_BASE_URL=https://YOUR-PROJECT-REF.supabase.co/functions/v1
```

Notes:
- `VITE_SUPABASE_ANON_KEY` can also be the legacy `anon` JWT key, but **publishable** is recommended for new apps.
- The key above is exactly the publishable key (no trailing `?`).
- After editing `.env.local`, **stop and restart** `npm run dev` (Vite only loads env vars on startup).

## 2) Install + run the frontend

```bash
npm install
npm run dev
```

## 3) Set up Supabase + deploy the Edge Function

### Option A: Supabase Cloud (recommended)

1. Install and login to the Supabase CLI.
2. Link this folder to your Supabase project:

```bash
supabase link --project-ref thnhctjkonxzggdfyixw
```

3. Store your OpenAI key as a secret (server-side only):

```bash
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_KEY
```

4. Deploy the function:

```bash
supabase functions deploy openai-proxy
```

### Option B: Supabase Local (works for testing)

```bash
supabase start
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_KEY
supabase functions serve openai-proxy --no-verify-jwt
```

Then set:

```bash
VITE_SUPABASE_FUNCTIONS_BASE_URL=http://localhost:54321/functions/v1
```

## Notes / security

- The repo includes `supabase/config.toml` with `verify_jwt = false` so you can test quickly.
- If you plan to ship this, switch to **`verify_jwt = true`**, require a logged-in user, and add rate limiting.


