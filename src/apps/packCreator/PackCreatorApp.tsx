import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/supabase";
import { parseSubjectsCsv, parseSubjectsText } from "@/graph/subjects";
import { zipSync, strToU8 } from "fflate";
import { ENV, ENV_STATE } from "@/env";
import { Modal } from "@/components/Modal";

type StickerStyle = {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
  created_at: string;
};

type SubjectList = {
  id: string;
  name: string;
  description: string;
  subjects_text: string;
  subjects: string[];
  csv_filename: string | null;
  created_at: string;
};

type StickerJob = {
  id: string;
  style_id: string;
  subject_list_id: string;
  total: number;
  completed: number;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  error: string | null;
  created_at?: string;
};

type StickerRow = {
  id: string;
  job_id: string;
  subject: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  attempts: number;
  image_url: string | null;
  error: string | null;
};

const LAST_JOB_STORAGE_KEY = "packCreator:lastJobId";

export default function PackCreatorApp() {
  const [styles, setStyles] = useState<StickerStyle[]>([]);
  const [subjectLists, setSubjectLists] = useState<SubjectList[]>([]);
  const [jobs, setJobs] = useState<StickerJob[]>([]);
  const [jobCovers, setJobCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [selectedStyleId, setSelectedStyleId] = useState<string>("");
  const [selectedSubjectListId, setSelectedSubjectListId] = useState<string>("");

  const [creatingList, setCreatingList] = useState(false);
  const [listName, setListName] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [listSubjectsText, setListSubjectsText] = useState("");
  const [listCsvFilename, setListCsvFilename] = useState<string | null>(null);
  const listFileInputRef = useRef<HTMLInputElement | null>(null);

  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<StickerJob | null>(null);
  const [stickers, setStickers] = useState<StickerRow[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryJobId, setGalleryJobId] = useState<string | null>(null);
  const [galleryJob, setGalleryJob] = useState<StickerJob | null>(null);
  const [galleryStickers, setGalleryStickers] = useState<StickerRow[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollRef = useRef<number | null>(null);
  const workerKickRef = useRef<number | null>(null);
  const workerInFlightRef = useRef(false);

  // Edit: Style
  const [editStyleOpen, setEditStyleOpen] = useState(false);
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [editStyleName, setEditStyleName] = useState("");
  const [editStyleDescription, setEditStyleDescription] = useState("");
  const [editStyleJson, setEditStyleJson] = useState("");
  const [editStyleSaving, setEditStyleSaving] = useState(false);
  const [editStyleErr, setEditStyleErr] = useState<string | null>(null);
  const [editStyleThumbUrl, setEditStyleThumbUrl] = useState<string | null>(null);
  const [editStyleThumbCandidates, setEditStyleThumbCandidates] = useState<
    Array<{ id: string; url: string; label?: string }>
  >([]);
  const [editStyleThumbLoading, setEditStyleThumbLoading] = useState(false);

  // Edit: Subject list
  const [editListOpen, setEditListOpen] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editListName, setEditListName] = useState("");
  const [editListDescription, setEditListDescription] = useState("");
  const [editListSubjectsText, setEditListSubjectsText] = useState("");
  const [editListSaving, setEditListSaving] = useState(false);
  const [editListErr, setEditListErr] = useState<string | null>(null);

  const selectedList = useMemo(
    () => subjectLists.find((l) => l.id === selectedSubjectListId) ?? null,
    [subjectLists, selectedSubjectListId],
  );

  const parsedListSubjects = useMemo(() => parseSubjectsText(listSubjectsText), [listSubjectsText]);

  function functionsBaseUrl(): string {
    if (!ENV_STATE.ok) {
      throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
    }
    if (ENV.SUPABASE_FUNCTIONS_BASE_URL) return ENV.SUPABASE_FUNCTIONS_BASE_URL;
    const u = new URL(ENV.SUPABASE_URL!);
    return `${u.origin}/functions/v1`;
  }

  async function invokeFunctionJson<T>(name: string, body: unknown): Promise<T> {
    if (!ENV_STATE.ok) {
      throw new Error(ENV_STATE.message ?? "Missing required Vite env vars.");
    }
    const url = `${functionsBaseUrl()}/${name.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ENV.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY!}`,
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      // Try to surface JSON error body even if content-type is text/plain.
      try {
        const parsed = JSON.parse(raw);
        throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(parsed)}`);
      } catch {
        throw new Error(`${res.status} ${res.statusText}: ${raw || "Unknown error"}`);
      }
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Some runtimes set content-type text/plain; still return JSON text.
      throw new Error(`Function ${name} returned non-JSON: ${raw.slice(0, 400)}`);
    }
  }

  async function refreshAll() {
    setErr(null);
    setLoading(true);
    try {
      const [{ data: s, error: sErr }, { data: l, error: lErr }, { data: j, error: jErr }] = await Promise.all([
        supabase
          .from("sticker_styles")
          .select("id,name,description,thumbnail_url,created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("subject_lists")
          .select("id,name,description,subjects_text,subjects,csv_filename,created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("sticker_jobs")
          .select("id,style_id,subject_list_id,total,completed,status,error,created_at")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (sErr) throw sErr;
      if (lErr) throw lErr;
      if (jErr) throw jErr;

      setStyles((s ?? []) as any);
      setSubjectLists(
        (l ?? []).map((row: any) => ({
          ...row,
          subjects: Array.isArray(row.subjects) ? row.subjects : [],
        })),
      );
      const nextJobs = (j ?? []) as any as StickerJob[];
      setJobs(nextJobs);

      // Build cover thumbnails (first done sticker per job).
      const jobIds = nextJobs.map((row) => row.id).filter(Boolean);
      if (jobIds.length > 0) {
        const { data: coverRows } = await supabase
          .from("stickers")
          .select("job_id,image_url,created_at,status")
          .in("job_id", jobIds as any)
          .eq("status", "done")
          .not("image_url", "is", null)
          .order("created_at", { ascending: true });
        const covers: Record<string, string> = {};
        for (const r of (coverRows ?? []) as any[]) {
          const jid = String(r.job_id ?? "");
          const url = String(r.image_url ?? "");
          if (!jid || !url) continue;
          if (!covers[jid]) covers[jid] = url;
        }
        setJobCovers(covers);
      } else {
        setJobCovers({});
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchStyleThumbnailCandidates(styleId: string) {
    // Find recent rendered stickers for this style across all jobs.
    const { data: j, error: jErr } = await supabase
      .from("sticker_jobs")
      .select("id,created_at")
      .eq("style_id", styleId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (jErr) throw jErr;
    const jobIds = (j ?? []).map((row: any) => String(row.id)).filter(Boolean);
    if (jobIds.length === 0) return [];

    const { data: st, error: stErr } = await supabase
      .from("stickers")
      .select("id,job_id,subject,image_url,created_at,status")
      .in("job_id", jobIds as any)
      .eq("status", "done")
      .not("image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(60);
    if (stErr) throw stErr;

    const out: Array<{ id: string; url: string; label?: string }> = [];
    const seen = new Set<string>();
    for (const r of (st ?? []) as any[]) {
      const url = String(r.image_url ?? "");
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        id: String(r.id ?? `${r.job_id}:${out.length}`),
        url,
        label: String(r.subject ?? "").trim() || undefined,
      });
      if (out.length >= 24) break;
    }
    return out;
  }

  async function openEditStyle(styleId: string) {
    setErr(null);
    setEditStyleErr(null);
    setEditStyleThumbCandidates([]);
    setEditStyleThumbUrl(null);
    setEditStyleOpen(true);
    setEditingStyleId(styleId);
    setEditStyleSaving(false);

    try {
      const { data, error } = await supabase
        .from("sticker_styles")
        .select("id,name,description,compiled_template,thumbnail_url,thumbnail_path")
        .eq("id", styleId)
        .single();
      if (error) throw error;

      const row: any = data;
      setEditStyleName(String(row?.name ?? ""));
      setEditStyleDescription(String(row?.description ?? ""));
      setEditStyleJson(JSON.stringify(row?.compiled_template ?? {}, null, 2));

      const existingThumb = typeof row?.thumbnail_url === "string" && row.thumbnail_url.trim() ? row.thumbnail_url : null;
      if (existingThumb) setEditStyleThumbUrl(existingThumb);

      setEditStyleThumbLoading(true);
      try {
        const candidates = await fetchStyleThumbnailCandidates(styleId);
        // Put current thumbnail (if present) first so it doesn't "disappear" from selection.
        const merged = [
          ...(existingThumb ? [{ id: "current", url: existingThumb, label: "Current thumbnail" }] : []),
          ...candidates.filter((c) => c.url !== existingThumb),
        ];
        setEditStyleThumbCandidates(merged);
      } finally {
        setEditStyleThumbLoading(false);
      }
    } catch (e) {
      setEditStyleErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEditedStyle() {
    const styleId = editingStyleId;
    if (!styleId) return;

    const name = editStyleName.trim();
    if (!name) {
      setEditStyleErr("Style name is required.");
      return;
    }

    let compiled_template: any = null;
    try {
      compiled_template = JSON.parse(editStyleJson);
    } catch {
      setEditStyleErr("Compiled JSON must be valid JSON.");
      return;
    }

    setEditStyleErr(null);
    setEditStyleSaving(true);
    try {
      const { data: before } = await supabase
        .from("sticker_styles")
        .select("thumbnail_path,thumbnail_url")
        .eq("id", styleId)
        .maybeSingle();

      // Update name/description/template
      const { error } = await supabase
        .from("sticker_styles")
        .update({
          name,
          description: editStyleDescription.trim(),
          compiled_template,
        } as any)
        .eq("id", styleId);
      if (error) throw error;

      // Optional thumbnail upload
      const selectedThumb = (editStyleThumbUrl ?? "").trim();
      if (selectedThumb) {
        const res = await fetch(selectedThumb);
        if (!res.ok) throw new Error(`Failed to fetch thumbnail image (${res.status})`);
        const buf = await res.arrayBuffer();
        const ct = res.headers.get("content-type") ?? "image/png";
        const blob = new Blob([buf], { type: ct });

        const path = `${styleId}/thumbnail.png`;
        const up = await supabase.storage
          .from("sticker_thumbnails")
          .upload(path, blob, { contentType: blob.type || "image/png", upsert: true });
        if (up.error) throw up.error;
        const publicUrl = supabase.storage.from("sticker_thumbnails").getPublicUrl(path).data.publicUrl;

        const { error: updErr } = await supabase
          .from("sticker_styles")
          .update({ thumbnail_path: path, thumbnail_url: publicUrl } as any)
          .eq("id", styleId);
        if (updErr) throw updErr;
      } else if ((before as any)?.thumbnail_url) {
        // Allow clearing the thumbnail (we keep the object around; just remove the pointer).
        const { error: clrErr } = await supabase
          .from("sticker_styles")
          .update({ thumbnail_path: null, thumbnail_url: null } as any)
          .eq("id", styleId);
        if (clrErr) throw clrErr;
      }

      setEditStyleOpen(false);
      setEditingStyleId(null);
      await refreshAll();
    } catch (e) {
      setEditStyleErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditStyleSaving(false);
    }
  }

  async function openEditSubjectList(listId: string) {
    setErr(null);
    setEditListErr(null);
    setEditListOpen(true);
    setEditingListId(listId);
    setEditListSaving(false);

    try {
      const { data, error } = await supabase
        .from("subject_lists")
        .select("id,name,description,subjects_text,subjects,csv_filename")
        .eq("id", listId)
        .single();
      if (error) throw error;
      const row: any = data;
      setEditListName(String(row?.name ?? ""));
      setEditListDescription(String(row?.description ?? ""));
      setEditListSubjectsText(String(row?.subjects_text ?? ""));
    } catch (e) {
      setEditListErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEditedSubjectList() {
    const listId = editingListId;
    if (!listId) return;

    const name = editListName.trim();
    if (!name) {
      setEditListErr("List name is required.");
      return;
    }
    const subjects = parseSubjectsText(editListSubjectsText);
    if (subjects.length === 0) {
      setEditListErr("Add at least one subject.");
      return;
    }

    setEditListErr(null);
    setEditListSaving(true);
    try {
      const { error } = await supabase
        .from("subject_lists")
        .update({
          name,
          description: editListDescription.trim(),
          subjects_text: editListSubjectsText,
          subjects,
        } as any)
        .eq("id", listId);
      if (error) throw error;

      setEditListOpen(false);
      setEditingListId(null);
      await refreshAll();
    } catch (e) {
      setEditListErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditListSaving(false);
    }
  }

  useEffect(() => {
    (async () => {
      await refreshAll();

      // Resume last job after refresh so the UI doesn't "lose" the running pack.
      // This does not affect the backend queue; it only restores UI state.
      try {
        const stored = localStorage.getItem(LAST_JOB_STORAGE_KEY);
        if (stored && typeof stored === "string") {
          await loadJob(stored);
          subscribeToJob(stored);
          return;
        }
      } catch {
        // ignore localStorage issues
      }
    })();

    // Cleanup realtime subscription on unmount
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      if (workerKickRef.current) window.clearInterval(workerKickRef.current);
      workerKickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling fallback for environments where Realtime isn't enabled.
  useEffect(() => {
    if (!job?.id) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      // Keep polling until done/error (also useful as a safety net alongside realtime)
      if (!job?.id) return;
      if (job.status === "done" || job.status === "error") return;
      loadJob(job.id).catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  // Once a job is finished, stop "resuming" it after refresh.
  useEffect(() => {
    if (!job?.id) return;
    if (job.status !== "done" && job.status !== "error") return;
    try {
      localStorage.removeItem(LAST_JOB_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [job?.id, job?.status]);

  // Dev-friendly worker runner: drip-invoke the worker while a job is running.
  // This avoids long-running worker invocations hitting platform limits, and is a good fallback
  // until Supabase Cron is configured.
  useEffect(() => {
    if (!job?.id) return;
    if (workerKickRef.current) window.clearInterval(workerKickRef.current);
    workerKickRef.current = null;

    if (job.status !== "running" && job.status !== "queued") return;
    if (job.completed >= job.total) return;

    workerKickRef.current = window.setInterval(() => {
      if (!job?.id) return;
      if (job.status === "done" || job.status === "error") return;
      if (workerInFlightRef.current) return;
      workerInFlightRef.current = true;
      invokeFunctionJson("sticker-worker", {
        batchSize: 1,
        visibilityTimeoutSeconds: 180,
        maxAttempts: 5,
      })
        .catch(() => {})
        .finally(() => {
          workerInFlightRef.current = false;
        });
    }, 60000);

    return () => {
      if (workerKickRef.current) window.clearInterval(workerKickRef.current);
      workerKickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.completed, job?.total]);

  async function createSubjectList() {
    const name = listName.trim();
    const description = listDescription.trim();
    if (!name) {
      setErr("Subject list name is required.");
      return;
    }
    const subjects = parseSubjectsText(listSubjectsText);
    if (subjects.length === 0) {
      setErr("Add at least one subject (or upload a CSV).");
      return;
    }
    setCreatingList(true);
    setErr(null);
    try {
      const { error } = await supabase.from("subject_lists").insert({
        name,
        description,
        subjects_text: listSubjectsText,
        subjects,
        csv_filename: listCsvFilename,
      } as any);
      if (error) throw error;
      setListName("");
      setListDescription("");
      setListSubjectsText("");
      setListCsvFilename(null);
      await refreshAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingList(false);
    }
  }

  async function deleteSubjectList(id: string) {
    const ok = window.confirm("Delete this subject list?");
    if (!ok) return;
    setErr(null);
    const { error } = await supabase.from("subject_lists").delete().eq("id", id);
    if (error) {
      const msg =
        (error as any)?.code === "23503" || String(error.message).toLowerCase().includes("foreign key")
          ? "Can't delete this subject list because it's referenced by an existing job. Delete the job(s) first."
          : error.message;
      setErr(msg);
    }
    await refreshAll();
  }

  async function deleteStyle(id: string) {
    const ok = window.confirm("Delete this saved style?");
    if (!ok) return;
    setErr(null);
    const { error } = await supabase.from("sticker_styles").delete().eq("id", id);
    if (error) {
      const msg =
        (error as any)?.code === "23503" || String(error.message).toLowerCase().includes("foreign key")
          ? "Can't delete this style because it's referenced by an existing job. Delete the job(s) first."
          : error.message;
      setErr(msg);
    }
    await refreshAll();
  }

  async function loadJob(jobId: string) {
    const { data: j, error: jErr } = await supabase
      .from("sticker_jobs")
      .select("id,style_id,subject_list_id,total,completed,status,error,created_at")
      .eq("id", jobId)
      .maybeSingle();
    if (jErr) throw jErr;
    if (!j) throw new Error("Job not found");
    setJob(j as any);
    try {
      localStorage.setItem(LAST_JOB_STORAGE_KEY, jobId);
    } catch {
      // ignore
    }

    const { data: st, error: stErr } = await supabase
      .from("stickers")
      .select("id,job_id,subject,status,attempts,image_url,error")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    if (stErr) throw stErr;
    setStickers((st ?? []) as any);
  }

  async function loadGalleryJob(jobId: string) {
    const { data: j, error: jErr } = await supabase
      .from("sticker_jobs")
      .select("id,style_id,subject_list_id,total,completed,status,error,created_at")
      .eq("id", jobId)
      .maybeSingle();
    if (jErr) throw jErr;
    if (!j) throw new Error("Job not found");
    setGalleryJob(j as any);

    const { data: st, error: stErr } = await supabase
      .from("stickers")
      .select("id,job_id,subject,status,attempts,image_url,error")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    if (stErr) throw stErr;
    setGalleryStickers((st ?? []) as any);
  }

  async function downloadJobZip(jobId: string) {
    setDownloading(true);
    setErr(null);
    try {
      const { data: st, error: stErr } = await supabase
        .from("stickers")
        .select("id,job_id,subject,status,attempts,image_url,error")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (stErr) throw stErr;
      const done = ((st ?? []) as any as StickerRow[]).filter((r) => r.image_url);
      if (done.length === 0) throw new Error("No images found for this job.");

      const files: Record<string, Uint8Array> = {};
      for (const s of done) {
        const res = await fetch(String(s.image_url));
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const safe = String(s.subject ?? "sticker")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40);
        const name = `${safe || "sticker"}-${s.id.slice(0, 6)}.png`;
        files[name] = bytes;
      }

      const zipped = zipSync(files, { level: 6 });
      // TS lib.dom can type Uint8Array.buffer as ArrayBufferLike (incl SharedArrayBuffer) which Blob typing rejects.
      // Runtime is fine; cast to BlobPart for TS.
      const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stickers-${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  async function cancelJob(jobId: string) {
    const ok = window.confirm("Cancel/delete this job? This deletes generated images and removes the job from history.");
    if (!ok) return;
    setErr(null);
    try {
      await invokeFunctionJson<{ jobId: string; deletedStickers: number; deletedFiles: number }>("sticker-pack", {
        action: "cancel",
        jobId,
      });
      try {
        const stored = localStorage.getItem(LAST_JOB_STORAGE_KEY);
        if (stored === jobId) localStorage.removeItem(LAST_JOB_STORAGE_KEY);
      } catch {
        // ignore
      }
      if (job?.id === jobId) {
        if (channelRef.current) supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setJob(null);
        setStickers([]);
      }
      if (galleryJobId === jobId) {
        setGalleryJobId(null);
        setGalleryJob(null);
        setGalleryStickers([]);
        setGalleryOpen(false);
      }
      await refreshAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function subscribeToJob(jobId: string) {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = null;

    const ch = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sticker_jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          const next = payload.new as any;
          if (!next) return;
          setJob((prev) => (prev ? ({ ...prev, ...next } as any) : (next as any)));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stickers", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const next = payload.new as any;
          if (!next?.id) return;
          setStickers((prev) => {
            const idx = prev.findIndex((s) => s.id === next.id);
            if (idx === -1) return [...prev, next];
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...next };
            return copy;
          });
        },
      )
      .subscribe();

    channelRef.current = ch;
  }

  async function startJob() {
    if (!selectedStyleId || !selectedSubjectListId) return;
    setStarting(true);
    setErr(null);
    try {
      const data = await invokeFunctionJson<{ jobId?: string; total?: number }>("sticker-pack", {
        action: "create",
        styleId: selectedStyleId,
        subjectListId: selectedSubjectListId,
      });

      const jobId = String(data?.jobId ?? "");
      if (!jobId) throw new Error("No jobId returned from backend.");

      await loadJob(jobId);
      subscribeToJob(jobId);

      // Update gallery list immediately (without full refresh/loading spinner).
      try {
        const { data: jr } = await supabase
          .from("sticker_jobs")
          .select("id,style_id,subject_list_id,total,completed,status,error,created_at")
          .eq("id", jobId)
          .maybeSingle();
        if (jr?.id) {
          setJobs((prev) => [jr as any, ...prev.filter((p) => p.id !== jr.id)].slice(0, 30));
        }
      } catch {
        // ignore
      }

      // Optional dev convenience: kick the worker once so generation starts immediately
      // even if Supabase Cron isn't configured yet. The worker drains from the queue and
      // uses service-role + OPENAI_API_KEY server-side.
      void invokeFunctionJson("sticker-worker", {
        batchSize: 1,
        visibilityTimeoutSeconds: 180,
        maxAttempts: 5,
      }).catch(() => {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function forceResumeJob() {
    if (!job?.id) return;
    setErr(null);
    try {
      await invokeFunctionJson<{ jobId: string; enqueued: number }>("sticker-pack", { action: "resume", jobId: job.id });
      await loadJob(job.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadAll() {
    if (!job || job.status !== "done") return;
    setDownloading(true);
    setErr(null);
    try {
      const ready = stickers.filter((s) => s.status === "done" && s.image_url);
      if (ready.length === 0) throw new Error("No completed stickers to download yet.");

      const files: Record<string, Uint8Array> = {};
      const used = new Set<string>();

      for (const s of ready) {
        const url = s.image_url!;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch image for "${s.subject}" (${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const safe = s.subject
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64) || "sticker";
        let name = `${safe}.png`;
        let i = 2;
        while (used.has(name)) {
          name = `${safe}-${i}.png`;
          i++;
        }
        used.add(name);
        files[name] = bytes;
      }

      // Add a tiny manifest for convenience.
      files["manifest.json"] = strToU8(
        JSON.stringify(
          {
            jobId: job.id,
            total: job.total,
            completed: job.completed,
            stickers: ready.map((s) => ({ subject: s.subject, image_url: s.image_url })),
          },
          null,
          2,
        ),
      );

      const zip = zipSync(files, { level: 6 });
      // TS lib.dom can type Uint8Array.buffer as ArrayBufferLike (incl SharedArrayBuffer) which Blob typing rejects.
      // Runtime is fine; cast to BlobPart for TS.
      const blob = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `job-${job.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="h-full w-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted-foreground">Content Studio</div>
          <h1 className="text-2xl font-semibold tracking-tight">Pack Creator</h1>
          <p className="text-sm text-muted-foreground">
            Select a saved style and a subject list, then start a background job to generate stickers.
          </p>
        </header>

        {err ? (
          <div className="p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-sm">
            {err}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="border rounded-xl bg-card p-4 lg:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Saved styles</div>
              <button className="text-xs underline text-muted-foreground" onClick={refreshAll}>
                Refresh
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {styles.length === 0 ? (
                <div className="text-sm text-muted-foreground">No saved styles yet. Save one from a Compiler node.</div>
              ) : null}
              {styles.map((s) => (
                <div
                  key={s.id}
                  className={`border rounded-lg p-3 flex gap-3 ${selectedStyleId === s.id ? "border-primary" : ""}`}
                >
                  {s.thumbnail_url ? (
                    <img src={s.thumbnail_url} alt={s.name} className="w-14 h-14 rounded border object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded border bg-muted/40" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        className="text-left min-w-0"
                        onClick={() => setSelectedStyleId(s.id)}
                        title="Select style"
                      >
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.description}</div>
                      </button>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          className="text-xs underline text-muted-foreground"
                          onClick={() => openEditStyle(s.id)}
                          title="Edit style (name, JSON, thumbnail)"
                        >
                          Edit
                        </button>
                        <button className="text-xs underline text-muted-foreground" onClick={() => deleteStyle(s.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border rounded-xl bg-card p-4 lg:col-span-1">
            <div className="font-semibold">Subject lists</div>

            <div className="mt-3 space-y-2">
              {subjectLists.map((l) => (
                <div
                  key={l.id}
                  className={`border rounded-lg p-3 ${selectedSubjectListId === l.id ? "border-primary" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button className="text-left min-w-0" onClick={() => setSelectedSubjectListId(l.id)}>
                      <div className="font-medium truncate">{l.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {Array.isArray(l.subjects) ? l.subjects.length : 0} subjects
                        {l.csv_filename ? ` • CSV: ${l.csv_filename}` : ""}
                      </div>
                    </button>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        className="text-xs underline text-muted-foreground"
                        onClick={() => openEditSubjectList(l.id)}
                        title="Edit subject list"
                      >
                        Edit
                      </button>
                      <button className="text-xs underline text-muted-foreground" onClick={() => deleteSubjectList(l.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {subjectLists.length === 0 ? (
                <div className="text-sm text-muted-foreground">No subject lists yet.</div>
              ) : null}
            </div>

            <div className="mt-4 pt-4 border-t space-y-3">
              <div className="font-medium">Create new list</div>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="List name"
              />
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={listDescription}
                onChange={(e) => setListDescription(e.target.value)}
                placeholder="Description (optional)"
              />
              <textarea
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={listSubjectsText}
                onChange={(e) => setListSubjectsText(e.target.value)}
                rows={5}
                placeholder="Multiple subjects (comma or newline separated)"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted-foreground">
                  <input
                    ref={listFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      const subjects = parseSubjectsCsv(text);
                      setListSubjectsText(subjects.join("\n"));
                      setListCsvFilename(file.name);
                      e.currentTarget.value = "";
                    }}
                  />
                  <span
                    className="underline cursor-pointer"
                    onClick={() => listFileInputRef.current?.click()}
                  >
                    Upload CSV
                  </span>
                </label>
                <div className="text-xs text-muted-foreground">Parsed: {parsedListSubjects.length}</div>
              </div>
              <button
                className="w-full px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={creatingList}
                onClick={createSubjectList}
              >
                {creatingList ? "Creating…" : "Create subject list"}
              </button>
            </div>
          </section>

          <section className="border rounded-xl bg-card p-4 lg:col-span-1">
            <div className="font-semibold">Generate</div>
            <div className="mt-3 space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Style:</span>{" "}
                <span className="font-medium">
                  {selectedStyleId ? styles.find((s) => s.id === selectedStyleId)?.name ?? "Selected" : "None"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Subject list:</span>{" "}
                <span className="font-medium">
                  {selectedList ? `${selectedList.name} (${selectedList.subjects.length})` : "None"}
                </span>
              </div>
            </div>

            <button
              className="mt-4 w-full px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              disabled={!selectedStyleId || !selectedSubjectListId || starting}
              onClick={startJob}
            >
              {starting ? "Starting…" : "Start job"}
            </button>

            <button
              className="mt-2 w-full px-3 py-2 text-sm border rounded hover:bg-accent"
              onClick={() => {
                setGalleryOpen(true);
                setGalleryJobId(null);
                setGalleryJob(null);
                setGalleryStickers([]);
              }}
              title="Browse past generations"
            >
              Gallery
            </button>

            {job ? (
              <div className="mt-5 space-y-3">
                <div className="text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Job</div>
                    <div className="text-xs text-muted-foreground">{job.status}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {job.completed}/{job.total} completed
                    {job.error ? ` • ${job.error}` : ""}
                  </div>
                  <div className="mt-2 h-2 rounded bg-muted/40 overflow-hidden">
                    <div
                      className="h-2 bg-primary"
                      style={{
                        width: job.total > 0 ? `${Math.min(100, Math.round((job.completed / job.total) * 100))}%` : "0%",
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
                    disabled={job.status === "done" || job.status === "error" || job.status === "cancelled" || starting}
                    onClick={forceResumeJob}
                    title="Re-enqueue any queued stickers for this job (safe if the queue got emptied)."
                  >
                    Force resume
                  </button>
                  <button
                    className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
                    disabled={starting}
                    onClick={() => cancelJob(job.id)}
                    title="Deletes this job + its images."
                  >
                    Cancel/Delete
                  </button>
                </div>

                <button
                  className="w-full px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
                  disabled={job.status !== "done" || downloading}
                  onClick={downloadAll}
                >
                  {downloading ? "Zipping…" : "Download all (zip)"}
                </button>

                <div className="grid grid-cols-3 gap-2">
                  {stickers
                    .slice()
                    .sort((a, b) => a.subject.localeCompare(b.subject))
                    .slice(0, 12)
                    .map((s) => (
                      <div key={s.id} className="border rounded overflow-hidden bg-background">
                        {s.image_url ? (
                          <img src={s.image_url} alt={s.subject} className="w-full h-24 object-cover" />
                        ) : (
                          <div className="w-full h-24 bg-muted/40 flex items-center justify-center text-[11px] text-muted-foreground">
                            {s.status}
                          </div>
                        )}
                        <div className="p-2 text-[11px] truncate" title={s.subject}>
                          {s.subject}
                        </div>
                      </div>
                    ))}
                </div>

                {stickers.length > 12 ? (
                  <div className="text-xs text-muted-foreground">Showing first 12. Thumbnails will keep updating.</div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">
                Start a job to see progress and thumbnails here.
              </div>
            )}
          </section>
        </div>

        <Modal
          open={galleryOpen}
          title="Gallery"
          description={
            galleryJobId
              ? `Job ${galleryJobId.slice(0, 8)} • ${galleryJob?.completed ?? 0}/${galleryJob?.total ?? 0} • ${galleryJob?.status ?? ""}`
              : "Browse past generations"
          }
          onClose={() => {
            setGalleryOpen(false);
          }}
        >
          <div className="space-y-3">
            {galleryJobId ? (
              <>
                <div className="flex flex-wrap gap-2 items-center justify-between">
                  <button
                    className="px-3 py-2 text-sm border rounded hover:bg-accent"
                    onClick={() => {
                      setGalleryJobId(null);
                      setGalleryJob(null);
                      setGalleryStickers([]);
                    }}
                  >
                    Back to jobs
                  </button>

                  <div className="flex gap-2">
                    <button
                      className="px-3 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
                      disabled={!galleryJobId || downloading}
                      onClick={() => (galleryJobId ? downloadJobZip(galleryJobId) : undefined)}
                    >
                      {downloading ? "Zipping…" : "Download zip"}
                    </button>
                    <button
                      className="px-3 py-2 text-sm border rounded hover:bg-accent"
                      onClick={() => cancelJob(galleryJobId)}
                    >
                      {galleryJob?.status === "queued" || galleryJob?.status === "running" ? "Cancel/Delete" : "Delete"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {galleryStickers
                    .slice()
                    .sort((a, b) => a.subject.localeCompare(b.subject))
                    .map((s) => (
                      <div key={s.id} className="border rounded overflow-hidden bg-background">
                        {s.image_url ? (
                          <img src={s.image_url} alt={s.subject} className="w-full h-24 object-cover" />
                        ) : (
                          <div className="w-full h-24 bg-muted/40 flex items-center justify-center text-[11px] text-muted-foreground">
                            {s.status}
                          </div>
                        )}
                        <div className="p-2 text-[11px] truncate" title={s.subject}>
                          {s.subject}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {jobs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No jobs yet.</div>
                ) : (
                  <div className="space-y-2">
                    {jobs.map((j) => {
                      const cover = jobCovers[j.id];
                      const styleName = styles.find((s) => s.id === j.style_id)?.name ?? "Style";
                      const listName = subjectLists.find((l) => l.id === j.subject_list_id)?.name ?? "Subjects";
                      return (
                        <div
                          key={j.id}
                          className="border rounded-lg overflow-hidden bg-background hover:bg-accent/30 cursor-pointer"
                          onClick={async () => {
                            setGalleryJobId(j.id);
                            setGalleryOpen(true);
                            await loadGalleryJob(j.id);
                          }}
                        >
                          <div className="flex gap-3 p-2">
                            <div className="w-14 h-14 rounded border bg-muted/30 overflow-hidden shrink-0">
                              {cover ? (
                                <img src={cover} alt="cover" className="w-14 h-14 object-cover" />
                              ) : (
                                <div className="w-14 h-14 flex items-center justify-center text-[10px] text-muted-foreground">
                                  {j.status}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{styleName}</div>
                              <div className="text-xs text-muted-foreground truncate">{listName}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {j.completed}/{j.total} • {j.status}
                              </div>
                            </div>
                            <div className="shrink-0 flex flex-col gap-1">
                              {(j.status === "queued" || j.status === "running") ? (
                                <button
                                  className="text-xs px-2 py-1 border rounded hover:bg-accent"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelJob(j.id);
                                  }}
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  className="text-xs px-2 py-1 border rounded hover:bg-accent"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelJob(j.id);
                                  }}
                                  title="Delete this job + images"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>

        {/* Edit Style */}
        <Modal
          open={editStyleOpen}
          title="Edit style"
          description="Update name, compiled JSON, and (optionally) choose a thumbnail from generated stickers."
          onClose={() => {
            if (editStyleSaving) return;
            setEditStyleOpen(false);
          }}
        >
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={editStyleName}
                onChange={(e) => setEditStyleName(e.target.value)}
                placeholder="Style name"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={editStyleDescription}
                onChange={(e) => setEditStyleDescription(e.target.value)}
                rows={2}
                placeholder="Short description (optional)"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Compiled JSON</label>
              <textarea
                className="w-full border rounded px-3 py-2 text-xs font-mono bg-background"
                value={editStyleJson}
                onChange={(e) => setEditStyleJson(e.target.value)}
                rows={10}
                placeholder="{ ... }"
              />
              <div className="text-[11px] text-muted-foreground">
                Tip: You can paste/modify the template JSON. Save will validate it.
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Thumbnail</div>
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground"
                  onClick={() => setEditStyleThumbUrl(null)}
                >
                  Clear
                </button>
              </div>
              {editStyleThumbLoading ? (
                <div className="text-sm text-muted-foreground">Loading candidates…</div>
              ) : editStyleThumbCandidates.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {editStyleThumbCandidates.map((c) => {
                    const selected = editStyleThumbUrl === c.url;
                    return (
                      <button
                        key={c.id}
                        className={`border rounded overflow-hidden hover:opacity-90 ${selected ? "ring-2 ring-primary" : ""}`}
                        onClick={() => setEditStyleThumbUrl(c.url)}
                        type="button"
                        title={c.label ?? "Use as thumbnail"}
                      >
                        <img src={c.url} alt={c.label ?? "thumb"} className="w-full h-16 object-cover" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No generated sticker images found for this style yet. Run a job in the Gallery to get thumbnail options.
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                Selected thumbnail will be copied into the <span className="font-mono">sticker_thumbnails</span> bucket.
              </div>
            </div>

            {editStyleErr ? (
              <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">
                {editStyleErr}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded hover:bg-accent"
                disabled={editStyleSaving}
                onClick={() => setEditStyleOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={editStyleSaving || !editingStyleId}
                onClick={saveEditedStyle}
              >
                {editStyleSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>

        {/* Edit Subject list */}
        <Modal
          open={editListOpen}
          title="Edit subject list"
          description="Update list name/description and edit subjects."
          onClose={() => {
            if (editListSaving) return;
            setEditListOpen(false);
          }}
        >
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={editListName}
                onChange={(e) => setEditListName(e.target.value)}
                placeholder="List name"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={editListDescription}
                onChange={(e) => setEditListDescription(e.target.value)}
                placeholder="Description (optional)"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Subjects</label>
              <textarea
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={editListSubjectsText}
                onChange={(e) => setEditListSubjectsText(e.target.value)}
                rows={8}
                placeholder={"comma or newline separated\ncat, dog\nhamster"}
              />
              <div className="text-[11px] text-muted-foreground">
                Parsed: <span className="font-medium">{parseSubjectsText(editListSubjectsText).length}</span>
              </div>
            </div>

            {editListErr ? (
              <div className="p-2 rounded border text-sm bg-destructive/10 border-destructive/20 text-destructive">
                {editListErr}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded hover:bg-accent"
                disabled={editListSaving}
                onClick={() => setEditListOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={editListSaving || !editingListId}
                onClick={saveEditedSubjectList}
              >
                {editListSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}

