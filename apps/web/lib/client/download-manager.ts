"use client";
import { useSyncExternalStore } from "react";
import {
  BandwidthLimiter,
  hashBlob,
  HASH_LABEL,
  parseChecksum,
  sanitizeFilename,
  type HashAlgorithm,
  SegmentedDownload,
  type AnalyzeFile,
  type EngineSnapshot,
  type MediaCategory,
  type RequestBuilder,
  type SegmentPlan,
} from "@mediagrab/shared";
import { createStore, opfsSupported, removeStoredData } from "./opfs-store";
import { getSettings } from "./settings";

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

export interface ChecksumState {
  algorithm: HashAlgorithm;
  expected: string;
  state: "pending" | "running" | "match" | "mismatch" | "error";
  /** Bytes hashed so far while running. */
  progress?: number;
  actual?: string;
  error?: string;
}

export interface SegmentView {
  downloaded: number;
  length: number | null;
}

export interface DownloadRecord {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  mimeType: string;
  category: MediaCategory;
  formatLabel: string;
  size: number | null;
  acceptRanges: boolean;
  corsDirect: boolean;
  status: DownloadStatus;
  downloaded: number;
  speed: number;
  connections: number;
  mode: "segmented" | "single" | null;
  transport: "direct" | "proxy";
  storage: "browser-disk" | "memory";
  plan: SegmentPlan[] | null;
  segments: SegmentView[];
  error?: string;
  notice?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  /** Total time spent actively downloading, for average speed. */
  activeMs: number;
  saved: boolean;
  /** Queued downloads don't start before this time (ms since epoch). */
  startAfter?: number;
  checksum?: ChecksumState;
}

const KEY = "mediagrab.downloads.v1";
const MAX_HISTORY = 300;

const records = new Map<string, DownloadRecord>();
const engines = new Map<string, SegmentedDownload>();
const blobs = new Map<string, Blob>();
const startedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: DownloadRecord[] = [];
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
const verifying = new Map<string, AbortController>();
/** One limiter for all downloads, so the speed limit applies to MediaGrab's total bandwidth. */
const limiter = new BandwidthLimiter(0);

function throttle(bytes: number, signal: AbortSignal): Promise<void> {
  const rate = getSettings().speedLimitKBps * 1024;
  if (rate !== limiter.rate) limiter.setRate(rate);
  return limiter.take(bytes, signal);
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as DownloadRecord[];
    for (const r of list) {
      if (!r || typeof r.id !== "string") continue;
      r.speed = 0;
      if (r.checksum?.state === "running") r.checksum = { ...r.checksum, state: "pending", progress: undefined };
      if (r.status === "downloading" || r.status === "queued") {
        if (r.storage === "browser-disk" && r.acceptRanges) {
          r.status = "paused";
          r.notice = "Interrupted when the page closed. Resume to continue where it stopped.";
        } else {
          r.status = "failed";
          r.error = "Interrupted when the page closed. Retry to download it again.";
        }
      }
      records.set(r.id, r);
    }
  } catch {
    /* corrupt history: start fresh */
  }
  window.addEventListener("beforeunload", (e) => {
    if ([...records.values()].some((r) => r.status === "downloading")) {
      e.preventDefault();
    }
  });
  publish(false);
  // Finish checksum checks that a reload interrupted.
  for (const r of records.values()) if (r.status === "completed" && r.checksum?.state === "pending") void verify(r.id);
}

