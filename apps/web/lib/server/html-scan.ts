import { classify, DOWNLOADABLE_EXTS, extFromUrl, resolveFilename, STREAMING_EXTS, type MediaCandidate } from "@mediagrab/shared";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

/**
 * Find direct media/file links in static HTML. This only sees what the server sends —
 * media inserted by JavaScript is invisible here (the browser extension can see it).
 */
export function scanHtml(html: string, baseUrl: string): { title: string | null; candidates: MediaCandidate[] } {
  const title = /<title[^>]*>([^<]{0,300})<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  let base = baseUrl;
  const baseTag = /<base\s[^>]*href\s*=\s*["']([^"']+)["']/i.exec(html);
  if (baseTag) {
    try {
      base = new URL(decodeEntities(baseTag[1]), baseUrl).href;
    } catch {
      /* ignore */
    }
  }
  const found = new Map<string, MediaCandidate>();
  const add = (raw: string, source: string, force = false) => {
    if (found.size >= 60) return;
    const value = decodeEntities(raw.trim());
    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("javascript:") || value.startsWith("#")) return;
    let abs: URL;
    try {
      abs = new URL(value, base);
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const ext = extFromUrl(abs.href);
    const isStreaming = STREAMING_EXTS.has(ext);
    if (!force && !DOWNLOADABLE_EXTS.has(ext) && !isStreaming) return;
    if (found.has(abs.href)) return;
    const c = classify(abs.href);
    found.set(abs.href, {
      url: abs.href,
      filename: resolveFilename({ url: abs.href }),
      category: c.category,
      formatLabel: c.label,
      source,
      supported: c.supported,
      reason: c.reason,
    });
  };

  // <video src>, <audio src>, <source src>, <embed src>
  for (const m of html.matchAll(/<(video|audio|source|embed|track)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    if (m[1].toLowerCase() === "track") continue;
    add(m[2], `<${m[1].toLowerCase()}> tag`, m[1].toLowerCase() !== "embed");
  }
  // <object data>
  for (const m of html.matchAll(/<object\b[^>]*?\sdata\s*=\s*["']([^"']+)["']/gi)) add(m[1], "<object> tag");
  // Open Graph / Twitter media
  for (const m of html.matchAll(/<meta\b[^>]*?(?:property|name)\s*=\s*["'](og:video(?::url|:secure_url)?|og:audio(?::url|:secure_url)?|twitter:player:stream)["'][^>]*>/gi)) {
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (content) add(content[1], m[1].toLowerCase(), true);
  }
  // Links to files
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi)) add(m[1], "link");
  // Bare URLs in inline scripts / JSON with a media extension
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|webm|m4v|mov|mp3|m4a|wav|ogg|oga|opus|flac|m3u8|mpd)(?:\?[^\s"'<>\\]*)?(?=["'\s<\\])/gi)) {
    add(m[0], "page source");
  }
  return { title, candidates: [...found.values()] };
}
