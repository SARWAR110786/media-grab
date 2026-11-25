// Renders the MediaGrab icon to PNG at several sizes (no image dependencies).
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Geometry in a 32x32 design space (matches the web logo).
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const roundRect = (x, y, r) => {
  const qx = Math.abs(x - 16) - (16 - r), qy = Math.abs(y - 16) - (16 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const SEGS = [[16, 8, 16, 19], [16, 19, 11.5, 14.5], [16, 19, 20.5, 14.5], [10, 23, 22, 23]];

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  const stroke = size <= 16 ? 1.7 : 1.25; // thicker strokes at tiny sizes
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = ((x + (sx + 0.5) / ss) / size) * 32, py = ((y + (sy + 0.5) / ss) / size) * 32;
          if (roundRect(px, py, 9) <= 0) {
            bg++;
            const t = (px + py) / 64; // gradient #8b5cf6 → #5b3fd6
            r += 139 + (91 - 139) * t; g += 92 + (63 - 92) * t; b += 246 + (214 - 246) * t;
            if (Math.min(...SEGS.map((s) => segDist(px, py, ...s))) <= stroke) fg++;
          }
        }
      const n = ss * ss, i = (y * size + x) * 4;
      if (!bg) continue;
      const f = fg / bg;
      out[i] = Math.round((r / bg) * (1 - f) + 255 * f);
      out[i + 1] = Math.round((g / bg) * (1 - f) + 255 * f);
      out[i + 2] = Math.round((b / bg) * (1 - f) + 255 * f);
      out[i + 3] = Math.round((bg / n) * 255);
    }
  return png(size, out);
}

export function writeIcons(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dir, `icon${s}.png`), render(s));
}
