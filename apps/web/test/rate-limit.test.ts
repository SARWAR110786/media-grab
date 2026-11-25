import { describe, expect, it } from "vitest";
import { acquireSlot, allowRequest, clientKey } from "@/lib/server/rate-limit";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientKey", () => {
  it("uses the address appended by the nearest proxy, not the client-supplied left end", () => {
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("can't be changed by a spoofed header when one proxy is trusted", () => {
    const a = clientKey(h({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" }));
    const b = clientKey(h({ "x-forwarded-for": "2.2.2.2, 198.51.100.7" }));
    expect(a).toBe(b);
  });

  it("walks further left with more trusted hops", () => {
    expect(clientKey(h({ "x-forwarded-for": "198.51.100.7, 10.0.0.2" }), 2)).toBe("198.51.100.7");
    expect(clientKey(h({ "x-forwarded-for": "198.51.100.7" }), 3)).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip, then a shared bucket", () => {
    expect(clientKey(h({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(clientKey(h({}))).toBe("local");
  });
});

describe("limiters", () => {
  it("allowRequest caps requests per window", () => {
    const key = `t:${Math.random()}`;
    expect([1, 2, 3].map(() => allowRequest(key, 2))).toEqual([true, true, false]);
  });

  it("acquireSlot caps concurrency and releases once", () => {
    const key = `s:${Math.random()}`;
    const r1 = acquireSlot(key, 1);
    expect(r1).not.toBeNull();
    expect(acquireSlot(key, 1)).toBeNull();
    r1!();
    r1!();
    const r2 = acquireSlot(key, 1);
    expect(r2).not.toBeNull();
    expect(acquireSlot(key, 1)).toBeNull();
  });
});
