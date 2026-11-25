import "server-only";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const serverConfig = {
  /** Max size the proxy will stream, in bytes. */
  maxProxyBytes: num("MEDIAGRAB_MAX_FILE_SIZE_MB", 2048) * 1024 * 1024,
  /** Upstream connect/idle timeout. */
  timeoutMs: num("MEDIAGRAB_UPSTREAM_TIMEOUT_MS", 20_000),
  maxRedirects: num("MEDIAGRAB_MAX_REDIRECTS", 5),
  /** Max simultaneous proxied streams per client IP (each segment counts as one). */
  maxConcurrentPerIp: num("MEDIAGRAB_MAX_CONCURRENT_PER_IP", 24),
  /** Analyze requests per IP per minute. */
  analyzePerMinute: num("MEDIAGRAB_ANALYZE_PER_MINUTE", 60),
  allowedPorts: (process.env.MEDIAGRAB_ALLOWED_PORTS ?? "80,443")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0),
  /**
   * DANGEROUS — disables SSRF protection for private/loopback addresses and port restrictions.
   * Only for local end-to-end tests against a fixture server. Never enable in production.
   */
  allowPrivateHosts: process.env.MEDIAGRAB_ALLOW_PRIVATE_HOSTS === "true",
};

if (serverConfig.allowPrivateHosts) {
  console.warn("[mediagrab] WARNING: MEDIAGRAB_ALLOW_PRIVATE_HOSTS=true — SSRF protection for private networks is DISABLED.");
}
