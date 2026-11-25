import "server-only";

/** Small in-memory limiters. For multi-instance deployments put a shared limiter (e.g. at the edge) in front. */

const windows = new Map<string, { count: number; reset: number }>();

export function allowRequest(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.reset < now) {
    windows.set(key, { count: 1, reset: now + windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.reset < now) windows.delete(k);
    return true;
  }
  w.count++;
  return w.count <= limit;
}

const active = new Map<string, number>();

export function acquireSlot(key: string, max: number): (() => void) | null {
  const n = active.get(key) ?? 0;
  if (n >= max) return null;
  active.set(key, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = (active.get(key) ?? 1) - 1;
    if (cur <= 0) active.delete(key);
    else active.set(key, cur);
  };
}

/**
 * Client address for rate limiting.
 * The left end of X-Forwarded-For is whatever the client sent, so it can't be trusted. Each proxy appends
 * the address it received the request from, so with N trusted proxies in front of the app the real client
 * is the Nth entry from the right (MEDIAGRAB_TRUSTED_PROXY_HOPS, default 1).
 */
export function clientKey(headers: Headers, hops = trustedProxyHops()): string {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return headers.get("x-real-ip")?.trim() || "local";
}

function trustedProxyHops(): number {
  const n = Number(process.env.MEDIAGRAB_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
