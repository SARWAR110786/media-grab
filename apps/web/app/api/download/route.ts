import { type NextRequest } from "next/server";
import { Readable, Transform } from "node:stream";
import { contentDispositionAttachment, isHtmlMime, normalizeMime, parseContentRange, resolveFilename, sanitizeFilename } from "@mediagrab/shared";
import { header, safeRequest, SafeFetchError } from "@/lib/server/safe-fetch";
import { serverConfig } from "@/lib/server/config";
import { acquireSlot, clientKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_RE = /^bytes=\d*-\d*$/;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Streaming download proxy for public files.
 *   GET /api/download?url=<file url>&filename=<optional name>
 * Forwards a single Range header so browsers and the segmented engine can resume and split downloads.
 * Never forwards cookies or credentials; every hop is SSRF-checked.
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") ?? "";
  const requestedName = req.nextUrl.searchParams.get("filename");
  const range = req.headers.get("range");
  if (range && !RANGE_RE.test(range.trim())) return jsonError(416, "Only a single byte range is supported.");

  const release = acquireSlot(`dl:${clientKey(req.headers)}`, serverConfig.maxConcurrentPerIp);
  if (!release) return jsonError(429, "Too many simultaneous downloads from your address. Wait for some to finish.");

  let upstream;
  try {
    upstream = await safeRequest(target, { method: "GET", headers: range ? { Range: range.trim() } : {}, signal: req.signal });
  } catch (e) {
    release();
    if (e instanceof SafeFetchError) {
      const status = e.code === "BLOCKED" ? 403 : e.code === "INVALID_URL" ? 400 : e.code === "TIMEOUT" ? 504 : 502;
      return jsonError(status, e.message);
    }
    return jsonError(502, "Could not reach the file server.");
  }

  const { res, status, headers, finalUrl } = upstream;
  if (status !== 200 && status !== 206) {
    res.destroy();
    release();
    const passthrough = [401, 403, 404, 410, 416, 429].includes(status) ? status : 502;
    return jsonError(passthrough, `The file server responded with HTTP ${status}.`);
  }

  const contentLength = header(headers, "content-length");
  const cr = parseContentRange(header(headers, "content-range"));
  const total = cr?.total ?? (status === 200 && contentLength ? Number(contentLength) : null);
  if (total != null && total > serverConfig.maxProxyBytes) {
    res.destroy();
    release();
    return jsonError(413, "This file is larger than the server's proxy limit. Download it directly in your browser instead.");
  }

  const upstreamMime = normalizeMime(header(headers, "content-type"));
  // Never let upstream HTML/SVG/etc. render on our origin.
  const safeMime = !upstreamMime || isHtmlMime(upstreamMime) || upstreamMime.includes("xml") || upstreamMime.startsWith("text/") ? "application/octet-stream" : upstreamMime;
  const filename = requestedName
    ? sanitizeFilename(requestedName)
    : resolveFilename({ url: finalUrl, contentDisposition: header(headers, "content-disposition"), mime: upstreamMime });

  const out = new Headers({
    "Content-Type": safeMime,
    "Content-Disposition": contentDispositionAttachment(filename),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": header(headers, "accept-ranges") === "bytes" || status === 206 ? "bytes" : "none",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
  });
  if (contentLength && (header(headers, "content-encoding") ?? "identity") === "identity") out.set("Content-Length", contentLength);
  const crHeader = header(headers, "content-range");
  if (status === 206 && crHeader) out.set("Content-Range", crHeader);
  const enc = header(headers, "content-encoding");
  if (enc && enc !== "identity") out.set("Content-Encoding", enc);

  // Enforce the size limit while streaming too (for responses without Content-Length).
  let seen = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > serverConfig.maxProxyBytes) return cb(new Error("Size limit exceeded"));
      cb(null, chunk);
    },
  });
  res.on("error", (e) => limiter.destroy(e));
  limiter.on("close", () => {
    res.destroy();
    release();
  });
  req.signal.addEventListener("abort", () => limiter.destroy(), { once: true });
  res.pipe(limiter);

  const body = Readable.toWeb(limiter) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers: out });
}
