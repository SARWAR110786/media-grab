import { extFromName, formatFromMime, isGenericMime } from "./media";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_NAME_BYTES = 180;

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function truncateBytes(s: string, maxBytes: number): string {
  let out = "";
  for (const ch of s) {
    if (utf8Length(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

/**
 * Turn an untrusted name into a safe single-segment filename:
 * no directories, no traversal, no control or reserved characters, bounded length.
 */
export function sanitizeFilename(input: string | null | undefined, fallback = "download"): string {
  let name = String(input ?? "");
  // Strip any path: keep only the last segment for both separators.
  name = name.split(/[/\\]/).pop() ?? "";
  // Remove control characters, bidi overrides and reserved characters.
  name = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  // No leading dots (hidden files, "..") and no trailing dots/spaces (Windows).
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!name || WINDOWS_RESERVED.test(name)) {
    name = name ? `_${name}` : sanitizeFallback(fallback);
  }
  if (utf8Length(name) > MAX_NAME_BYTES) {
    const ext = extFromName(name);
    const suffix = ext ? `.${ext}` : "";
    const base = name.slice(0, name.length - suffix.length);
    name = truncateBytes(base, MAX_NAME_BYTES - utf8Length(suffix)).trim() + suffix;
  }
  return name;
}

function sanitizeFallback(fallback: string): string {
  const f = fallback.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+/, "");
  return f || "download";
}

/** Parse a Content-Disposition header, preferring RFC 5987 `filename*`. */
export function filenameFromContentDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1");
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return plain[1].trim();
  return undefined;
}

export function filenameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!last) return undefined;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return undefined;
  }
}

/** Append the canonical extension for `mime` when the name has none. */
export function ensureExtension(name: string, mime?: string | null): string {
  if (extFromName(name)) return name;
  if (!mime || isGenericMime(mime)) return name;
  const info = formatFromMime(mime);
  return info?.ext ? `${name}.${info.ext}` : name;
}

/** Best-effort, sanitized filename for a resource. */
export function resolveFilename(opts: { url: string; contentDisposition?: string | null; mime?: string | null; fallback?: string }): string {
  const raw = filenameFromContentDisposition(opts.contentDisposition) ?? filenameFromUrl(opts.url) ?? "";
  const safe = sanitizeFilename(raw, opts.fallback ?? "download");
  return sanitizeFilename(ensureExtension(safe, opts.mime));
}

/** Build a Content-Disposition header value safe for any filename. */
export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
