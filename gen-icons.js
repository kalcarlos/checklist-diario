// Gera os icones do PWA (PNG) sem depender de bibliotecas externas.
// Roda uma vez com: node gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [10, 132, 255]; // azul iOS
const FG = [255, 255, 255];

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  let t = abLen2 === 0 ? 0 : (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function makeIcon(size) {
  const stroke = size * 0.09;
  const p1 = [size * 0.22, size * 0.53];
  const p2 = [size * 0.42, size * 0.74];
  const p3 = [size * 0.80, size * 0.28];
  const radius = size * 0.22; // cantos arredondados

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter type per scanline
    for (let x = 0; x < size; x++) {
      // mascara de cantos arredondados
      let inside = true;
      const corners = [
        [radius, radius], [size - radius, radius],
        [radius, size - radius], [size - radius, size - radius]
      ];
      for (const [cx, cy] of corners) {
        const nearX = x < radius || x > size - radius;
        const nearY = y < radius || y > size - radius;
        if (nearX && nearY) {
          const inCornerBox =
            (x < radius && y < radius) ||
            (x > size - radius && y < radius) ||
            (x < radius && y > size - radius) ||
            (x > size - radius && y > size - radius);
          if (inCornerBox) {
            const ccx = x < radius ? radius : size - radius;
            const ccy = y < radius ? radius : size - radius;
            const d = Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2);
            if (d > radius) inside = false;
          }
        }
      }

      let color;
      if (!inside) {
        color = [0, 0, 0, 0]; // transparente fora do cantos
      } else {
        const d1 = distToSegment(x, y, p1[0], p1[1], p2[0], p2[1]);
        const d2 = distToSegment(x, y, p2[0], p2[1], p3[0], p3[1]);
        const onCheck = Math.min(d1, d2) < stroke / 2;
        color = onCheck ? [...FG, 255] : [...BG, 255];
      }
      raw[offset++] = color[0];
      raw[offset++] = color[1];
      raw[offset++] = color[2];
      raw[offset++] = color[3];
    }
  }

  return encodePNG(size, size, raw);
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rawRGBA) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(rawRGBA, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

for (const [name, size] of sizes) {
  fs.writeFileSync(path.join(outDir, name), makeIcon(size));
  console.log('gerado', name);
}
