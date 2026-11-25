/**
 * Segmented (multi-connection) download engine.
 *
 * - Uses HTTP Range requests when the server supports them and the file is large enough.
 * - Downloads segments concurrently, retries failed segments from their last byte.
 * - Verifies every segment's length and the final assembled size.
 * - Falls back to a single stream when ranges are unavailable or ignored by the server.
 *
 * Environment-agnostic: needs only `fetch`, `Blob`, `AbortController` and a SegmentStore.
 */

export type EngineStatus = "idle" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
export type EngineMode = "segmented" | "single";

export interface SegmentPlan {
  start: number;
  /** Inclusive end byte, or -1 when the total size is unknown. */
  end: number;
}

export interface SegmentState extends SegmentPlan {
  index: number;
  downloaded: number;
  done: boolean;
}

export interface SegmentWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface SegmentStore {
  /** Prepare storage for `count` segments. Existing data must be kept (resume). */
  init(count: number): Promise<void>;
  /** Bytes already stored for a segment. */
  size(index: number): Promise<number>;
  /** Open an appending writer for a segment. */
  writer(index: number): Promise<SegmentWriter>;
  /** Discard a segment's data. */
  reset(index: number): Promise<void>;
  /** Concatenate segments 0..count-1 into one Blob. */
  assemble(count: number, mimeType: string): Promise<Blob>;
  /** Delete everything. */
  destroy(): Promise<void>;
}

