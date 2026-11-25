import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import { assertFetchableUrl, safeRequest, SafeFetchError } from "@/lib/server/safe-fetch";
// @ts-expect-error — plain JS module
import { startFixtureServer } from "../../../scripts/fixture-server.mjs";

let srv: { url: string; port: number; close(): Promise<void> };
beforeAll(async () => {
  srv = await startFixtureServer();
});
afterAll(() => srv.close());

const blocked = (url: string) => {
  try {
    assertFetchableUrl(url, false);
    return false;
  } catch (e) {
    return e instanceof SafeFetchError;
  }
};

describe("assertFetchableUrl (SSRF guard)", () => {
  it.each([
    "http://localhost/",
    "http://LOCALHOST./x",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.5.4/",
    "http://0.0.0.0/",
    "http://[fd00::1]/",
    "http://intranet/",
    "http://printer.local/",
    "http://example.com:22/",
    "http://example.com:6379/",
    "file:///etc/passwd",
    "ftp://example.com/file.zip",
    "gopher://example.com/",
    "http://user:pass@example.com/file.mp4",
  ])("blocks %s", (url) => {
    expect(blocked(url)).toBe(true);
  });

  it.each(["https://example.com/video.mp4", "http://example.com/a.mp3", "https://93.184.216.34/file.zip", "https://[2606:4700:4700::1111]/x"])("allows %s", (url) => {
    expect(blocked(url)).toBe(false);
  });
});

describe("safeRequest", () => {
  it("blocks hostnames that resolve to private addresses (checked at connect time)", async () => {
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => {
      cb(null, [{ address: "10.1.2.3", family: 4 }]);
    }) as unknown as typeof dns.lookup);
    try {
      await expect(safeRequest("http://rebind.example.com/file.mp4", { allowPrivate: false })).rejects.toMatchObject({ code: "BLOCKED" });
    } finally {
      spy.mockRestore();
    }
  });

  it("blocks when any resolved address is private (multi-record DNS)", async () => {
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => {
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    }) as unknown as typeof dns.lookup);
    try {
      await expect(safeRequest("http://mixed.example.com/", { allowPrivate: false })).rejects.toMatchObject({ code: "BLOCKED" });
    } finally {
      spy.mockRestore();
    }
  });

  it("validates every redirect hop", async () => {
    const testAllow = { addresses: ["127.0.0.1"], ports: [srv.port] };
    await expect(safeRequest(`${srv.url}/redirect-private`, { allowPrivate: false, testAllow })).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(safeRequest(`${srv.url}/redirect?to=${encodeURIComponent("file:///etc/passwd")}`, { allowPrivate: false, testAllow })).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(safeRequest(`${srv.url}/redirect?to=${encodeURIComponent("http://localhost:" + srv.port + "/files/sample.mp4")}`, { allowPrivate: false, testAllow })).rejects.toMatchObject({ code: "BLOCKED" });
  });

  it("follows safe redirects and stops redirect loops", async () => {
    const testAllow = { addresses: ["127.0.0.1"], ports: [srv.port] };
    const ok = await safeRequest(`${srv.url}/redirect?to=/files/song.mp3`, { allowPrivate: false, testAllow, method: "HEAD" });
    expect(ok.status).toBe(200);
    expect(ok.finalUrl).toBe(`${srv.url}/files/song.mp3`);
    ok.res.destroy();
    await expect(safeRequest(`${srv.url}/redirect-loop`, { allowPrivate: false, testAllow })).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("never forwards cookies or credentials", async () => {
    const testAllow = { addresses: ["127.0.0.1"], ports: [srv.port] };
    const r = await safeRequest(`${srv.url}/files/tone.wav`, { allowPrivate: false, testAllow, method: "HEAD" });
    r.res.destroy();
    const req = (srv as unknown as { requests: Array<{ path: string; cookie?: string; authorization?: string }> }).requests.at(-1);
    expect(req?.path).toBe("/files/tone.wav");
    expect(req?.cookie).toBeUndefined();
    expect(req?.authorization).toBeUndefined();
  });
});
