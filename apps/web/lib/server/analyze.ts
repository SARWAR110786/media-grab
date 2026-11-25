import "server-only";
import {
  classify,
  extFromUrl,
  isHtmlMime,
  isStreamingMime,
  matchProtectedHost,
  normalizeMime,
  parseContentRange,
  parseHttpUrl,
  PROTECTED_SITE_REASON,
  resolveFilename,
  STREAMING_EXTS,
  STREAMING_REASON,
  type AnalyzeResponse,
} from "@mediagrab/shared";
import { header, readLimited, safeRequest, SafeFetchError, type TestAllow } from "./safe-fetch";
import { serverConfig } from "./config";
import { scanHtml } from "./html-scan";

const MIN_SEGMENTABLE = 2 * 1024 * 1024;
const HTML_SCAN_LIMIT = 1.5 * 1024 * 1024;

export interface AnalyzeOptions {
  /** Origin of the web app, used to check whether the file host allows direct (CORS) fetches. */
  origin?: string | null;
  signal?: AbortSignal;
  allowPrivate?: boolean;
  testAllow?: TestAllow;
}

export async function analyzeUrl(input: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResponse> {
  const parsed = parseHttpUrl(input);
  if (!parsed.ok) return { ok: false, kind: "invalid", message: parsed.error };
  const url = parsed.url.href;

  const protectedHost = matchProtectedHost(parsed.url.hostname);
  if (protectedHost) {
    return { ok: false, kind: "unsupported", url, message: PROTECTED_SITE_REASON };
  }
  if (STREAMING_EXTS.has(extFromUrl(url))) {
    return { ok: false, kind: "streaming", url, message: STREAMING_REASON };
  }

  let probe;
  try {
    probe = await safeRequest(url, {
      method: "GET",
      headers: { Range: "bytes=0-0", ...(opts.origin ? { Origin: opts.origin } : {}) },
      signal: opts.signal,
      allowPrivate: opts.allowPrivate,
      testAllow: opts.testAllow,
    });
  } catch (e) {
    return fetchErrorResponse(e, url);
  }

  const { status, headers, finalUrl } = probe;
  const mime = normalizeMime(header(headers, "content-type"));

  if (status === 401 || status === 403 || status === 407) {
    probe.res.destroy();
    return {
      ok: false,
      kind: "auth_required",
      status,
      url,
      message: `The server refused access (HTTP ${status}). This file needs a login or permission, and MediaGrab does not bypass authentication, paywalls or access controls.`,
    };
  }
  if (status === 404 || status === 410) {
    probe.res.destroy();
    return { ok: false, kind: "http_error", status, url, message: `The file was not found on the server (HTTP ${status}). Check the link.` };
  }
  if (status === 429) {
    probe.res.destroy();
    return { ok: false, kind: "http_error", status, url, message: "The server is rate limiting requests (HTTP 429). Try again later." };
  }
  if (status === 416) {
    // Usually an empty file; fall through to a plain request below.
  } else if (status < 200 || status >= 300) {
    probe.res.destroy();
    return { ok: false, kind: "http_error", status, url, message: `The server responded with HTTP ${status}.` };
  }

  // Webpage: scan its HTML for direct links instead of pretending it's a file.
  if (isHtmlMime(mime)) {
    probe.res.destroy();
    return analyzeWebpage(url, finalUrl, opts);
  }

  if (isStreamingMime(mime)) {
    probe.res.destroy();
    return { ok: false, kind: "streaming", url, message: STREAMING_REASON };
  }

  const contentEncoding = (header(headers, "content-encoding") ?? "identity").toLowerCase();
  const contentRange = parseContentRange(header(headers, "content-range"));
  let size: number | null = null;
  let acceptRanges = false;
  if (status === 206 && contentRange) {
    size = contentRange.total;
    acceptRanges = contentRange.total != null && contentEncoding === "identity";
  } else {
    const len = Number(header(headers, "content-length"));
    size = Number.isFinite(len) && len >= 0 && header(headers, "content-length") != null && contentEncoding === "identity" ? len : null;
  }
  probe.res.destroy();

  const filename = resolveFilename({ url: finalUrl, contentDisposition: header(headers, "content-disposition"), mime });
  const c = classify(filename.includes(".") ? `https://x/${encodeURIComponent(filename)}` : finalUrl, mime);
  const acao = header(headers, "access-control-allow-origin");
  const corsDirect = !!acao && (acao === "*" || (!!opts.origin && acao === opts.origin));
  const warnings: string[] = [];
  if (!acceptRanges) warnings.push("The server does not support byte ranges: the file downloads over one connection and pausing restarts it.");
  if (size == null) warnings.push("The server did not report the file size, so progress is shown in bytes only.");
  if (contentEncoding !== "identity") warnings.push(`The server compresses this response (${contentEncoding}), so ranges are disabled.`);
  const exceedsLimit = size != null && size > serverConfig.maxProxyBytes;
  if (exceedsLimit) warnings.push("This file is larger than the server's proxy limit. Use the direct browser download instead.");

  return {
    ok: true,
    kind: "file",
    url,
    finalUrl,
    redirected: finalUrl !== url,
    filename,
    mimeType: c.mime,
    category: c.category,
    formatLabel: c.label,
    size,
    acceptRanges,
    segmentable: acceptRanges && size != null && size >= MIN_SEGMENTABLE,
    corsDirect,
    exceedsLimit,
    maxProxySize: serverConfig.maxProxyBytes,
    warnings,
  };
}

async function analyzeWebpage(url: string, finalUrl: string, opts: AnalyzeOptions): Promise<AnalyzeResponse> {
  let html = "";
  try {
    const page = await safeRequest(finalUrl, { method: "GET", signal: opts.signal, allowPrivate: opts.allowPrivate, testAllow: opts.testAllow, headers: { Accept: "text/html,*/*;q=0.5" } });
    if (page.status >= 200 && page.status < 300) {
      html = (await readLimited(page.res, HTML_SCAN_LIMIT)).toString("utf8");
    } else page.res.destroy();
  } catch {
    /* fall through with no HTML */
  }
  const { title, candidates } = scanHtml(html, finalUrl);
  const supported = candidates.filter((c) => c.supported);
  let message: string;
  if (supported.length) {
    message = `This is a webpage, not a direct file. MediaGrab found ${supported.length} direct file link${supported.length === 1 ? "" : "s"} in the page's HTML.`;
  } else if (candidates.length) {
    message =
      "This is a webpage. It only references adaptive streams (HLS/DASH), which MediaGrab does not download. The site may use protected or unsupported streaming technology.";
  } else {
    message =
      "This is a webpage, not a direct file, and no direct media links were found in its HTML. If the media is added by JavaScript, open the page in Chrome and use the MediaGrab extension to detect it. If the site uses protected (DRM) or adaptive streaming, it is not supported.";
  }
  return { ok: true, kind: "webpage", url, finalUrl, title, candidates, message };
}

function fetchErrorResponse(e: unknown, url: string): AnalyzeResponse {
  if (e instanceof SafeFetchError) {
    switch (e.code) {
      case "INVALID_URL":
        return { ok: false, kind: "invalid", url, message: e.message };
      case "BLOCKED":
        return { ok: false, kind: "blocked", url, message: `${e.message} MediaGrab only fetches publicly accessible files.` };
      case "TOO_MANY_REDIRECTS":
        return { ok: false, kind: "unreachable", url, message: "The link redirects too many times." };
      case "TIMEOUT":
        return { ok: false, kind: "unreachable", url, message: "The server took too long to respond." };
      case "DNS":
        return { ok: false, kind: "unreachable", url, message: `${e.message} Check the domain name.` };
      default:
        return { ok: false, kind: "unreachable", url, message: e.message };
    }
  }
  return { ok: false, kind: "unreachable", url, message: "The server could not be reached." };
}
