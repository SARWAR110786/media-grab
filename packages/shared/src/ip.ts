/**
 * IP address classification used for SSRF protection. Pure TypeScript so it can be unit tested anywhere.
 * Anything that isn't clearly a public unicast address is treated as blocked.
 */

export function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

const V4_BLOCKED: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local / cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

function v4ToInt(p: number[]): number {
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inV4Range(ip: number[], base: number[], bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
}

export function isBlockedIPv4(ip: string): boolean {
  const p = parseIPv4(ip);
  if (!p) return true;
  return V4_BLOCKED.some(([base, bits]) => inV4Range(p, base, bits));
}

/** Expand an IPv6 address to 8 16-bit groups. Returns null when invalid. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return null;
  // Embedded dotted IPv4 tail.
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    ip = ip.slice(0, lastColon + 1) + (tail.length ? "0:0" : "");
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  const groupsCount = head.length + rest.length;
  if (halves.length === 1 && groupsCount !== 8) return null;
  if (halves.length === 2 && groupsCount > 7) return null;
  const fill = halves.length === 2 ? new Array(8 - groupsCount).fill("0") : [];
  const all = [...head, ...fill, ...rest];
  const out: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  if (tail.length) {
    out[6] = tail[0];
    out[7] = tail[1];
  }
  return out.length === 8 ? out : null;
}

function embeddedV4(g: number[], hiIndex: number): string {
  return [g[hiIndex] >> 8, g[hiIndex] & 0xff, g[hiIndex + 1] >> 8, g[hiIndex + 1] & 0xff].join(".");
}

export function isBlockedIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g, 6));
  if (allZeroUntil(6)) return isBlockedIPv4(embeddedV4(g, 6));
  // IPv4-translated ::ffff:0:a.b.c.d
  if (allZeroUntil(4) && g[4] === 0xffff && g[5] === 0) return isBlockedIPv4(embeddedV4(g, 6));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 ? true : isBlockedIPv4(embeddedV4(g, 6));
  // 6to4 2002::/16 embeds an IPv4 address
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g, 1));
  // Teredo 2001:0::/32
  if (g[0] === 0x2001 && g[1] === 0) return true;
  // Documentation 2001:db8::/32
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  // Discard-only 100::/64
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  const first = g[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // Only 2000::/3 is globally routed unicast.
  if ((first & 0xe000) !== 0x2000) return true;
  return false;
}

/** True when the address is not a public unicast address. Invalid input is blocked. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  if (parseIPv4(clean)) return isBlockedIPv4(clean);
  if (clean.includes(":")) return isBlockedIPv6(clean);
  return true;
}

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return parseIPv4(h) !== null || parseIPv6(h) !== null;
}
