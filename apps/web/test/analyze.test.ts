import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeUrl } from "@/lib/server/analyze";
// @ts-expect-error — plain JS module
import { startFixtureServer } from "../../../scripts/fixture-server.mjs";

let srv: { url: string; port: number; close(): Promise<void> };
let opts: { allowPrivate: false; testAllow: { addresses: string[]; ports: number[] } };
beforeAll(async () => {
  srv = await startFixtureServer();
  opts = { allowPrivate: false, testAllow: { addresses: ["127.0.0.1"], ports: [srv.port] } };
});
afterAll(() => srv.close());

describe("analyzeUrl", () => {
  it("reads metadata of a direct MP4 with range support", async () => {
    const r = await analyzeUrl(`${srv.url}/files/sample.mp4`, opts);
    expect(r).toMatchObject({ ok: true, kind: "file", filename: "sample.mp4", mimeType: "video/mp4", category: "video", acceptRanges: true, segmentable: true });
    if (r.ok && r.kind === "file") expect(r.size).toBe(6 * 1024 * 1024 + 4321 + 12);
  });

  it.each([
    ["song.mp3", "audio", "audio/mpeg"],
    ["document.pdf", "document", "application/pdf"],
    ["archive.zip", "archive", "application/zip"],
    ["clip.webm", "video", "video/webm"],
  ])("handles %s", async (name, category, mime) => {
    const r = await analyzeUrl(`${srv.url}/files/${name}`, opts);
    expect(r).toMatchObject({ ok: true, kind: "file", filename: name, category, mimeType: mime });
  });

  it("detects servers without Range support", async () => {
    const r = await analyzeUrl(`${srv.url}/norange/big.bin`, opts);
    expect(r).toMatchObject({ ok: true, kind: "file", acceptRanges: false, segmentable: false, size: 5 * 1024 * 1024 });
    if (r.ok && r.kind === "file") expect(r.warnings.join(" ")).toMatch(/byte ranges/);
  });

  it("uses a sanitized Content-Disposition filename", async () => {
    const r = await analyzeUrl(`${srv.url}/download`, opts);
    expect(r).toMatchObject({ ok: true, kind: "file", filename: "Quarterly Report.pdf", category: "document" });
  });

  it("reports CORS availability", async () => {
    const r = await analyzeUrl(`${srv.url}/cors/sample.mp4`, { ...opts, origin: "http://localhost:3000" });
    expect(r).toMatchObject({ ok: true, kind: "file", corsDirect: true });
    const r2 = await analyzeUrl(`${srv.url}/files/sample.mp4`, { ...opts, origin: "http://localhost:3000" });
    expect(r2).toMatchObject({ corsDirect: false });
  });

  it("explains webpages and lists direct links found in their HTML", async () => {
    const r = await analyzeUrl(`${srv.url}/page.html`, opts);
    expect(r.ok && r.kind).toBe("webpage");
    if (r.ok && r.kind === "webpage") {
      const urls = r.candidates.map((c) => c.url);
      expect(urls).toContain(`${srv.url}/files/sample.mp4`);
      expect(urls).toContain(`${srv.url}/files/song.mp3`);
      expect(urls).toContain(`${srv.url}/files/document.pdf`);
      expect(r.candidates.find((c) => c.url.endsWith(".m3u8"))?.supported).toBe(false);
      expect(r.message).toMatch(/webpage, not a direct file/);
    }
  });

  it("explains webpages without media", async () => {
    const r = await analyzeUrl(`${srv.url}/empty.html`, opts);
    expect(r).toMatchObject({ ok: true, kind: "webpage", candidates: [] });
    if (r.ok && r.kind === "webpage") expect(r.message).toMatch(/extension/);
  });

  it("rejects invalid URLs", async () => {
    for (const u of ["", "not a url", "ftp://example.com/x.zip", "javascript:alert(1)"]) {
      expect((await analyzeUrl(u, opts)).ok).toBe(false);
    }
    expect(await analyzeUrl("ftp://example.com/x.zip", opts)).toMatchObject({ kind: "invalid" });
  });

  it("refuses protected streaming sites and HLS/DASH without fetching", async () => {
    expect(await analyzeUrl("https://www.youtube.com/watch?v=abc", opts)).toMatchObject({ ok: false, kind: "unsupported" });
    expect(await analyzeUrl("https://www.netflix.com/title/1", opts)).toMatchObject({ ok: false, kind: "unsupported" });
    expect(await analyzeUrl(`${srv.url}/live/master.m3u8`, opts)).toMatchObject({ ok: false, kind: "streaming" });
  });

  it("maps HTTP errors", async () => {
    expect(await analyzeUrl(`${srv.url}/status/404`, opts)).toMatchObject({ ok: false, kind: "http_error", status: 404 });
    expect(await analyzeUrl(`${srv.url}/status/403`, opts)).toMatchObject({ ok: false, kind: "auth_required" });
    expect(await analyzeUrl(`${srv.url}/status/500`, opts)).toMatchObject({ ok: false, kind: "http_error", status: 500 });
  });

  it("blocks private addresses", async () => {
    expect(await analyzeUrl("http://127.0.0.1:9/file.mp4", { allowPrivate: false })).toMatchObject({ ok: false, kind: "blocked" });
    expect(await analyzeUrl("http://169.254.169.254/latest/meta-data", { allowPrivate: false })).toMatchObject({ ok: false, kind: "blocked" });
    expect(await analyzeUrl(`${srv.url}/redirect-private`, opts)).toMatchObject({ ok: false, kind: "blocked" });
  });

  it("reports unreachable hosts", async () => {
    const r = await analyzeUrl(`http://127.0.0.1:1/file.mp4`, { allowPrivate: false, testAllow: { addresses: ["127.0.0.1"], ports: [1] } });
    expect(r).toMatchObject({ ok: false, kind: "unreachable" });
  });
});
