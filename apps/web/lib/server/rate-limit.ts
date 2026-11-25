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

export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip") || "local";
}
