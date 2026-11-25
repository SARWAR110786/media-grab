import { describe, expect, it } from "vitest";
import { createHash as nodeHash } from "node:crypto";
import { BandwidthLimiter, createHash, hashBlob, MemorySegmentStore, parseChecksum, SegmentedDownload, type HashAlgorithm } from "../src";
import { startTestServer } from "./server";

const ALGOS: HashAlgorithm[] = ["md5", "sha1", "sha256"];

function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("incremental hashes", () => {
  it.each(ALGOS)("%s matches Node's crypto for edge-case lengths", (algo: HashAlgorithm) => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 100_003]) {
      const data = bytes(n, n + 1);
      const h = createHash(algo);
      h.update(data);
      expect(h.digest()).toBe(nodeHash(algo).update(data).digest("hex"));
    }
  });

  it.each(ALGOS)("%s gives the same result however the input is split", (algo: HashAlgorithm) => {
    const data = bytes(70_001);
    const expected = nodeHash(algo).update(data).digest("hex");
    for (const step of [1, 7, 63, 64, 65, 4096]) {
      const h = createHash(algo);
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      expect(h.digest()).toBe(expected);
    }
  });

  it("matches well-known test vectors", () => {
    const abc = new TextEncoder().encode("abc");
    const run = (a: HashAlgorithm) => {
      const h = createHash(a);
      h.update(abc);
      return h.digest();
    };
    expect(run("md5")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(run("sha1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(run("sha256")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashBlob reads a Blob in chunks and reports progress", async () => {
    const data = bytes(9 * 1024 * 1024 + 17);
    const seen: number[] = [];
    const hex = await hashBlob(new Blob([data as BlobPart]), "sha256", { onProgress: (d) => seen.push(d) });
    expect(hex).toBe(nodeHash("sha256").update(data).digest("hex"));
    expect(seen[seen.length - 1]).toBe(data.length);
    expect(seen.length).toBe(3);
  });

  it("a finished hash can't be reused", () => {
    const h = createHash("md5");
    h.digest();
    let threw = false;
    try {
      h.update(new Uint8Array(1));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("parseChecksum", () => {
  const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  it("detects the algorithm from the length", () => {
    expect(parseChecksum("D41D8CD98F00B204E9800998ECF8427E")).toMatchObject({ ok: true, algorithm: "md5", hex: "d41d8cd98f00b204e9800998ecf8427e" });
    expect(parseChecksum("da39a3ee5e6b4b0d3255bfef95601890afd80709")).toMatchObject({ ok: true, algorithm: "sha1" });
    expect(parseChecksum(sha)).toMatchObject({ ok: true, algorithm: "sha256", hex: sha });
  });
  it("accepts common file formats", () => {
    expect(parseChecksum(`${sha}  ubuntu.iso`)).toMatchObject({ ok: true, hex: sha });
    expect(parseChecksum(`SHA256 (ubuntu.iso) = ${sha}`)).toMatchObject({ ok: true, algorithm: "sha256" });
    expect(parseChecksum(`sha256:${sha}`)).toMatchObject({ ok: true, algorithm: "sha256" });
  });
  it("rejects bad input", () => {
    expect(parseChecksum("").ok).toBe(false);
    expect(parseChecksum("not a hash").ok).toBe(false);
    expect(parseChecksum("abc123").ok).toBe(false);
    expect(parseChecksum(`md5:${sha}`).ok).toBe(false);
  });
});

describe("BandwidthLimiter", () => {
  it("is a no-op when unlimited", () => {
    const l = new BandwidthLimiter(0);
    expect(l.reserve(10_000_000)).toBe(0);
  });

  it("allows a burst, then spaces out use to the rate", () => {
    let t = 0;
    const l = new BandwidthLimiter(100_000, () => t); // 100 KB/s, burst 25 KB
    expect(l.reserve(25_000)).toBe(0);
    expect(l.reserve(50_000)).toBe(500);
    t = 500;
    expect(l.reserve(0)).toBe(0);
    t = 1500;
    expect(l.reserve(100_000)).toBe(750);
  });

  it("can change rate on the fly", () => {
    let t = 0;
    const l = new BandwidthLimiter(1_000_000, () => t);
    l.reserve(250_000);
    l.setRate(0);
    expect(l.reserve(10_000_000)).toBe(0);
  });

  it("slows a real segmented download to roughly the limit", async () => {
    const size = 600 * 1024;
    const srv = await startTestServer(size);
    try {
      const limiter = new BandwidthLimiter(1024 * 1024); // 1 MiB/s
      const t0 = Date.now();
      const dl = new SegmentedDownload({
        transports: [() => ({ url: `${srv.url}/range/file.bin` })],
        totalSize: size,
        acceptRanges: true,
        maxConnections: 3,
        minSegmentSize: 64 * 1024,
        store: new MemorySegmentStore(),
        throttle: (n, signal) => limiter.take(n, signal),
      });
      const blob = await dl.start();
      const ms = Date.now() - t0;
      expect(blob!.size).toBe(size);
      expect(Buffer.from(await blob!.arrayBuffer()).equals(srv.data)).toBe(true);
      // 600 KiB at 1 MiB/s with a 256 KiB burst needs at least ~330 ms.
      expect(ms).toBeGreaterThan(280);
    } finally {
      await srv.close();
    }
  });
});
