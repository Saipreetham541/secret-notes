// Renders the app icon (same design as client/public/icon.svg) to PNGs for the PWA manifest.
import zlib from 'node:zlib';
import fs from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const inRoundRect = (x, y, rx, ry, w, h, r) => {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const onLine = (x, y, x1, x2, ly) => {
  const cx = Math.min(Math.max(x, x1), x2);
  return (x - cx) ** 2 + (y - ly) ** 2 <= 1.5 ** 2;
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const YELLOW = hex('#f2c14e'), PAPER = hex('#fffaf0'), INK = hex('#c9a14a');

function sample(x, y) { // 64x64 design space
  if (onLine(x, y, 21, 43, 24) || onLine(x, y, 21, 43, 32) || onLine(x, y, 21, 35, 40)) return [...INK, 255];
  if (inRoundRect(x, y, 14, 12, 36, 42, 5)) return [...PAPER, 255];
  if (inRoundRect(x, y, 0, 0, 64, 64, 14)) return [...YELLOW, 255];
  return [0, 0, 0, 0];
}

function render(size) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const s = sample(((px + (sx + 0.5) / SS) / size) * 64, ((py + (sy + 0.5) / SS) / size) * 64);
        acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const a = acc[3];
      raw[o] = a ? acc[0] / a : 0; raw[o + 1] = a ? acc[1] / a : 0; raw[o + 2] = a ? acc[2] / a : 0;
      raw[o + 3] = a / (SS * SS);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) fs.writeFileSync(`client/public/icon-${size}.png`, render(size));
console.log('icons written');
