export const MAX_URL_LENGTH = 4096;

export type ParsedUrl = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Validate user input as an absolute http(s) URL.
 * Adds https:// when the input looks like a bare domain; rejects other protocols and embedded credentials.
 */
export function parseHttpUrl(input: string): ParsedUrl {
  let raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Please enter a URL." };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: "This URL is too long." };
  if (/\s/.test(raw)) return { ok: false, error: "URLs cannot contain spaces." };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (!hasScheme) {
    if (/^\/\//.test(raw)) raw = "https:" + raw;
    else if (/^[^/?#]+\.[^/?#]+/.test(raw)) raw = "https://" + raw;
    else return { ok: false, error: "Enter a full URL, e.g. https://example.com/video.mp4" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `Unsupported protocol "${url.protocol.replace(":", "")}". Only http and https links are supported.` };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs with embedded usernames or passwords are not allowed." };
  }
  if (!url.hostname) return { ok: false, error: "The URL is missing a host name." };
  return { ok: true, url };
}

/** Hostnames that always point at the local machine or internal infrastructure. */
export function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".intranet") || h.endsWith(".lan") || h.endsWith(".home.arpa"))
    return true;
  if (h === "metadata" || h === "metadata.google.internal" || h === "instance-data") return true;
  // Single-label names resolve via local search domains.
  if (!h.includes(".") && !h.includes(":")) return true;
  return false;
}
