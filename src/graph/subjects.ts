export type SubjectParseOptions = {
  /**
   * Maximum number of subjects to return.
   */
  max?: number;
  /**
   * If true, remove duplicates (case-insensitive).
   */
  dedupe?: boolean;
};

export function normalizeSubjects(list: string[], opts?: SubjectParseOptions): string[] {
  const max = typeof opts?.max === "number" && opts.max > 0 ? Math.floor(opts.max) : 20;
  const dedupe = opts?.dedupe ?? true;

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (dedupe) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

export function parseSubjectsText(text: string, opts?: SubjectParseOptions): string[] {
  const t = String(text ?? "");
  // Accept comma-separated and/or newline-separated values.
  const parts = t
    .split(/\r?\n/)
    .flatMap((line) => line.split(","))
    .map((s) => s.trim());
  return normalizeSubjects(parts, opts);
}

/**
 * Parse CSV text and return subjects from the first column.
 * Supports simple quoting (RFC-ish). We intentionally keep this minimal.
 */
export function parseSubjectsCsv(csvText: string, opts?: SubjectParseOptions): string[] {
  const text = String(csvText ?? "");
  const lines = text.split(/\r?\n/);
  const subjects: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseCsvRow(line);
    if (row.length === 0) continue;
    subjects.push(row[0] ?? "");
  }

  return normalizeSubjects(subjects, opts);
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          // Escaped quote
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}


