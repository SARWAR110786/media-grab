import "server-only";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isBlockedIp, isInternalHostname, isIpLiteral, parseHttpUrl } from "@mediagrab/shared";
import { serverConfig } from "./config";

export type SafeFetchErrorCode = "INVALID_URL" | "BLOCKED" | "DNS" | "TIMEOUT" | "CONNECTION" | "TOO_MANY_REDIRECTS" | "ABORTED";

export class SafeFetchError extends Error {
  constructor(
    public code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeRequestOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxRedirects?: number;
  timeoutMs?: number;
  /** Override for tests. */
  allowPrivate?: boolean;
  /** Test hook: specific addresses / ports to allow while keeping every other check active. */
  testAllow?: TestAllow;
}

export interface TestAllow {
  addresses?: string[];
  ports?: number[];
}

export interface SafeResponse {
  res: IncomingMessage;
  status: number;
  headers: IncomingMessage["headers"];
  finalUrl: string;
  redirects: number;
}

const USER_AGENT = "MediaGrab/1.0 (+media downloader; direct public files only)";

/** Throws when a URL may not be fetched by the server. Checks everything that can be known without DNS. */
export function assertFetchableUrl(raw: string | URL, allowPrivate = serverConfig.allowPrivateHosts, testAllow: TestAllow = {}): URL {
  const parsed = parseHttpUrl(String(raw));
  if (!parsed.ok) throw new SafeFetchError("INVALID_URL", parsed.error);
  const url = parsed.url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!serverConfig.allowedPorts.includes(port) && !testAllow.ports?.includes(port)) {
      throw new SafeFetchError("BLOCKED", `Port ${port} is not allowed. Only standard web ports are supported.`);
    }
    if (isIpLiteral(host)) {
      if (isBlockedIp(host) && !testAllow.addresses?.includes(host)) throw new SafeFetchError("BLOCKED", "Private, loopback and internal network addresses are not allowed.");
    } else if (isInternalHostname(host)) {
      throw new SafeFetchError("BLOCKED", "Local and internal host names are not allowed.");
    }
  }
  return url;
}

/**
 * DNS lookup that rejects private addresses. Because it runs at connect time inside the HTTP client,
 * the address that was validated is the address that is connected to (no DNS-rebinding window).
 */
function guardedLookup(allowPrivate: boolean, testAllow: TestAllow = {}): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(new SafeFetchError("DNS", `Could not resolve ${hostname}.`));
      const list = addresses as dns.LookupAddress[];
      if (!list.length) return callback(new SafeFetchError("DNS", `Could not resolve ${hostname}.`));
      if (!allowPrivate && list.some((a) => isBlockedIp(a.address) && !testAllow.addresses?.includes(a.address))) {
        return callback(new SafeFetchError("BLOCKED", "This host resolves to a private or internal network address, which is not allowed."));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  }) as LookupFunction;
}

function requestOnce(url: URL, opts: Required<Pick<SafeRequestOptions, "method" | "timeoutMs">> & SafeRequestOptions, allowPrivate: boolean): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new SafeFetchError("ABORTED", "Request aborted."));
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: opts.method,
        lookup: guardedLookup(allowPrivate, opts.testAllow),
        agent: false,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          // Ranges and sizes are only meaningful for unencoded bodies.
          "Accept-Encoding": "identity",
          ...opts.headers,
        },
      },
      (res) => {
        req.setTimeout(0);
        resolve(res);
      },
    );
    req.setTimeout(opts.timeoutMs, () => req.destroy(new SafeFetchError("TIMEOUT", "The server took too long to respond.")));
    const onAbort = () => req.destroy(new SafeFetchError("ABORTED", "Request aborted."));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => opts.signal?.removeEventListener("abort", onAbort));
    req.on("error", (e) => {
      if (e instanceof SafeFetchError) return reject(e);
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return reject(new SafeFetchError("DNS", `Could not resolve ${url.hostname}.`));
      reject(new SafeFetchError("CONNECTION", `Could not connect to ${url.hostname}${code ? ` (${code})` : ""}.`));
    });
    req.end();
  });
}

/**
 * Fetch a public URL with SSRF protection:
 * protocol/port/host checks, private-IP blocking at DNS resolution, validated manual redirects,
 * timeouts and no cookies or credentials ever forwarded.
 */
export async function safeRequest(rawUrl: string, options: SafeRequestOptions = {}): Promise<SafeResponse> {
  const allowPrivate = options.allowPrivate ?? serverConfig.allowPrivateHosts;
  const maxRedirects = options.maxRedirects ?? serverConfig.maxRedirects;
  const opts = { method: options.method ?? "GET", timeoutMs: options.timeoutMs ?? serverConfig.timeoutMs, ...options };
  let url = assertFetchableUrl(rawUrl, allowPrivate, options.testAllow);
  for (let redirects = 0; ; redirects++) {
    const res = await requestOnce(url, opts, allowPrivate);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && status !== 304 && res.headers.location) {
      res.resume(); // discard body
      if (redirects >= maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects.");
      let next: URL;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new SafeFetchError("INVALID_URL", "The server redirected to an invalid URL.");
      }
      // Every hop is validated exactly like the original URL.
      url = assertFetchableUrl(next, allowPrivate, options.testAllow);
      continue;
    }
    return { res, status, headers: res.headers, finalUrl: url.href, redirects };
  }
}

/** Read at most `limit` bytes of a response body, then destroy it. */
export async function readLimited(res: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of res) {
      const buf = chunk as Buffer;
      const take = Math.min(buf.length, limit - size);
      chunks.push(buf.subarray(0, take));
      size += take;
      if (size >= limit) break;
    }
  } finally {
    res.destroy();
  }
  return Buffer.concat(chunks);
}

export function header(h: IncomingMessage["headers"], name: string): string | null {
  const v = h[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
