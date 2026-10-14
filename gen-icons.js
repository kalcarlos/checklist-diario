// Gera os icones do PWA (PNG) sem depender de bibliotecas externas.
// Roda uma vez com: node gen-icons.js
//
// Desenho: fundo em degrade indigo (mesma cor de acao do app), circulo claro
// com um check indigo dentro (o mesmo simbolo de "feito" da interface), e um
// halo suave. Tudo renderizado com super-amostragem (bordas suaves).
//
// Variantes:
//   - "any"      cantos arredondados, fundo transparente nos cantos (Android/desktop/favicon)
//   - "opaque"   quadrado cheio, sem transparencia (apple-touch-icon: o iOS arredonda
//                sozinho; cantos transparentes viram pretos)
//   - "maskable" quadrado cheio com o desenho dentro da zona segura de 80% (Android
//                adaptativo corta em circulo/squircle)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG_A = [118, 138, 247];   // canto superior esquerdo
const BG_B = [58, 76, 196];     // canto inferior direito
const CIRCLE = [255, 254, 251];
const CHECK = [58, 76, 196];
const SS = 4; // super-amostragem SS x SS por pixel

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  let t = abLen2 === 0 ? 0 : (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

// u, v em [0,1]; devolve [r,g,b,a] (a em 0..1)
function shade(u, v, variant) {
  if (variant === 'any') {
    // retangulo arredondado (raio 22% do lado) via distancia assinada
    const r = 0.22;
    const qx = Math.abs(u - 0.5) - (0.5 - r);
    const qy = Math.abs(v - 0.5) - (0.5 - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (outside > 0) return [0, 0, 0, 0];
  }

  // fundo: degrade diagonal + brilho suave no canto superior esquerdo
  let c = lerp(BG_A, BG_B, (u + v) / 2);
  const glow = Math.max(0, 1 - Math.hypot(u - 0.25, v - 0.2) / 0.65);
  c = lerp(c, [255, 255, 255], glow * 0.16);

  // desenho (reduzido no maskable pra caber na zona segura)
  const k = variant === 'maskable' ? 0.78 : 1;
  const x = (u - 0.5) / k + 0.5;
  const y = (v - 0.5) / k + 0.5;
  const d = Math.hypot(x - 0.5, y - 0.5);

  if (d < 0.345) c = lerp(c, [255, 255, 255], 0.17);     // halo
  if (d < 0.285) c = CIRCLE.slice();                      // circulo
  if (d < 0.285) {
    const stroke = 0.068;
    const p1 = [0.385, 0.505], p2 = [0.47, 0.59], p3 = [0.625, 0.405];
    const dc = Math.min(
      distToSegment(x, y, p1[0], p1[1], p2[0], p2[1]),
      distToSegment(x, y, p2[0], p2[1], p3[0], p3[1])
    );
    if (dc < stroke / 2) c = CHECK.slice();
  }
  return [c[0], c[1], c[2], 1];
}

function makeIcon(size, variant) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let py = 0; py < size; py++) {
    raw[o++] = 0; // filtro da linha
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, variant);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = SS * SS;
      if (a === 0) { raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; continue; }
      raw[o++] = Math.round(r / a);
      raw[o++] = Math.round(g / a);
      raw[o++] = Math.round(b / a);
      raw[o++] = Math.round((a / n) * 255);
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
  ihdr[8] = 8;  // profundidade
  ihdr[9] = 6;  // RGBA
  const idat = zlib.deflateSync(rawRGBA, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['icon-192.png', 192, 'any'],
  ['icon-512.png', 512, 'any'],
  ['icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'opaque'],
  ['favicon-32.png', 32, 'any'],
];

for (const [name, size, variant] of files) {
  fs.writeFileSync(path.join(outDir, name), makeIcon(size, variant));
  console.log('gerado', name, `(${variant})`);
}
