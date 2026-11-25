/**
 * Incremental (streaming) hashes for verifying finished downloads against a published checksum.
 * Pure TypeScript so it works in the browser on multi-GB files without loading them into memory
 * (Web Crypto's digest() needs the whole file as one buffer and has no MD5).
 */

export type HashAlgorithm = "md5" | "sha1" | "sha256";

export interface IncrementalHash {
  update(data: Uint8Array): void;
  /** Lowercase hex digest. The hash can't be updated afterwards. */
  digest(): string;
}

const HEX_LENGTH: Record<number, HashAlgorithm> = { 32: "md5", 40: "sha1", 64: "sha256" };

export const HASH_LABEL: Record<HashAlgorithm, string> = { md5: "MD5", sha1: "SHA-1", sha256: "SHA-256" };

export type ParsedChecksum = { ok: true; algorithm: HashAlgorithm; hex: string } | { ok: false; error: string };

/**
 * Accepts a bare hex digest, "sha256:abc…", "SHA256 (file) = abc…" (BSD style) or "abc…  filename" (coreutils style).
 * The algorithm is taken from a prefix when given, otherwise from the digest length.
 */
export function parseChecksum(input: string): ParsedChecksum {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Paste a checksum." };
  let named: HashAlgorithm | null = null;
  const prefix = /^(md5|sha-?1|sha-?256)\s*[:=(]/i.exec(raw);
  if (prefix) named = prefix[1].toLowerCase().replace("-", "") as HashAlgorithm;
  const candidates = raw.match(/\b[0-9a-f]{32,64}\b/gi) ?? [];
  const hex = candidates.find((c) => HEX_LENGTH[c.length])?.toLowerCase();
  if (!hex) return { ok: false, error: "That isn't an MD5, SHA-1 or SHA-256 checksum (32, 40 or 64 hex characters)." };
  const byLength = HEX_LENGTH[hex.length];
  if (named && named !== byLength) return { ok: false, error: `That ${HASH_LABEL[named]} checksum has the wrong length.` };
  return { ok: true, algorithm: byLength, hex };
}

export function createHash(algorithm: HashAlgorithm): IncrementalHash {
  switch (algorithm) {
    case "md5":
      return new Md5();
    case "sha1":
      return new Sha1();
    case "sha256":
      return new Sha256();
  }
}

/** Hash a Blob in chunks. `onProgress` gets bytes hashed so far; `signal` aborts. */
export async function hashBlob(blob: Blob, algorithm: HashAlgorithm, opts: { onProgress?: (done: number) => void; signal?: AbortSignal } = {}): Promise<string> {
  const h = createHash(algorithm);
  const CHUNK = 4 * 1024 * 1024;
  let done = 0;
  for (let off = 0; off < blob.size; off += CHUNK) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    h.update(buf);
    done += buf.byteLength;
    opts.onProgress?.(done);
    // Yield so the UI stays responsive on large files.
    await new Promise((r) => setTimeout(r, 0));
  }
  return h.digest();
}

// ---------------------------------------------------------------------------------------------

const toHex = (words: number[], littleEndian: boolean) =>
  words
    .map((w) => {
      const b = [w >>> 24, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff];
      if (littleEndian) b.reverse();
      return b.map((x) => x.toString(16).padStart(2, "0")).join("");
    })
    .join("");

/** Shared 64-byte block buffering and Merkle–Damgård padding. */
abstract class BlockHash implements IncrementalHash {
  private block = new Uint8Array(64);
  private used = 0;
  private bytes = 0;
  private finished = false;
  protected abstract littleEndian: boolean;
  protected abstract compress(block: Uint8Array): void;
  protected abstract state(): number[];

  update(data: Uint8Array): void {
    if (this.finished) throw new Error("Hash already finalized");
    this.bytes += data.byteLength;
    let i = 0;
    if (this.used) {
      const take = Math.min(64 - this.used, data.byteLength);
      this.block.set(data.subarray(0, take), this.used);
      this.used += take;
      i = take;
      if (this.used < 64) return;
      this.compress(this.block);
      this.used = 0;
    }
    for (; i + 64 <= data.byteLength; i += 64) this.compress(data.subarray(i, i + 64));
    if (i < data.byteLength) {
      this.block.set(data.subarray(i), 0);
      this.used = data.byteLength - i;
    }
  }

  digest(): string {
    if (this.finished) throw new Error("Hash already finalized");
    const bits = this.bytes * 8;
    const pad = new Uint8Array(((this.used < 56 ? 56 : 120) - this.used) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    const n = pad.length;
    const len = this.littleEndian ? [lo, hi] : [hi, lo];
    for (let k = 0; k < 2; k++) {
      const w = len[k];
      const at = n - 8 + k * 4;
      if (this.littleEndian) {
        pad[at] = w & 0xff;
        pad[at + 1] = (w >>> 8) & 0xff;
        pad[at + 2] = (w >>> 16) & 0xff;
        pad[at + 3] = w >>> 24;
      } else {
        pad[at] = w >>> 24;
        pad[at + 1] = (w >>> 16) & 0xff;
        pad[at + 2] = (w >>> 8) & 0xff;
        pad[at + 3] = w & 0xff;
      }
    }
    const bytes = this.bytes;
    this.update(pad);
    this.bytes = bytes;
    this.finished = true;
    return toHex(this.state(), this.littleEndian);
  }
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

class Md5 extends BlockHash {
  protected littleEndian = true;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  private static K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  private static S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  private m = new Array<number>(16);

  protected compress(b: Uint8Array): void {
    const m = this.m;
    for (let i = 0; i < 16; i++) m[i] = b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24);
    let [a, bb, c, d] = this.h;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & c) | (~bb & d);
        g = i;
      } else if (i < 32) {
        f = (d & bb) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (bb | ~d);
        g = (7 * i) % 16;
      }
      const s = Md5.S[(i >> 4) * 4 + (i % 4)];
      const t = d;
      d = c;
      c = bb;
      bb = (bb + rotl((a + f + Md5.K[i] + m[g]) | 0, s)) | 0;
      a = t;
    }
    this.h = [(this.h[0] + a) | 0, (this.h[1] + bb) | 0, (this.h[2] + c) | 0, (this.h[3] + d) | 0];
  }
  protected state(): number[] {
    return this.h.map((x) => x >>> 0);
  }
}

class Sha1 extends BlockHash {
  protected littleEndian = false;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  private w = new Array<number>(80);

  protected compress(b: Uint8Array): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3];
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, bb, c, d, e] = this.h;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(bb, 30);
      bb = a;
      a = t;
    }
    this.h = [(this.h[0] + a) | 0, (this.h[1] + bb) | 0, (this.h[2] + c) | 0, (this.h[3] + d) | 0, (this.h[4] + e) | 0];
  }
  protected state(): number[] {
    return this.h.map((x) => x >>> 0);
  }
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

class Sha256 extends BlockHash {
  protected littleEndian = false;
  private h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  private w = new Array<number>(64);

  protected compress(b: Uint8Array): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, hh] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    const s = this.h;
    this.h = [s[0] + a, s[1] + bb, s[2] + c, s[3] + d, s[4] + e, s[5] + f, s[6] + g, s[7] + hh].map((x) => x | 0);
  }
  protected state(): number[] {
    return this.h.map((x) => x >>> 0);
  }
}
