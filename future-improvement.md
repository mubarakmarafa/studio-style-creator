## Future improvement: scalable content generation for assembled templates

### Problem
Right now, the “Use AI to fill text” mode generates copy by calling an LLM during **preview generation**. This works for a small number of previews, but it will not scale well when:

- We enumerate hundreds/thousands of template combinations
- We want unique copy per generated template (to avoid duplicated content)
- We want to keep costs and latency predictable

### Proposed direction
Treat “template assembly” and “template copy generation” as **separate phases**:

1. **Phase A — Assemble templates deterministically**
   - Enumerate layouts × module mappings
   - Produce `template_spec_json` with structural placement only
   - No LLM calls here (fast, cheap, scalable)

2. **Phase B — Generate copy only when needed**
   - Only call the LLM when the user:
     - favorites a specific template
     - requests “Generate copy” for a selected template
     - exports/renders a specific template to PDF
   - This makes “unique per template” feasible without a massive batch call.

### Implementation ideas
- **Caching**
  - Cache LLM results keyed by `(userPrompt, templateId, moduleSet, layoutId, slotSchemaHash)`
  - If the user re-generates, reuse cached content.

- **Deterministic variety without extra LLM calls**
  - Use a seeded pseudo-random “variation key” per template to pick from:
    - multiple LLM-generated variants (small N)
    - a library of sentence templates
    - synonym/phrase banks

- **Server-side orchestration**
  - Move the “copy generation” step into an Edge Function for:
    - rate limiting
    - retries
    - logging / observability
    - cost controls (per-user quotas)

### UX note
In the short term, keep “AI fill” as a preview helper. Long term, shift to **on-demand copy generation per selected template** to avoid duplicated text and runaway API usage.

