import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { MemorySegmentStore, SegmentedDownload, planSegments, parseContentRange, type EngineSnapshot } from "../src/engine";
import { startTestServer, type TestServer } from "./server";

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

const sha = (b: Buffer | Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const direct = (path: string) => () => ({ url: srv.url + path });

async function blobBytes(b: Blob) {
  return Buffer.from(await b.arrayBuffer());
}

describe("planSegments", () => {
  it("splits evenly and covers every byte exactly once", () => {
    const plan = planSegments(10_000_003, true, 8, 1_000_000);
    expect(plan).toHaveLength(8);
    expect(plan[0].start).toBe(0);
    expect(plan[7].end).toBe(10_000_002);
    for (let i = 1; i < plan.length; i++) expect(plan[i].start).toBe(plan[i - 1].end + 1);
  });
  it("uses one segment without range support, small files, or unknown size", () => {
    expect(planSegments(10_000_000, false, 8, 1_000_000)).toEqual([{ start: 0, end: 9_999_999 }]);
    expect(planSegments(1_500_000, true, 8, 1_000_000)).toHaveLength(1);
    expect(planSegments(null, true, 8, 1_000_000)).toEqual([{ start: 0, end: -1 }]);
  });
  it("limits segments by minimum size", () => {
    expect(planSegments(3_500_000, true, 16, 1_000_000)).toHaveLength(3);
  });
});

describe("parseContentRange", () => {
  it("parses ranges", () => {
    expect(parseContentRange("bytes 0-99/1000")).toEqual({ start: 0, end: 99, total: 1000 });
    expect(parseContentRange("bytes 5-9/*")).toEqual({ start: 5, end: 9, total: null });
    expect(parseContentRange("garbage")).toBeNull();
  });
});

describe("SegmentedDownload", () => {
  it("downloads with concurrent range segments and reassembles correctly", async () => {
    srv.requests.length = 0;
    const dl = new SegmentedDownload({
      transports: [direct("/range/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      maxConnections: 4,
      minSegmentSize: 512 * 1024,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(srv.data.length);
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
    const snap = dl.snapshot();
    expect(snap.mode).toBe("segmented");
    expect(snap.segments).toHaveLength(4);
    expect(srv.requests.filter((r) => r.range).length).toBe(4);
  });

  it("falls back to a single stream for servers without Range support", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/norange/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: false,
      maxConnections: 8,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    expect(dl.snapshot().mode).toBe("single");
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
  });

  it("detects servers that advertise ranges but ignore them, and recovers", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/lying/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      maxConnections: 4,
      minSegmentSize: 512 * 1024,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    const snap = dl.snapshot();
    expect(snap.mode).toBe("single");
    expect(snap.notice).toMatch(/ignored range/i);
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
  });

  it("retries interrupted segments from where they stopped", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/flaky/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      maxConnections: 3,
      minSegmentSize: 512 * 1024,
      retryDelay: () => 10,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
  });

  it("downloads files of unknown size", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/norange/file.bin")],
      totalSize: null,
      acceptRanges: false,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    expect(blob!.size).toBe(srv.data.length);
    expect(dl.snapshot().total).toBe(srv.data.length);
  });

  it("fails with an integrity error when the server keeps truncating", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/short/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      maxConnections: 2,
      minSegmentSize: 512 * 1024,
      maxRetries: 2,
      retryDelay: () => 5,
      store: new MemorySegmentStore(),
    });
    await expect(dl.start()).rejects.toThrow();
    const snap = dl.snapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toBeTruthy();
  });

  it("does not retry non-retryable HTTP errors", async () => {
    srv.requests.length = 0;
    const dl = new SegmentedDownload({
      transports: [direct("/status/404")],
      totalSize: null,
      acceptRanges: false,
      retryDelay: () => 5,
      store: new MemorySegmentStore(),
    });
    await expect(dl.start()).rejects.toThrow(/404/);
    expect(srv.requests.filter((r) => r.path === "/status/404")).toHaveLength(1);
  });

  it("retries 5xx errors and then fails", async () => {
    srv.requests.length = 0;
    const dl = new SegmentedDownload({
      transports: [direct("/status/503")],
      totalSize: null,
      acceptRanges: false,
      maxRetries: 2,
      retryDelay: () => 5,
      store: new MemorySegmentStore(),
    });
    await expect(dl.start()).rejects.toThrow(/503/);
    expect(srv.requests.filter((r) => r.path === "/status/503")).toHaveLength(3);
  });

  it("pauses and resumes without re-downloading completed bytes", async () => {
    const store = new MemorySegmentStore();
    let paused = false;
    let dl: SegmentedDownload;
    // Slow the stream down so we can pause mid-way.
    const slowFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      const reader = res.body!.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          const { done, value } = await reader.read();
          if (done) return ctrl.close();
          await new Promise((r) => setTimeout(r, 2));
          ctrl.enqueue(value);
        },
        cancel: () => reader.cancel(),
      });
      return new Response(body, { status: res.status, headers: res.headers });
    };
    const snaps: EngineSnapshot[] = [];
    dl = new SegmentedDownload({
      transports: [direct("/range/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      maxConnections: 4,
      minSegmentSize: 512 * 1024,
      fetch: slowFetch,
      updateInterval: 0,
      store,
      onUpdate: (s) => {
        snaps.push(s);
        if (!paused && s.downloaded > srv.data.length / 3) {
          paused = true;
          dl.pause();
        }
      },
    });
    const first = await dl.start();
    expect(first).toBeNull();
    const pausedSnap = dl.snapshot();
    expect(pausedSnap.status).toBe("paused");
    expect(pausedSnap.resumable).toBe(true);
    const before = pausedSnap.downloaded;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(srv.data.length);

    srv.requests.length = 0;
    const blob = await dl.start();
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
    // Resumed range requests must start beyond segment starts (no re-download).
    const starts = srv.requests.map((r) => Number(/bytes=(\d+)-/.exec(r.range ?? "")?.[1]));
    const planStarts = dl.snapshot().plan.map((p) => p.start);
    expect(starts.some((s) => !planStarts.includes(s))).toBe(true);
  });

  it("resumes from a persisted plan and store (after reload)", async () => {
    const store = new MemorySegmentStore();
    const plan = planSegments(srv.data.length, true, 2, 512 * 1024);
    await store.init(2);
    const w = await store.writer(0);
    await w.write(srv.data.subarray(0, 1000));
    const dl = new SegmentedDownload({
      transports: [direct("/range/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      plan,
      store,
    });
    srv.requests.length = 0;
    const blob = await dl.start();
    expect(sha(await blobBytes(blob!))).toBe(sha(srv.data));
    expect(srv.requests.some((r) => r.range?.startsWith("bytes=1000-"))).toBe(true);
  });

  it("cancels and clears stored data", async () => {
    const store = new MemorySegmentStore();
    const dl = new SegmentedDownload({ transports: [direct("/range/file.bin")], totalSize: srv.data.length, acceptRanges: true, store });
    const p = dl.start();
    await dl.cancel();
    expect(await p).toBeNull();
    expect(dl.snapshot().status).toBe("cancelled");
    expect(await store.size(0)).toBe(0);
  });

  it("switches to the next transport after a network error", async () => {
    const dl = new SegmentedDownload({
      transports: [() => ({ url: "http://127.0.0.1:1/nothing" }), direct("/range/file.bin")],
      totalSize: srv.data.length,
      acceptRanges: true,
      minSegmentSize: 512 * 1024,
      store: new MemorySegmentStore(),
    });
    const blob = await dl.start();
    expect(dl.snapshot().transport).toBe(1);
    expect(blob!.size).toBe(srv.data.length);
  });

  it("enforces maxBytes", async () => {
    const dl = new SegmentedDownload({
      transports: [direct("/norange/file.bin")],
      totalSize: null,
      acceptRanges: false,
      maxBytes: 1024 * 1024,
      store: new MemorySegmentStore(),
    });
    await expect(dl.start()).rejects.toThrow(/maximum size/);
  });
});
