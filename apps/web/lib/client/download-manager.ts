"use client";
import { useSyncExternalStore } from "react";
import {
  sanitizeFilename,
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
  const queued = [...records.values()].filter((r) => r.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
  for (const r of queued) {
    if (runningCount() >= max) break;
    startTask(r.id);
  }
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
}

function add(info: AnalyzeFile, opts: AddOptions = {}): string {
  ensureLoaded();
  const settings = getSettings();
  const id = uid();
  const now = Date.now();
  const connections = Math.max(1, Math.min(16, opts.connections ?? settings.connections));
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
  update(id, { status: "queued", error: undefined, notice: undefined, completedAt: undefined, saved: false, activeMs: fresh ? 0 : r.activeMs }, true);
  pump();
}

async function remove(id: string): Promise<void> {
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

export const downloadManager = { add, pause, resume, cancel, retry, remove, save, clearHistory, getSnapshot, subscribe };

export function useDownloads(): DownloadRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export const ACTIVE_STATUSES: DownloadStatus[] = ["queued", "downloading", "paused"];
