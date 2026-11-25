import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

export interface TestServer {
  url: string;
  data: Buffer;
  requests: Array<{ path: string; range?: string }>;
  close(): Promise<void>;
}

/**
 * Test file server.
 *   /range/file.bin      — supports byte ranges
 *   /norange/file.bin    — ignores Range, always 200 full body
 *   /flaky/file.bin      — supports ranges, but the first response for each range is cut short
 *   /short/file.bin      — advertises full Content-Length but always truncates (never completes)
 *   /lying/file.bin      — answers ranges with 200 (claims Accept-Ranges but ignores it)
 *   /status/<code>       — returns that status
 */
export async function startTestServer(size = 5 * 1024 * 1024 + 123): Promise<TestServer> {
  const data = crypto.randomBytes(size);
  const requests: TestServer["requests"] = [];
  let flakyCuts = 0;
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const range = req.headers.range;
    requests.push({ path, range });
    const status = /^\/status\/(\d{3})$/.exec(path);
    if (status) {
      res.writeHead(Number(status[1]));
      return res.end("err");
    }
    const mode = path.split("/")[1];
    const full = () => {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": data.length, ...(mode === "lying" ? { "Accept-Ranges": "bytes" } : {}) });
      res.end(data);
    };
    if (mode === "norange" || mode === "lying" || !range) {
      if (mode === "short") {
        res.writeHead(200, { "Content-Length": data.length });
        res.write(data.subarray(0, 1000));
        return res.destroy();
      }
      return full();
    }
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) return full();
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    if (start >= data.length) {
      res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
      return res.end();
    }
    const slice = data.subarray(start, end + 1);
    res.writeHead(206, {
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${data.length}`,
      "Content-Length": slice.length,
    });
    if (mode === "short" || (mode === "flaky" && flakyCuts < 3 && slice.length > 2000)) {
      if (mode === "flaky") flakyCuts++;
      res.write(slice.subarray(0, Math.floor(slice.length / 3)));
      return setTimeout(() => res.destroy(), 5);
    }
    res.end(slice);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    data,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
