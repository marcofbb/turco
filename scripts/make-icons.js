// Genera los PNG del PWA sin dependencias: rasterizado a mano + encoder PNG con zlib.
// Uso: node scripts/make-icons.js

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ─────────────────────────── encoder PNG ───────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─────────────────────────── geometría ───────────────────────────

/** ¿Está (x,y) dentro de un rect redondeado rotado alrededor de (cx,cy)? */
function inRoundRect(x, y, { cx, cy, w, h, r, angle }) {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = x - cx;
  const dy = y - cy;
  const lx = Math.abs(dx * cos - dy * sin);
  const ly = Math.abs(dx * sin + dy * cos);
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  if (lx <= hw && ly <= h / 2) return true;
  if (ly <= hh && lx <= w / 2) return true;
  const qx = lx - hw;
  const qy = ly - hh;
  return qx > 0 && qy > 0 && qx * qx + qy * qy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRing(x, y, cx, cy, rOuter, rInner) {
  return inCircle(x, y, cx, cy, rOuter) && !inCircle(x, y, cx, cy, rInner);
}

// ─────────────────────────── escena del ícono ───────────────────────────

const FELT_A = [15, 74, 58];
const FELT_B = [6, 33, 26];
const CREAM = [253, 251, 243];
const GOLD = [233, 185, 73];
const GOLD_DARK = [154, 98, 16];

/**
 * Devuelve el color en coordenadas normalizadas 0..1, o null si es transparente.
 * `bleed` = true dibuja el fondo a sangre (para el ícono maskable).
 */
function scene(u, v, bleed) {
  // Fondo
  let bg = null;
  if (bleed) {
    bg = mix(FELT_A, FELT_B, v);
  } else if (inRoundRect(u, v, { cx: 0.5, cy: 0.5, w: 0.94, h: 0.94, r: 0.21, angle: 0 })) {
    bg = mix(FELT_A, FELT_B, v);
  }
  if (!bg) return null;

  // Zona segura del maskable: todo el dibujo vive dentro del 62% central.
  const s = bleed ? 0.72 : 0.92;
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;

  // Carta de atrás (dorada), girada a la izquierda.
  const backCard = { cx: 0.4, cy: 0.52, w: 0.42, h: 0.62, r: 0.06, angle: -0.28 };
  // Carta de adelante (crema), girada a la derecha.
  const frontCard = { cx: 0.58, cy: 0.5, w: 0.42, h: 0.62, r: 0.06, angle: 0.16 };

  if (inRoundRect(x, y, frontCard)) {
    // Moneda de oro sobre la carta de adelante (palo "oro").
    const cos = Math.cos(-frontCard.angle);
    const sin = Math.sin(-frontCard.angle);
    const dx = x - frontCard.cx;
    const dy = y - frontCard.cy;
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (inRing(lx, ly, 0, 0, 0.135, 0.1) || inCircle(lx, ly, 0, 0, 0.045)) return GOLD_DARK;
    return CREAM;
  }

  if (inRoundRect(x, y, backCard)) return GOLD;

  return bg;
}

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function renderIcon(size, bleed) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling 3×3 para bordes suaves
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const c = scene(u, v, bleed);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        const hits = a / 255;
        rgba[i] = Math.round(r / hits);
        rgba[i + 1] = Math.round(g / hits);
        rgba[i + 2] = Math.round(b / hits);
        rgba[i + 3] = Math.round(a / n);
      }
    }
  }
  return encodePng(size, size, rgba);
}

// ─────────────────────────── salida ───────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
];

for (const [name, size, bleed] of targets) {
  const png = renderIcon(size, bleed);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`  ✓ ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
console.log('\nÍconos generados en public/icons/\n');
