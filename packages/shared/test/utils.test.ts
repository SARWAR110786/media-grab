import { describe, expect, it } from "vitest";
import { sanitizeFilename, filenameFromContentDisposition, resolveFilename, contentDispositionAttachment, ensureExtension } from "../src/filename";
import { parseHttpUrl, isInternalHostname } from "../src/url";
import { isBlockedIp, parseIPv6 } from "../src/ip";
import { classify, extFromUrl, matchProtectedHost } from "../src/media";
import { formatBytes } from "../src/format";

describe("sanitizeFilename", () => {
  it("strips path traversal and directories", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename("..")).toBe("download");
    expect(sanitizeFilename("/")).toBe("download");
  });
  it("removes reserved and control characters", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.mp4')).toBe("a_b_c_d_e_f_g_h.mp4");
    expect(sanitizeFilename("bad\u0000name\u0007.pdf")).toBe("badname.pdf");
    expect(sanitizeFilename("evil‮gpj.exe")).toBe("evilgpj.exe");
  });
  it("handles hidden files, trailing dots and Windows reserved names", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("file.mp4. . ")).toBe("file.mp4");
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("nul.txt")).toBe("_nul.txt");
  });
  it("limits length but keeps extension", () => {
    const out = sanitizeFilename("x".repeat(500) + ".mp4");
    expect(out.endsWith(".mp4")).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(180);
  });
});

describe("content-disposition", () => {
  it("parses filename* and quoted names", () => {
    expect(filenameFromContentDisposition(`attachment; filename*=UTF-8''na%C3%AFve%20file.pdf`)).toBe("naïve file.pdf");
    expect(filenameFromContentDisposition(`attachment; filename="report \\"q1\\".zip"`)).toBe('report "q1".zip');
    expect(filenameFromContentDisposition(`inline; filename=song.mp3`)).toBe("song.mp3");
  });
  it("resolves names from URL and mime", () => {
    expect(resolveFilename({ url: "https://x.com/a/My%20Video.mp4?x=1" })).toBe("My Video.mp4");
    expect(resolveFilename({ url: "https://x.com/download", mime: "application/pdf" })).toBe("download.pdf");
    expect(resolveFilename({ url: "https://x.com/", contentDisposition: 'attachment; filename="../../x.zip"' })).toBe("x.zip");
    expect(ensureExtension("song", "audio/mpeg")).toBe("song.mp3");
  });
  it("builds safe headers", () => {
    const h = contentDispositionAttachment('évil"\r\nX-Injected: 1.mp4');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain("filename*=UTF-8''");
  });
});

describe("parseHttpUrl", () => {
  it("accepts http(s) and bare domains", () => {
    expect(parseHttpUrl("https://example.com/video.mp4").ok).toBe(true);
    const r = parseHttpUrl("example.com/file.zip");
    expect(r.ok && r.url.href).toBe("https://example.com/file.zip");
  });
  it("rejects other protocols, credentials and junk", () => {
    for (const bad of ["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "https://user:pw@example.com/a", "", "not a url", "hello"]) {
      expect(parseHttpUrl(bad).ok, bad).toBe(false);
    }
  });
  it("flags internal hostnames", () => {
    expect(isInternalHostname("localhost")).toBe(true);
    expect(isInternalHostname("api.localhost")).toBe(true);
    expect(isInternalHostname("metadata.google.internal")).toBe(true);
    expect(isInternalHostname("intranet")).toBe(true);
    expect(isInternalHostname("example.com")).toBe(false);
  });
});

describe("isBlockedIp", () => {
  it("blocks private, loopback, link-local and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("blocks internal IPv6 and IPv4-embedded forms", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "[::1]"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
  it("blocks garbage", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(parseIPv6("1::2::3")).toBeNull();
  });
});

describe("classify", () => {
  it("classifies by extension and mime", () => {
    expect(classify("https://a.com/v.mp4").category).toBe("video");
    expect(classify("https://a.com/x", "audio/mpeg").category).toBe("audio");
    expect(classify("https://a.com/x.pdf", "application/octet-stream").label).toBe("PDF");
    expect(classify("https://a.com/master.m3u8").supported).toBe(false);
    expect(classify("https://a.com/x", "application/dash+xml").category).toBe("streaming");
    expect(extFromUrl("https://a.com/path/File.WEBM?x=1#y")).toBe("webm");
  });
  it("recognizes protected streaming sites", () => {
    expect(matchProtectedHost("www.youtube.com")).toBe("youtube.com");
    expect(matchProtectedHost("notyoutube.com")).toBeUndefined();
  });
  it("formats bytes", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(null)).toBe("Unknown size");
  });
});
