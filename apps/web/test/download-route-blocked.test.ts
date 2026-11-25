import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.stubEnv("MEDIAGRAB_ALLOW_PRIVATE_HOSTS", "false");
const { GET } = await import("@/app/api/download/route");

describe("/api/download SSRF protection", () => {
  it.each(["http://127.0.0.1/", "http://localhost:3000/api/health", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.1/a.mp4"])("refuses %s", async (url) => {
    const res = await GET(new NextRequest(`http://localhost:3000/api/download?url=${encodeURIComponent(url)}`));
    expect(res.status).toBe(403);
  });
});
