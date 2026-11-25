export type MediaCategory =
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "image"
  | "program"
  | "streaming"
  | "other";

export interface FormatInfo {
  ext: string;
  mime: string;
  category: MediaCategory;
  label: string;
}

/** Known downloadable formats. The first entry for a mime type is its canonical extension. */
export const FORMATS: FormatInfo[] = [
  { ext: "mp4", mime: "video/mp4", category: "video", label: "MP4" },
  { ext: "m4v", mime: "video/x-m4v", category: "video", label: "M4V" },
  { ext: "webm", mime: "video/webm", category: "video", label: "WebM" },
  { ext: "mkv", mime: "video/x-matroska", category: "video", label: "MKV" },
  { ext: "mov", mime: "video/quicktime", category: "video", label: "MOV" },
  { ext: "avi", mime: "video/x-msvideo", category: "video", label: "AVI" },
  { ext: "ogv", mime: "video/ogg", category: "video", label: "OGV" },
  { ext: "3gp", mime: "video/3gpp", category: "video", label: "3GP" },
  { ext: "mp3", mime: "audio/mpeg", category: "audio", label: "MP3" },
  { ext: "m4a", mime: "audio/mp4", category: "audio", label: "M4A" },
  { ext: "aac", mime: "audio/aac", category: "audio", label: "AAC" },
  { ext: "wav", mime: "audio/wav", category: "audio", label: "WAV" },
  { ext: "ogg", mime: "audio/ogg", category: "audio", label: "OGG" },
  { ext: "oga", mime: "audio/ogg", category: "audio", label: "OGA" },
  { ext: "opus", mime: "audio/opus", category: "audio", label: "Opus" },
  { ext: "flac", mime: "audio/flac", category: "audio", label: "FLAC" },
  { ext: "weba", mime: "audio/webm", category: "audio", label: "WebA" },
  { ext: "pdf", mime: "application/pdf", category: "document", label: "PDF" },
  { ext: "epub", mime: "application/epub+zip", category: "document", label: "EPUB" },
  { ext: "zip", mime: "application/zip", category: "archive", label: "ZIP" },
  { ext: "rar", mime: "application/vnd.rar", category: "archive", label: "RAR" },
  { ext: "7z", mime: "application/x-7z-compressed", category: "archive", label: "7Z" },
  { ext: "tar", mime: "application/x-tar", category: "archive", label: "TAR" },
  { ext: "gz", mime: "application/gzip", category: "archive", label: "GZ" },
  { ext: "tgz", mime: "application/gzip", category: "archive", label: "TGZ" },
  { ext: "iso", mime: "application/x-iso9660-image", category: "archive", label: "ISO" },
  { ext: "dmg", mime: "application/x-apple-diskimage", category: "program", label: "DMG" },
  { ext: "exe", mime: "application/vnd.microsoft.portable-executable", category: "program", label: "EXE" },
  { ext: "msi", mime: "application/x-msi", category: "program", label: "MSI" },
  { ext: "apk", mime: "application/vnd.android.package-archive", category: "program", label: "APK" },
  { ext: "deb", mime: "application/vnd.debian.binary-package", category: "program", label: "DEB" },
  { ext: "jpg", mime: "image/jpeg", category: "image", label: "JPG" },
  { ext: "jpeg", mime: "image/jpeg", category: "image", label: "JPEG" },
  { ext: "png", mime: "image/png", category: "image", label: "PNG" },
  { ext: "gif", mime: "image/gif", category: "image", label: "GIF" },
  { ext: "webp", mime: "image/webp", category: "image", label: "WebP" },
];

/** Adaptive streaming manifests: detectable, but not downloadable by MediaGrab. */
export const STREAMING_FORMATS: FormatInfo[] = [
  { ext: "m3u8", mime: "application/vnd.apple.mpegurl", category: "streaming", label: "HLS" },
  { ext: "mpd", mime: "application/dash+xml", category: "streaming", label: "DASH" },
  { ext: "ism", mime: "application/vnd.ms-sstr+xml", category: "streaming", label: "Smooth Streaming" },
  { ext: "f4m", mime: "application/f4m+xml", category: "streaming", label: "HDS" },
];

const STREAMING_MIMES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "application/dash+xml",
  "application/vnd.ms-sstr+xml",
  "application/f4m+xml",
]);

const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-flac": "audio/flac",
  "audio/x-m4a": "audio/mp4",
  "application/x-zip-compressed": "application/zip",
  "application/x-zip": "application/zip",
  "application/x-rar-compressed": "application/vnd.rar",
  "application/x-gzip": "application/gzip",
  "application/x-pdf": "application/pdf",
  "application/x-msdownload": "application/vnd.microsoft.portable-executable",
};

