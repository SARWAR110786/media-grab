// Local fixture server for tests and manual QA.
//   node scripts/fixture-server.mjs [port]
// Serves deterministic files with/without Range support, an HTML page with HTML5 media, redirects and errors.
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { zipSync, strToU8 } from "fflate";

function prng(seed, size) {
  // Deterministic pseudo-random bytes (xorshift32).
  const out = Buffer.alloc(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

function withHeader(header, body) {
  return Buffer.concat([Buffer.from(header), body]);
}

function wav(seconds = 2, rate = 8000) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function pdf() {
  const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 18 Tf 40 70 Td (MediaGrab test PDF) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF
`;
  return Buffer.concat([Buffer.from(body), prng(99, 300_000)]); // padded so it is not trivially small
}

export function buildFixtures() {
  return {
    "sample.mp4": { mime: "video/mp4", data: withHeader("\x00\x00\x00\x18ftypmp42", prng(1, 6 * 1024 * 1024 + 4321)) },
    "clip.webm": { mime: "video/webm", data: withHeader("\x1a\x45\xdf\xa3", prng(2, 1_500_000)) },
    "song.mp3": { mime: "audio/mpeg", data: withHeader("ID3\x03\x00", prng(3, 3 * 1024 * 1024 + 77)) },
    "tone.wav": { mime: "audio/wav", data: wav() },
    "document.pdf": { mime: "application/pdf", data: pdf() },
    "archive.zip": {
      mime: "application/zip",
      data: Buffer.from(zipSync({ "readme.txt": strToU8("MediaGrab fixture archive\n"), "data.bin": prng(4, 2_500_000) }, { level: 0 })),
    },
    "big.bin": { mime: "application/octet-stream", data: prng(5, 5 * 1024 * 1024) },
  };
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const PAGE = (base) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture Media Page</title>
<meta property="og:video" content="${base}/files/clip.webm">
</head><body>
<h1>Fixture media page</h1>
<video id="v1" controls width="320" src="/files/sample.mp4"></video>
<video id="v2" controls width="320"><source src="/files/clip.webm" type="video/webm"></video>
<audio id="a1" controls src="/files/tone.wav"></audio>
<audio id="a2" controls><source src="/files/song.mp3" type="audio/mpeg"></audio>
<p><a href="/files/document.pdf">Read the PDF</a> · <a href="/files/archive.zip" download="bundle.zip">Download the ZIP</a> · <a href="/live/master.m3u8">HLS stream</a></p>
<video id="mse" muted></video>
<script>
  // A Media Source Extensions player: its src is a blob: URL that cannot be downloaded.
  try { const ms = new MediaSource(); document.getElementById("mse").src = URL.createObjectURL(ms); } catch (e) {}
</script>
</body></html>`;

const EMPTY_PAGE = `<!doctype html><html><head><title>No media here</title></head><body><p>Just text.</p></body></html>`;

export async function startFixtureServer(port = 0, host = "127.0.0.1") {
  const files = buildFixtures();
  const requests = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const range = req.headers.range;
    requests.push({ path: u.pathname, range, method: req.method, cookie: req.headers.cookie, authorization: req.headers.authorization });
    const base = `http://${req.headers.host}`;

    if (u.pathname === "/page.html") return send(res, 200, { "Content-Type": "text/html; charset=utf-8" }, PAGE(base));
    if (u.pathname === "/empty.html") return send(res, 200, { "Content-Type": "text/html" }, EMPTY_PAGE);
    if (u.pathname === "/live/master.m3u8") return send(res, 200, { "Content-Type": "application/vnd.apple.mpegurl" }, "#EXTM3U\n");
    if (u.pathname === "/redirect") return send(res, 302, { Location: u.searchParams.get("to") ?? "/files/sample.mp4" }, "");
    if (u.pathname === "/redirect-private") return send(res, 302, { Location: "http://10.0.0.1/secret.mp4" }, "");
    if (u.pathname === "/redirect-loop") return send(res, 302, { Location: "/redirect-loop" }, "");
    const st = /^\/status\/(\d{3})$/.exec(u.pathname);
    if (st) return send(res, Number(st[1]), { "Content-Type": "text/plain" }, "error");
    if (u.pathname === "/download") {
      // A file without an extension in the URL; name comes from Content-Disposition.
      const f = files["document.pdf"];
      return send(res, 200, { "Content-Type": "application/octet-stream", "Content-Length": f.data.length, "Content-Disposition": 'attachment; filename="../../Quarterly Report.pdf"' }, f.data);
    }

    const m = /^\/(files|norange|cors|truncate|slow)\/([\w.-]+)$/.exec(u.pathname);
    const f = m && files[m[2]];
    if (!f) return send(res, 404, { "Content-Type": "text/plain" }, "not found");
    const mode = m[1];
    const headers = { "Content-Type": f.mime };
    if (mode === "cors") {
      headers["Access-Control-Allow-Origin"] = "*";
      headers["Access-Control-Expose-Headers"] = "Content-Range, Content-Length, Accept-Ranges";
      if (req.method === "OPTIONS") {
        return send(res, 204, { ...headers, "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Methods": "GET, HEAD" }, "");
      }
    }
    const ranged = mode !== "norange" && mode !== "truncate";
    if (ranged) headers["Accept-Ranges"] = "bytes";
    const rm = range && ranged ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (rm) {
      let start = rm[1] === "" ? f.data.length - Number(rm[2]) : Number(rm[1]);
      let end = rm[1] !== "" && rm[2] !== "" ? Math.min(Number(rm[2]), f.data.length - 1) : f.data.length - 1;
      if (start >= f.data.length || start > end) return send(res, 416, { "Content-Range": `bytes */${f.data.length}` }, "");
      const slice = f.data.subarray(start, end + 1);
      if (mode === "slow" && req.method !== "HEAD") {
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${f.data.length}`, "Content-Length": slice.length });
        return drip(res, slice);
      }
      return send(res, 206, { ...headers, "Content-Range": `bytes ${start}-${end}/${f.data.length}`, "Content-Length": slice.length }, req.method === "HEAD" ? "" : slice);
    }
    if (mode === "truncate") {
      res.writeHead(200, { ...headers, "Content-Length": f.data.length });
      res.write(f.data.subarray(0, 1000));
      return setTimeout(() => res.destroy(), 10);
    }
    send(res, 200, { ...headers, "Content-Length": f.data.length }, req.method === "HEAD" ? "" : f.data);
  });
  await new Promise((r) => server.listen(port, host, r));
  const actual = server.address().port;
  return {
    url: `http://${host}:${actual}`,
    port: actual,
    files,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

// Stream slowly (~400 KB/s per connection) so pause/resume can be exercised.
function drip(res, buf) {
  let o = 0;
  const tick = () => {
    if (res.destroyed) return;
    if (o >= buf.length) return res.end();
    res.write(buf.subarray(o, o + 16 * 1024));
    o += 16 * 1024;
    setTimeout(tick, 40);
  };
  tick();
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] ?? 4100);
  const srv = await startFixtureServer(port);
  console.log(`Fixture server running at ${srv.url}`);
  for (const [name, f] of Object.entries(srv.files)) console.log(`  ${srv.url}/files/${name}  (${f.data.length} bytes, ${f.mime})`);
  console.log(`  ${srv.url}/page.html  (HTML5 video/audio test page)`);
}
