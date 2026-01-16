# Content Studio

Content Studio is a multi-app design system for generative workflows. It gives us a shared shell and a set of focused tools for building, combining, and producing visual content. This README is written for fellow designers who want to add new apps or expand existing ones.

## Apps in the studio today

- Style Builder: build node graphs that compile into a style JSON and generate images. Save projects and image assets.
- Module Forge: create reusable layout and content modules with slot-based templates.
- Template Assembler: wire layouts and module sets into a graph to generate template combinations, with optional AI text fill and PDF previews.
- Pack Creator: select a saved style plus a subject list and run background sticker pack jobs with a gallery and downloads.
- WIP ideas: Handwriting Synthesiser, Colour Palette Discoverer, Prompt Pack Writer (shown as disabled cards).

## How the pieces connect

- Style Builder produces compiled style JSON that becomes a saved style for Pack Creator.
- Module Forge produces layout and module specs that Template Assembler combines into final templates.
- Supabase stores projects, modules, assemblies, and generated assets for all apps.

## Add a new app (designer friendly)

1. Create a new folder in `src/apps/<yourApp>/`.
2. Build a main app component and (if needed) a router component.
3. Register your app in the studio registry so it shows up in the sidebar and landing page.

Example app entry:

```ts
// src/studio/appRegistry.ts
{
  id: "my-new-app",
  title: "My New App",
  description: "Short sentence describing the workflow.",
  route: "/my-new-app/*",
  navTo: "/my-new-app",
  icon: Sparkles,
  loader: () => import("@/apps/myNewApp/MyNewAppRouterApp"),
}
```

If your app is still a concept, add it to `WIP_STUDIO_APPS` instead so it shows as "Under Construction".

## App structure patterns to copy

- Use a RouterApp when you have list + editor views (see Style Builder, Module Forge, Template Assembler).
- Save a "last opened" id in localStorage to make returning feel instant.
- Keep list pages in a `max-w-*` container and use card grids for browsing.
- The Studio shell (`StudioLayout`) is shared, so your app should only render its own content area.

## Design conventions

- Use Tailwind utility tokens like `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, and `border`.
- Use `Modal` for dialog work and `cn()` for conditional class names.
- If you build a node editor, reuse `@xyflow/react` patterns from Style Builder or Template Assembler.

## Supabase data model (high level)

Tables:
- `style_builder_projects`, `style_builder_assets`
- `template_modules`, `template_assemblies`, `template_jobs`, `template_job_items`, `generated_templates`
- `sticker_styles`, `subject_lists`, `sticker_jobs`, `stickers`

Storage buckets:
- `style_builder_assets`
- `template_assets`, `template_pdfs`
- `stickers`, `sticker_thumbnails`

## Edge functions

- `openai-proxy`: chat, image generation, style-from-image, refine prompt.
- `sticker-pack`: create jobs, queue stickers, cancel or resume jobs.
- `sticker-worker`: process queued stickers and upload images.
- `template-pdf-render`: render PDFs for template previews or batch jobs.

## Local development

1. Install dependencies:
   - `npm install`
2. Copy `env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - Optional: `VITE_SUPABASE_FUNCTIONS_BASE_URL`
   - Optional: `VITE_STYLE_BUILDER_CLIENT_ID`
3. Run the app:
   - `npm run dev`

## Supabase setup (cloud)

1. Link the project:
   - `supabase link --project-ref <your-project-ref>`
2. Set secrets:
   - `supabase secrets set OPENAI_API_KEY=...`
   - `supabase secrets set SUPABASE_URL=...`
   - `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`
   - `supabase secrets set SUPABASE_DB_URL=...`
3. Deploy functions:
   - `supabase functions deploy openai-proxy`
   - `supabase functions deploy sticker-pack`
   - `supabase functions deploy sticker-worker`
   - `supabase functions deploy template-pdf-render`

## Supabase setup (local)

```bash
supabase start
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_KEY
supabase functions serve openai-proxy --no-verify-jwt
```

Then set `VITE_SUPABASE_FUNCTIONS_BASE_URL=http://localhost:54321/functions/v1`.

## Deploying the web app

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your hosting provider (Vercel or similar), then redeploy so Vite bakes the env vars into the build.

## Security note

The repo currently runs in a no-auth posture (`verify_jwt = false`). This is intentional for fast prototyping. If you plan to ship, enable auth, tighten RLS policies, and add rate limiting.