/** Mime types that say nothing useful about the file. */
const GENERIC_MIMES = new Set(["application/octet-stream", "binary/octet-stream", "application/download", "application/force-download", ""]);

export function normalizeMime(mime: string | null | undefined): string {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

export function isGenericMime(mime: string | null | undefined): boolean {
  return GENERIC_MIMES.has(normalizeMime(mime));
}

export function isHtmlMime(mime: string | null | undefined): boolean {
  const m = normalizeMime(mime);
  return m === "text/html" || m === "application/xhtml+xml";
}

export function isStreamingMime(mime: string | null | undefined): boolean {
  return STREAMING_MIMES.has(normalizeMime(mime));
}

/** Lower-case extension of the last path segment, without the dot. "" when none. */
export function extFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }
  return extFromName(safeDecode(pathname.split("/").pop() ?? ""));
}

export function extFromName(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function formatFromExt(ext: string): FormatInfo | undefined {
  const e = ext.toLowerCase();
  return FORMATS.find((f) => f.ext === e) ?? STREAMING_FORMATS.find((f) => f.ext === e);
}

export function formatFromMime(mime: string | null | undefined): FormatInfo | undefined {
  const m = normalizeMime(mime);
  if (!m || isGenericMime(m)) return undefined;
  return FORMATS.find((f) => f.mime === m) ?? STREAMING_FORMATS.find((f) => f.mime === m) ?? genericFromMime(m);
}

function genericFromMime(m: string): FormatInfo | undefined {
  if (STREAMING_MIMES.has(m)) return { ext: "m3u8", mime: m, category: "streaming", label: "Stream" };
  const [type, sub] = m.split("/");
  const label = (sub ?? "").replace(/^x-/, "").toUpperCase().slice(0, 8);
  if (type === "video") return { ext: "", mime: m, category: "video", label };
  if (type === "audio") return { ext: "", mime: m, category: "audio", label };
  if (type === "image") return { ext: "", mime: m, category: "image", label };
  return undefined;
}

export interface Classification {
  category: MediaCategory;
  ext: string;
  mime: string;
  label: string;
  /** False for formats MediaGrab detects but cannot download (adaptive streams). */
  supported: boolean;
  reason?: string;
}

export const STREAMING_REASON =
  "Adaptive streaming manifest (HLS/DASH). These streams are split into many encrypted or fragmented pieces; MediaGrab does not download them.";

/** Classify a resource by URL and (optionally) its Content-Type. Mime wins over extension unless generic. */
export function classify(url: string, mime?: string | null): Classification {
  const ext = extFromUrl(url);
  const fromMime = formatFromMime(mime);
  const fromExt = ext ? formatFromExt(ext) : undefined;
  const info = fromMime ?? fromExt;
  const category: MediaCategory = info?.category ?? "other";
  const streaming = category === "streaming";
  return {
    category,
    ext: fromExt?.ext ?? info?.ext ?? ext,
    mime: normalizeMime(mime) || info?.mime || "application/octet-stream",
    label: (fromMime ?? fromExt)?.label || (ext ? ext.toUpperCase() : "File"),
    supported: !streaming,
    reason: streaming ? STREAMING_REASON : undefined,
  };
}

/** Extensions that look like downloadable files when they appear in links. */
export const DOWNLOADABLE_EXTS = new Set([...FORMATS.filter((f) => f.category !== "image").map((f) => f.ext)]);
export const MEDIA_EXTS = new Set(FORMATS.filter((f) => f.category === "video" || f.category === "audio").map((f) => f.ext));
export const STREAMING_EXTS = new Set(STREAMING_FORMATS.map((f) => f.ext));

/**
 * Sites known to deliver media via DRM or adaptive streaming. We do not attempt to download
 * from them — the UI explains why instead of pretending.
 */
export const PROTECTED_STREAMING_HOSTS = [
  "youtube.com",
  "youtu.be",
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "disneyplus.com",
  "hulu.com",
  "max.com",
  "hbomax.com",
  "spotify.com",
  "music.apple.com",
  "tv.apple.com",
  "peacocktv.com",
  "paramountplus.com",
  "crunchyroll.com",
  "tidal.com",
  "deezer.com",
  "soundcloud.com",
  "twitch.tv",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "vimeo.com",
];

export function matchProtectedHost(hostname: string): string | undefined {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return PROTECTED_STREAMING_HOSTS.find((d) => h === d || h.endsWith("." + d));
}

export const PROTECTED_SITE_REASON =
  "This website delivers media through protected (DRM) or adaptive streaming, often behind sign-in. MediaGrab only downloads files that are exposed as direct, publicly accessible links, so this site is not supported.";
