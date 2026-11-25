import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
// @ts-expect-error — plain JS module
import { startFixtureServer } from "../../../scripts/fixture-server.mjs";

// The proxy route reads its config at import time; allow the loopback fixture server for this file only.
vi.stubEnv("MEDIAGRAB_ALLOW_PRIVATE_HOSTS", "true");
const { GET } = await import("@/app/api/download/route");

type Srv = { url: string; files: Record<string, { data: Buffer; mime: string }>; close(): Promise<void> };
let srv: Srv;
beforeAll(async () => {
  srv = await startFixtureServer();
});
afterAll(() => srv.close());

const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

function call(target: string, headers: Record<string, string> = {}, filename?: string) {
  const q = new URLSearchParams({ url: target });
  if (filename) q.set("filename", filename);
  return GET(new NextRequest(`http://localhost:3000/api/download?${q}`, { headers }));
}

describe("/api/download proxy", () => {
  it("streams a whole file with safe headers", async () => {
    const res = await call(`${srv.url}/files/document.pdf`);
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(sha(body)).toBe(sha(srv.files["document.pdf"].data));
    expect(res.headers.get("content-disposition")).toContain('filename="document.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("passes Range requests through", async () => {
    const res = await call(`${srv.url}/files/sample.mp4`, { Range: "bytes=100-199" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-199/${srv.files["sample.mp4"].data.length}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(srv.files["sample.mp4"].data.subarray(100, 200))).toBe(true);
  });

  it("rejects multi-range and malformed Range headers", async () => {
    expect((await call(`${srv.url}/files/sample.mp4`, { Range: "bytes=0-1,5-6" })).status).toBe(416);
  });

  it("sanitizes the requested filename", async () => {
    const res = await call(`${srv.url}/files/song.mp3`, {}, "../../etc/evil\r\nname.mp3");
    const cd = res.headers.get("content-disposition")!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).not.toContain("..");
    expect(cd).toContain("filename=\"evilname.mp3\"");
    await res.body?.cancel();
  });

  it("never serves upstream HTML as HTML", async () => {
    const res = await call(`${srv.url}/page.html`);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    await res.body?.cancel();
  });

  it("forwards upstream errors without a body leak", async () => {
    const res = await call(`${srv.url}/status/404`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("rejects non-http protocols", async () => {
    expect((await call("file:///etc/passwd")).status).toBe(400);
  });
});