function publish(persist = true): void {
  snapshot = [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
  listeners.forEach((l) => l());
  if (persist) schedulePersist();
}

function writeHistory(): void {
  persistTimer = null;
  try {
    const list = [...records.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_HISTORY);
    localStorage.setItem(KEY, JSON.stringify(list.map((r) => ({ ...r, speed: 0 }))));
  } catch {
    /* storage blocked or full */
  }
}

/** Throttled (not debounced): frequent progress updates must not postpone the write indefinitely. */
function schedulePersist(immediate = false): void {
  if (immediate) {
    if (persistTimer) clearTimeout(persistTimer);
    writeHistory();
    return;
  }
  if (!persistTimer) persistTimer = setTimeout(writeHistory, 800);
}

function update(id: string, patch: Partial<DownloadRecord>, persistNow = false): void {
  const r = records.get(id);
  if (!r) return;
  records.set(id, { ...r, ...patch, updatedAt: Date.now() });
  publish();
  if (persistNow) schedulePersist(true);
}

function proxyUrl(r: DownloadRecord): string {
  const q = new URLSearchParams({ url: r.finalUrl, filename: r.filename });
  return `/api/download?${q.toString()}`;
}

function transportsFor(r: DownloadRecord): { list: RequestBuilder[]; names: Array<"direct" | "proxy"> } {
  const proxy: RequestBuilder = () => ({ url: proxyUrl(r), credentials: "same-origin" });
  const direct: RequestBuilder = () => ({ url: r.finalUrl, credentials: "omit" });
  if (r.corsDirect && getSettings().preferDirect) return { list: [direct, proxy], names: ["direct", "proxy"] };
  return { list: [proxy], names: ["proxy"] };
}

function applySnapshot(id: string, s: EngineSnapshot, names: Array<"direct" | "proxy">): void {
  const r = records.get(id);
  if (!r) return;
  const now = Date.now();
  const since = startedAt.get(id);
  const patch: Partial<DownloadRecord> = {
    downloaded: s.downloaded,
    speed: s.status === "downloading" ? s.speed : 0,
    size: s.total ?? r.size,
    mode: s.mode,
    plan: s.plan,
    acceptRanges: s.resumable || (r.acceptRanges && s.mode === "segmented"),
    transport: names[s.transport] ?? r.transport,
    segments: s.segments.map((g) => ({ downloaded: g.downloaded, length: g.end >= 0 ? g.end - g.start + 1 : null })),
    notice: s.notice,
  };
  if (s.status !== "downloading" && since) {
    patch.activeMs = r.activeMs + (now - since);
    startedAt.delete(id);
  }
  if (s.status === "failed") {
    patch.status = "failed";
    patch.error = s.error ?? "Download failed.";
  } else if (s.status === "paused") {
    patch.status = "paused";
  }
  update(id, patch, s.status !== "downloading");
}

function runningCount(): number {
  return [...records.values()].filter((r) => r.status === "downloading").length;
}

function pump(): void {
  const max = getSettings().maxConcurrent;
  const now = Date.now();
  const queued = [...records.values()].filter((r) => r.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
  for (const r of queued) {
    if (r.startAfter && r.startAfter > now) continue;
    if (runningCount() >= max) break;
    startTask(r.id);
  }
  armScheduleTimer();
}

/** Wake up when the next scheduled download is due. */
function armScheduleTimer(): void {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
  const now = Date.now();
  const next = Math.min(...[...records.values()].filter((r) => r.status === "queued" && r.startAfter && r.startAfter > now).map((r) => r.startAfter!));
  if (!Number.isFinite(next)) return;
  // Browsers cap timers at ~24.8 days; re-arm in steps.
  scheduleTimer = setTimeout(pump, Math.min(next - now + 50, 2 ** 31 - 1));
}

function startTask(id: string): void {
  const r = records.get(id);
  if (!r) return;
  const settings = getSettings();
  let engine = engines.get(id);
  const { list, names } = transportsFor(r);
  if (!engine) {
    engine = new SegmentedDownload({
      transports: list,
      totalSize: r.size,
      acceptRanges: r.acceptRanges,
      maxConnections: r.connections,
      minSegmentSize: settings.minSegmentMB * 1024 * 1024,
      maxRetries: settings.retries,
      mimeType: r.mimeType,
      plan: r.plan ?? undefined,
      store: createStore(id),
      throttle,
      onUpdate: (s) => applySnapshot(id, s, names),
    });
    engines.set(id, engine);
  }
  startedAt.set(id, Date.now());
  update(id, { status: "downloading", error: undefined, notice: undefined }, true);
  const eng = engine;
  eng
    .start()
    .then((blob) => {
      if (!blob) return; // paused or cancelled
      blobs.set(id, blob);
      engines.delete(id);
      update(id, { status: "completed", completedAt: Date.now(), downloaded: blob.size, size: blob.size, speed: 0, notice: undefined }, true);
      if (getSettings().autoSave) void save(id);
      if (records.get(id)?.checksum) void verify(id);
    })
    .catch(() => {
      engines.delete(id);
      const s = eng.snapshot();
      applySnapshot(id, { ...s, status: "failed" }, names);
    })
    .finally(() => pump());
}

export interface AddOptions {
  filename?: string;
  connections?: number;
  /** Don't start before this time (ms since epoch). */
  startAt?: number;
  /** Expected checksum to verify once finished (MD5, SHA-1 or SHA-256 hex, in any common format). */
  checksum?: string;
}

function add(info: AnalyzeFile, opts: AddOptions = {}): string {
  ensureLoaded();
  const settings = getSettings();
  const id = uid();
  const now = Date.now();
  const connections = Math.max(1, Math.min(16, opts.connections ?? settings.connections));
  const parsed = opts.checksum?.trim() ? parseChecksum(opts.checksum) : null;
  if (parsed && !parsed.ok) throw new Error(parsed.error);
  records.set(id, {
    id,
    url: info.url,
    finalUrl: info.finalUrl,
    filename: sanitizeFilename(opts.filename || info.filename),
    mimeType: info.mimeType,
    category: info.category,
    formatLabel: info.formatLabel,
    size: info.size,
    acceptRanges: info.acceptRanges,
    corsDirect: info.corsDirect,
    status: "queued",
    downloaded: 0,
    speed: 0,
    connections: info.segmentable ? connections : 1,
    mode: null,
    transport: info.corsDirect && settings.preferDirect ? "direct" : "proxy",
    storage: opfsSupported() ? "browser-disk" : "memory",
    plan: null,
    segments: [],
    createdAt: now,
    updatedAt: now,
    activeMs: 0,
    saved: false,
    startAfter: opts.startAt && opts.startAt > now ? opts.startAt : undefined,
    checksum: parsed?.ok ? { algorithm: parsed.algorithm, expected: parsed.hex, state: "pending" } : undefined,
  });
  publish();
  schedulePersist(true);
  pump();
  return id;
}

function pause(id: string): void {
  const engine = engines.get(id);
  const r = records.get(id);
  if (!r) return;
  if (engine && r.status === "downloading") engine.pause();
  else if (r.status === "queued") update(id, { status: "paused" }, true);
}

function resume(id: string): void {
  const r = records.get(id);
  if (!r || (r.status !== "paused" && r.status !== "failed")) return;
  update(id, { status: "queued", error: undefined }, true);
  pump();
}

/** Start a scheduled download now instead of waiting. */
function startNow(id: string): void {
  const r = records.get(id);
  if (!r || !r.startAfter) return;
  update(id, { startAfter: undefined, status: r.status === "paused" ? "queued" : r.status }, true);
  pump();
}

/** Change or clear the time a queued download waits for. */
function reschedule(id: string, startAt: number | null): void {
  const r = records.get(id);
  if (!r || (r.status !== "queued" && r.status !== "paused")) return;
  update(id, { startAfter: startAt && startAt > Date.now() ? startAt : undefined }, true);
  pump();
}

/**
 * Hash the finished file and compare it with the expected checksum.
 * Pass `input` to set or replace the checksum first. Returns the result state.
 */
async function verify(id: string, input?: string): Promise<ChecksumState["state"]> {
  let r = records.get(id);
  if (!r) return "error";
  if (input !== undefined) {
    const parsed = parseChecksum(input);
    if (!parsed.ok) throw new Error(parsed.error);
    update(id, { checksum: { algorithm: parsed.algorithm, expected: parsed.hex, state: "pending" } }, true);
    r = records.get(id)!;
  }
  const sum = r.checksum;
  if (!sum || r.status !== "completed") return sum?.state ?? "error";
  verifying.get(id)?.abort();
  const ctrl = new AbortController();
  verifying.set(id, ctrl);
  const set = (patch: Partial<ChecksumState>, persist = false) => {
    const cur = records.get(id)?.checksum;
    if (cur && cur.expected === sum.expected) update(id, { checksum: { ...cur, ...patch } }, persist);
  };
  set({ state: "running", progress: 0, actual: undefined, error: undefined });
  try {
    const blob = await getBlob(id);
    if (!blob) throw new Error("The finished file is no longer in browser storage.");
    let last = 0;
    const actual = await hashBlob(blob, sum.algorithm, {
      signal: ctrl.signal,
      onProgress: (done) => {
        if (done - last >= 16 * 1024 * 1024 || done === blob.size) {
          last = done;
          set({ progress: done });
        }
      },
    });
    const state = actual === sum.expected ? "match" : "mismatch";
    set({ state, actual, progress: blob.size }, true);
    return state;
  } catch (e) {
    if (ctrl.signal.aborted) return "pending";
    set({ state: "error", error: e instanceof Error ? e.message : String(e) }, true);
    return "error";
  } finally {
    if (verifying.get(id) === ctrl) verifying.delete(id);
  }
}

export function checksumLabel(c: ChecksumState): string {
  return HASH_LABEL[c.algorithm];
}

async function cancel(id: string): Promise<void> {
  const engine = engines.get(id);
  engines.delete(id);
  startedAt.delete(id);
  if (engine) await engine.cancel();
  else await removeStoredData(id);
  blobs.delete(id);
  update(id, { status: "cancelled", speed: 0, downloaded: 0, segments: [], plan: null, notice: undefined }, true);
  pump();
}

async function retry(id: string): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  const fresh = r.status === "cancelled" || r.status === "completed" || /changed|range/i.test(r.error ?? "") || !r.acceptRanges;
  engines.delete(id);
  blobs.delete(id);
  if (fresh) {
    await removeStoredData(id);
    update(id, { plan: null, segments: [], downloaded: 0 });
  }
  update(
    id,
    {
      status: "queued",
      error: undefined,
      notice: undefined,
      completedAt: undefined,
      saved: false,
      activeMs: fresh ? 0 : r.activeMs,
      startAfter: undefined,
      checksum: r.checksum ? { algorithm: r.checksum.algorithm, expected: r.checksum.expected, state: "pending" } : undefined,
    },
    true,
  );
  pump();
}

async function remove(id: string): Promise<void> {
  verifying.get(id)?.abort();
  const engine = engines.get(id);
  engines.delete(id);
  if (engine) await engine.cancel();
  await removeStoredData(id);
  blobs.delete(id);
  records.delete(id);
  publish();
  schedulePersist(true);
}

async function getBlob(id: string): Promise<Blob | null> {
  const cached = blobs.get(id);
  if (cached) return cached;
  const r = records.get(id);
  if (!r || r.status !== "completed" || r.storage !== "browser-disk" || !r.plan) return null;
  try {
    const store = createStore(id);
    const count = r.plan.length;
    const sizes = await Promise.all(r.plan.map((_, i) => store.size(i)));
    const total = sizes.reduce((a, b) => a + b, 0);
    if (r.size != null && total !== r.size) return null;
    const blob = await store.assemble(count, r.mimeType);
    blobs.set(id, blob);
    return blob;
  } catch {
    return null;
  }
}

/** Hand the finished file to the browser's own download/save flow. */
async function save(id: string): Promise<boolean> {
  const r = records.get(id);
  if (!r) return false;
  const blob = await getBlob(id);
  if (!blob) {
    update(id, { notice: "The finished file is no longer in browser storage. Use Retry to download it again." });
    return false;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = r.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5 * 60_000);
  update(id, { saved: true }, true);
  return true;
}

async function clearHistory(statuses: DownloadStatus[]): Promise<void> {
  for (const r of [...records.values()]) {
    if (statuses.includes(r.status)) await remove(r.id);
  }
}

function subscribe(cb: () => void): () => void {
  ensureLoaded();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): DownloadRecord[] {
  ensureLoaded();
  return snapshot;
}

const EMPTY: DownloadRecord[] = [];

export const downloadManager = { add, pause, resume, cancel, retry, remove, save, verify, startNow, reschedule, clearHistory, getSnapshot, subscribe };

export function useDownloads(): DownloadRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export const ACTIVE_STATUSES: DownloadStatus[] = ["queued", "downloading", "paused"];