export interface RequestSpec {
  url: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

export type RequestBuilder = (range: { start: number; end?: number } | null) => RequestSpec;

export interface EngineConfig {
  /**
   * One or more ways to fetch the resource, in order of preference (e.g. direct, then via proxy).
   * The engine moves to the next one when a network-level error (CORS, DNS, connection refused) occurs.
   */
  transports: RequestBuilder[];
  totalSize: number | null;
  acceptRanges: boolean;
  maxConnections?: number;
  minSegmentSize?: number;
  maxRetries?: number;
  mimeType?: string;
  /** Abort when more than this many bytes are received. */
  maxBytes?: number;
  store: SegmentStore;
  fetch?: typeof fetch;
  /** A previously used segment plan, to resume after a reload. */
  plan?: SegmentPlan[];
  onUpdate?: (s: EngineSnapshot) => void;
  /** Minimum milliseconds between progress callbacks. */
  updateInterval?: number;
  retryDelay?: (attempt: number) => number;
  /** Called with each received chunk's size before it's stored; await it to limit bandwidth. */
  throttle?: (bytes: number, signal: AbortSignal) => Promise<void>;
}

export interface EngineSnapshot {
  status: EngineStatus;
  mode: EngineMode;
  downloaded: number;
  total: number | null;
  /** Bytes per second averaged over the last few seconds. */
  speed: number;
  segments: SegmentState[];
  plan: SegmentPlan[];
  connections: number;
  /** True when pausing keeps progress (range support). */
  resumable: boolean;
  transport: number;
  error?: string;
  notice?: string;
}

export class HttpStatusError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `Server responded with HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

class RangeIgnoredError extends Error {
  constructor() {
    super("Server ignored the Range request");
    this.name = "RangeIgnoredError";
  }
}

class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

const DEFAULT_MIN_SEGMENT = 1024 * 1024; // 1 MiB

export function planSegments(totalSize: number | null, acceptRanges: boolean, maxConnections: number, minSegmentSize: number): SegmentPlan[] {
  if (!totalSize || totalSize <= 0) return [{ start: 0, end: -1 }];
  if (!acceptRanges || maxConnections <= 1 || totalSize < minSegmentSize * 2) return [{ start: 0, end: totalSize - 1 }];
  const count = Math.max(1, Math.min(maxConnections, Math.floor(totalSize / minSegmentSize)));
  const base = Math.floor(totalSize / count);
  const plan: SegmentPlan[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * base;
    const end = i === count - 1 ? totalSize - 1 : start + base - 1;
    plan.push({ start, end });
  }
  return plan;
}

export function parseContentRange(header: string | null): { start: number; end: number; total: number | null } | null {
  if (!header) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? null : Number(m[3]) };
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}

/** fetch() rejects with TypeError for network/CORS failures. */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function segLength(s: SegmentPlan): number {
  return s.end < 0 ? Infinity : s.end - s.start + 1;
}

export class SegmentedDownload {
  private cfg: Required<Omit<EngineConfig, "plan" | "onUpdate" | "maxBytes" | "mimeType" | "throttle">> & EngineConfig;
  private status: EngineStatus = "idle";
  private mode: EngineMode = "single";
  private segments: SegmentState[] = [];
  private controller: AbortController | null = null;
  private stopReason: "pause" | "cancel" | null = null;
  private transport = 0;
  private acceptRanges: boolean;
  private total: number | null;
  private samples: Array<{ t: number; bytes: number }> = [];
  private lastEmit = 0;
  private error?: string;
  private notice?: string;
  private running: Promise<Blob | null> | null = null;

  constructor(config: EngineConfig) {
    if (!config.transports.length) throw new Error("At least one transport is required");
    this.cfg = {
      maxConnections: 4,
      minSegmentSize: DEFAULT_MIN_SEGMENT,
      maxRetries: 4,
      fetch: globalThis.fetch.bind(globalThis),
      updateInterval: 200,
      retryDelay: (attempt: number) => Math.min(8000, 500 * 2 ** (attempt - 1)),
      ...config,
    } as SegmentedDownload["cfg"];
    this.acceptRanges = config.acceptRanges;
    this.total = config.totalSize;
  }

  get downloaded(): number {
    return this.segments.reduce((a, s) => a + s.downloaded, 0);
  }

  snapshot(): EngineSnapshot {
    return {
      status: this.status,
      mode: this.mode,
      downloaded: this.downloaded,
      total: this.total,
      speed: this.speed(),
      segments: this.segments.map((s) => ({ ...s })),
      plan: this.segments.map(({ start, end }) => ({ start, end })),
      connections: this.segments.filter((s) => !s.done).length,
      resumable: this.acceptRanges && this.total != null,
      transport: this.transport,
      error: this.error,
      notice: this.notice,
    };
  }

  /** Start or resume. Resolves with the assembled Blob, or null when paused/cancelled. */
  start(): Promise<Blob | null> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  pause(): void {
    if (this.status !== "downloading") return;
    this.stopReason = "pause";
    this.controller?.abort();
  }

  async cancel(): Promise<void> {
    const wasRunning = this.running;
    this.stopReason = "cancel";
    this.controller?.abort();
    if (wasRunning) await wasRunning.catch(() => null);
    this.status = "cancelled";
    await this.cfg.store.destroy().catch(() => undefined);
    this.emit(true);
  }

  private speed(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? Math.max(0, (b.bytes - a.bytes) / dt) : 0;
  }

  private sample(): void {
    const now = Date.now();
    this.samples.push({ t: now, bytes: this.downloaded });
    while (this.samples.length > 2 && now - this.samples[0].t > 4000) this.samples.shift();
  }

  private emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < this.cfg.updateInterval) return;
    this.lastEmit = now;
    this.sample();
    this.cfg.onUpdate?.(this.snapshot());
  }

  private async preparePlan(): Promise<void> {
    if (this.segments.length) return; // resuming in-memory
    let plan = this.cfg.plan;
    const usable =
      plan &&
      plan.length > 0 &&
      (plan.length === 1 || (this.acceptRanges && this.total != null && plan[plan.length - 1].end === this.total - 1));
    if (!usable) plan = planSegments(this.total, this.acceptRanges, this.cfg.maxConnections, this.cfg.minSegmentSize);
    this.mode = plan!.length > 1 ? "segmented" : "single";
    await this.cfg.store.init(plan!.length);
    this.segments = [];
    for (let i = 0; i < plan!.length; i++) {
      const p = plan![i];
      let have = await this.cfg.store.size(i);
      const len = segLength(p);
      if (have > len) {
        await this.cfg.store.reset(i);
        have = 0;
      }
      this.segments.push({ index: i, start: p.start, end: p.end, downloaded: have, done: len !== Infinity && have === len });
    }
  }

  private async run(): Promise<Blob | null> {
    this.error = undefined;
    this.stopReason = null;
    this.status = "downloading";
    this.samples = [];
    try {
      await this.preparePlan();
      this.emit(true);
      for (;;) {
        if (this.stopReason) throw new DOMException("Aborted", "AbortError");
        this.controller = new AbortController();
        try {
          await this.runWorkers(this.controller.signal);
          break;
        } catch (e) {
          if (e instanceof RangeIgnoredError) {
            await this.fallbackToSingle("The server ignored range requests, so the download continues over a single connection.");
            continue;
          }
          throw e;
        }
      }
      const blob = await this.finalize();
      this.status = "completed";
      this.emit(true);
      return blob;
    } catch (e) {
      if (this.stopReason === "pause") {
        this.status = "paused";
        if (!this.acceptRanges) {
          this.notice = "This server doesn't support resuming, so the download will restart from the beginning.";
        }
        this.emit(true);
        return null;
      }
      if (this.stopReason === "cancel") {
        this.status = "cancelled";
        return null;
      }
      this.status = "failed";
      this.error = describeError(e);
      this.emit(true);
      throw e instanceof Error ? e : new Error(this.error);
    } finally {
      this.controller = null;
    }
  }

  private async fallbackToSingle(notice: string): Promise<void> {
    this.acceptRanges = false;
    this.notice = notice;
    for (const s of this.segments) await this.cfg.store.reset(s.index);
    await this.cfg.store.init(1);
    this.mode = "single";
    this.segments = [{ index: 0, start: 0, end: this.total ? this.total - 1 : -1, downloaded: 0, done: false }];
    this.emit(true);
  }

  private async runWorkers(signal: AbortSignal): Promise<void> {
    const pending = this.segments.filter((s) => !s.done);
    const inner = new AbortController();
    const onOuter = () => inner.abort();
    signal.addEventListener("abort", onOuter, { once: true });
    let firstError: unknown = null;
    await Promise.all(
      pending.map((seg) =>
        this.runSegment(seg, inner.signal).catch((e) => {
          if (!firstError && !(isAbortError(e) && signal.aborted)) {
            firstError = e;
            inner.abort(); // stop sibling segments
          }
        }),
      ),
    );
    signal.removeEventListener("abort", onOuter);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (firstError) throw firstError;
  }

  private async runSegment(seg: SegmentState, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    const len = segLength(seg);
    for (;;) {
      if (len !== Infinity && seg.downloaded >= len) {
        seg.done = true;
        return;
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const from = seg.start + seg.downloaded;
      const useRange = this.mode === "segmented" || (seg.downloaded > 0 && this.acceptRanges);
      if (!useRange && seg.downloaded > 0) {
        await this.cfg.store.reset(seg.index);
        seg.downloaded = 0;
      }
      const range = useRange ? { start: from, end: seg.end >= 0 ? seg.end : undefined } : null;
      try {
        await this.fetchInto(seg, range, signal);
        if (len !== Infinity && seg.downloaded < len) {
          throw new IntegrityError(`Connection closed early (${seg.downloaded} of ${len} bytes for segment ${seg.index + 1})`);
        }
        if (seg.end < 0) {
          seg.end = seg.start + seg.downloaded - 1;
          if (this.total == null) this.total = seg.downloaded;
        }
        seg.done = true;
        this.emit();
        return;
      } catch (e) {
        if (signal.aborted || isAbortError(e)) throw e;
        if (e instanceof RangeIgnoredError) throw e;
        if (isNetworkError(e) && this.transport < this.cfg.transports.length - 1) {
          this.transport++;
          continue; // switch transport without consuming a retry
        }
        if (e instanceof HttpStatusError && !isRetryableStatus(e.status)) throw e;
        attempt++;
        if (attempt > this.cfg.maxRetries) throw e;
        this.notice = `Retrying segment ${seg.index + 1} (attempt ${attempt} of ${this.cfg.maxRetries})…`;
        this.emit(true);
        await sleep(this.cfg.retryDelay(attempt), signal);
      }
    }
  }

  private async fetchInto(seg: SegmentState, range: { start: number; end?: number } | null, signal: AbortSignal): Promise<void> {
    const spec = this.cfg.transports[this.transport](range);
    const headers: Record<string, string> = { ...(spec.headers ?? {}) };
    if (range) headers["Range"] = `bytes=${range.start}-${range.end ?? ""}`;
    const res = await this.cfg.fetch(spec.url, { headers, signal, credentials: spec.credentials ?? "omit", cache: "no-store" });

    if (range) {
      if (res.status === 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new RangeIgnoredError();
      } else if (res.status === 416) {
        throw new HttpStatusError(416, "The server rejected the requested byte range (the file may have changed).");
      } else if (res.status !== 206) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpStatusError(res.status, statusMessage(res.status));
      } else {
        const cr = parseContentRange(res.headers.get("content-range"));
        if (cr && cr.start !== range.start) throw new IntegrityError("Server returned a different byte range than requested.");
        if (cr && cr.total != null && this.total != null && cr.total !== this.total) {
          throw new HttpStatusError(409, "The file changed on the server during the download.");
        }
      }
    } else if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpStatusError(res.status, statusMessage(res.status));
    }
    if (!res.body) throw new IntegrityError("The server returned an empty response.");

    const remaining = segLength(seg) - seg.downloaded;
    const reader = res.body.getReader();
    const writer = await this.cfg.store.writer(seg.index);
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        let chunk = value;
        let finished = false;
        if (received + chunk.byteLength >= remaining) {
          chunk = chunk.subarray(0, remaining - received);
          finished = true;
        }
        if (chunk.byteLength) {
          if (this.cfg.throttle) await this.cfg.throttle(chunk.byteLength, signal);
          await writer.write(chunk);
          received += chunk.byteLength;
          seg.downloaded += chunk.byteLength;
        }
        if (this.cfg.maxBytes && this.downloaded > this.cfg.maxBytes) {
          throw new HttpStatusError(413, "The file is larger than the allowed maximum size.");
        }
        this.emit();
        if (finished) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    } finally {
      await writer.close();
    }
  }

  private async finalize(): Promise<Blob> {
    const sizes = await Promise.all(this.segments.map((s) => this.cfg.store.size(s.index)));
    for (const s of this.segments) {
      const expected = segLength(s);
      if (sizes[s.index] !== expected) {
        throw new IntegrityError(`Segment ${s.index + 1} has ${sizes[s.index]} bytes, expected ${expected}.`);
      }
    }
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (this.total != null && sum !== this.total) {
      throw new IntegrityError(`Size check failed: received ${sum} bytes, expected ${this.total}.`);
    }
    const blob = await this.cfg.store.assemble(this.segments.length, this.cfg.mimeType ?? "application/octet-stream");
    if (this.total != null && blob.size !== this.total) {
      throw new IntegrityError(`Assembled file is ${blob.size} bytes, expected ${this.total}.`);
    }
    return blob;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function statusMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return `Access denied (HTTP ${status}). The file requires authorization, which MediaGrab does not bypass.`;
    case 404:
      return "File not found (HTTP 404).";
    case 410:
      return "The file is no longer available (HTTP 410).";
    case 413:
      return "The file exceeds the server's size limit.";
    case 429:
      return "The server is rate limiting requests (HTTP 429).";
    default:
      return status >= 500 ? `The server had an error (HTTP ${status}).` : `Request failed (HTTP ${status}).`;
  }
}

function describeError(e: unknown): string {
  if (e instanceof TypeError) return "Network error — the connection failed or was blocked.";
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Simple in-memory store — good for tests and small files. */
export class MemorySegmentStore implements SegmentStore {
  private parts = new Map<number, Uint8Array[]>();

  async init(count: number): Promise<void> {
    for (let i = 0; i < count; i++) if (!this.parts.has(i)) this.parts.set(i, []);
    for (const k of [...this.parts.keys()]) if (k >= count) this.parts.delete(k);
  }
  async size(index: number): Promise<number> {
    return (this.parts.get(index) ?? []).reduce((a, c) => a + c.byteLength, 0);
  }
  async writer(index: number): Promise<SegmentWriter> {
    if (!this.parts.has(index)) this.parts.set(index, []);
    const list = this.parts.get(index)!;
    return {
      write: async (chunk) => {
        list.push(chunk.slice());
      },
      close: async () => undefined,
    };
  }
  async reset(index: number): Promise<void> {
    this.parts.set(index, []);
  }
  async assemble(count: number, mimeType: string): Promise<Blob> {
    const all: BlobPart[] = [];
    for (let i = 0; i < count; i++) for (const c of this.parts.get(i) ?? []) all.push(c as BlobPart);
    return new Blob(all, { type: mimeType });
  }
  async destroy(): Promise<void> {
    this.parts.clear();
  }
}
