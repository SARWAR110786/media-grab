import {
  classify,
  DOWNLOADABLE_EXTS,
  extFromUrl,
  matchProtectedHost,
  MEDIA_EXTS,
  PROTECTED_SITE_REASON,
  resolveFilename,
  sanitizeFilename,
  STREAMING_EXTS,
  STREAMING_REASON,
} from "@mediagrab/shared";
import type { DetectedMedia, MediaSource } from "./types";

export interface DetectOptions {
  includeFiles: boolean;
  showUnsupported: boolean;
}

export const BLOB_REASON =
  "Streamed with Media Source Extensions (a blob: URL). The media is assembled from many fragments by the site's player, so there is no single file to download.";
export const DRM_REASON = "Protected with DRM (Encrypted Media Extensions). MediaGrab does not bypass DRM or encryption.";

const FILE_CATEGORIES = new Set(["document", "archive", "program"]);

function absolute(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.startsWith("javascript:") || v.startsWith("#")) return null;
  try {
    const u = new URL(v, base);
    if (u.protocol === "blob:") return u.href;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function titleName(doc: Document, ext: string): string {
  const base = sanitizeFilename(doc.title || doc.location?.hostname || "media", "media").slice(0, 80);
  return ext ? `${base}.${ext}` : base;
}

/**
 * Scan a document for downloadable media. Pure DOM reads — no network requests, nothing leaves the page.
 */
export function detectMedia(doc: Document, opts: DetectOptions, perf?: Performance): { items: DetectedMedia[]; notes: string[] } {
  const base = doc.baseURI || doc.location?.href || "";
  const found = new Map<string, DetectedMedia>();
  const notes = new Set<string>();

  const add = (url: string, source: MediaSource, extra: Partial<DetectedMedia> = {}, mimeHint?: string | null) => {
    if (url.startsWith("blob:")) {
      notes.add(BLOB_REASON);
      if (!opts.showUnsupported) return;
      const key = `blob:${source}:${found.size}`;
      const isAudio = source === "audio";
      found.set(key, {
        id: key,
        url,
        filename: titleName(doc, ""),
        ext: "",
        mime: isAudio ? "audio/*" : "video/*",
        category: isAudio ? "audio" : "video",
        label: "Stream",
        source,
        supported: false,
        reason: BLOB_REASON,
        ...extra,
      });
      return;
    }
    const c = classify(url, mimeHint);
    if (!c.supported) notes.add(c.reason ?? STREAMING_REASON);
    if (!c.supported && !opts.showUnsupported) return;
    if (!opts.includeFiles && FILE_CATEGORIES.has(c.category)) return;
    const existing = found.get(url);
    if (existing) {
      // Prefer element-sourced metadata (resolution, duration) over plain links.
      Object.assign(existing, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
      if (existing.source === "link" || existing.source === "network") existing.source = source;
      return;
    }
    found.set(url, {
      id: url,
      url,
      filename: resolveFilename({ url, mime: c.mime }),
      ext: c.ext,
      mime: c.mime,
      category: c.category,
      label: c.label,
      source,
      supported: c.supported,
      reason: c.reason,
      ...extra,
    });
  };

  // HTML5 <video> / <audio> and their <source> children.
  for (const el of Array.from(doc.querySelectorAll<HTMLMediaElement>("video, audio"))) {
    const kind = el.tagName.toLowerCase() as "video" | "audio";
    const drm = !!(el as HTMLMediaElement & { mediaKeys?: MediaKeys | null }).mediaKeys;
    const meta: Partial<DetectedMedia> = {};
    if (kind === "video") {
      const v = el as HTMLVideoElement;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        meta.width = v.videoWidth;
        meta.height = v.videoHeight;
      }
    }
    if (Number.isFinite(el.duration) && el.duration > 0) meta.duration = el.duration;
    const current = absolute(el.currentSrc || el.getAttribute("src"), base);

    if (drm) {
      notes.add(DRM_REASON);
      if (opts.showUnsupported) {
        const key = `drm:${kind}:${found.size}`;
        found.set(key, {
          id: key,
          url: current ?? "",
          filename: titleName(doc, ""),
          ext: "",
          mime: `${kind}/*`,
          category: kind,
          label: "DRM",
          source: kind,
          supported: false,
          reason: DRM_REASON,
          ...meta,
        });
      }
      continue;
    }
    if (current) add(current, kind, meta, current.startsWith("blob:") ? null : (el.querySelector(`source[src]`) as HTMLSourceElement | null)?.type);
    for (const s of Array.from(el.querySelectorAll<HTMLSourceElement>("source[src]"))) {
      const u = absolute(s.getAttribute("src"), base);
      if (!u) continue;
      add(u, "source", u === current ? meta : {}, s.type || null);
    }
  }

  // <embed> / <object> pointing at media or documents.
  for (const el of Array.from(doc.querySelectorAll<HTMLEmbedElement>("embed[src]"))) {
    const u = absolute(el.getAttribute("src"), base);
    if (u && DOWNLOADABLE_EXTS.has(extFromUrl(u))) add(u, "embed", {}, el.type || null);
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLObjectElement>("object[data]"))) {
    const u = absolute(el.getAttribute("data"), base);
    if (u && DOWNLOADABLE_EXTS.has(extFromUrl(u))) add(u, "embed", {}, el.type || null);
  }

  // Open Graph / Twitter media declarations.
  for (const el of Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[property^="og:video"], meta[property^="og:audio"], meta[name="twitter:player:stream"]'))) {
    const prop = el.getAttribute("property") ?? el.getAttribute("name") ?? "";
    if (/:(type|width|height|duration)$/.test(prop)) continue;
    const u = absolute(el.getAttribute("content"), base);
    if (!u) continue;
    const ext = extFromUrl(u);
    if (MEDIA_EXTS.has(ext) || STREAMING_EXTS.has(ext)) add(u, "meta");
  }

  // Links to downloadable files.
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const u = absolute(a.getAttribute("href"), base);
    if (!u || u.startsWith("blob:")) continue;
    const ext = extFromUrl(u);
    if (DOWNLOADABLE_EXTS.has(ext) || STREAMING_EXTS.has(ext)) {
      const dl = a.getAttribute("download");
      add(u, "link", dl ? { filename: sanitizeFilename(dl, resolveFilename({ url: u })) } : {});
    }
  }

  // Media files the page has already fetched (e.g. players that set src from script).
  if (perf?.getEntriesByType) {
    for (const e of perf.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      const u = absolute(e.name, base);
      if (!u) continue;
      const ext = extFromUrl(u);
      if (MEDIA_EXTS.has(ext) || STREAMING_EXTS.has(ext)) {
        // Media elements fetch with byte ranges, so transfer sizes are partial: don't report them as file size.
        add(u, "network");
      }
    }
  }

  const host = doc.location?.hostname ?? "";
  if (host && matchProtectedHost(host)) {
    // Streaming services (YouTube, Netflix, …) forbid downloading: list what was seen, but never offer a download.
    notes.add(PROTECTED_SITE_REASON);
    return { items: [...found.values()].map((m) => ({ ...m, supported: false, reason: PROTECTED_SITE_REASON })), notes: [...notes] };
  }

  return { items: [...found.values()], notes: [...notes] };
}
