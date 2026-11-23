// news-image-20261122 v13 — "Sunday 22 November 2026" — written from scratch.
// Single-file Node renderer: own TrueType parser + rasterizer, own PNG encoder.
// No network, no Date, no random, no rm. Output: MAKEFUN_OUTPUT_DIR or /output.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const W = 1024, H = 1024;
const CREAM: RGB = [246, 238, 220];
const INK: RGB = [17, 17, 17];
const RED: RGB = [200, 16, 46];
const NAVY: RGB = [11, 16, 32];
const NIGHT: RGB = [27, 42, 74];
const WHITE: RGB = [255, 255, 255];
const YELLOW: RGB = [245, 197, 66];
const ORANGE: RGB = [255, 122, 26];
const GREY: RGB = [90, 84, 72];

type RGB = [number, number, number];

// ---------- deterministic hash (grain) ----------
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177); h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

// ---------- CRC32 ----------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    // choose filter by lowest sum of |signed byte| among None/Up/Paeth
    let bestF = 0, bestS = Infinity;
    const cands: number[][] = [[], [], []];
    for (let f = 0; f < 3; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) {
        let v: number;
        if (f === 0) v = row[i];
        else if (f === 1) v = row[i] - prev[i];
        else v = row[i] - paeth(i >= 3 ? row[i - 3] : 0, prev[i], i >= 3 ? prev[i - 3] : 0);
        const sv = v & 0xff; cands[f].push(sv);
        s += Math.abs(v > 127 ? v - 256 : v);
      }
      if (s < bestS) { bestS = s; bestF = f; }
    }
    const off = y * (stride + 1);
    raw[off] = [0, 2, 4][bestF]; // PNG filter ids: None=0, Up=2, Paeth=4
    for (let i = 0; i < stride; i++) raw[off + 1 + i] = cands[bestF][i];
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas ----------
class Canvas {
  data: Uint8Array;
  clipX = 0; clipY = 0; clipW = W; clipH = H;
  constructor() { this.data = new Uint8Array(W * H * 3); }
  fill(c: RGB) {
    for (let i = 0; i < W * H; i++) { this.data[i * 3] = c[0]; this.data[i * 3 + 1] = c[1]; this.data[i * 3 + 2] = c[2]; }
  }
  setClip(x: number, y: number, w: number, h: number) {
    this.clipX = Math.max(0, Math.floor(x)); this.clipY = Math.max(0, Math.floor(y));
    this.clipW = Math.min(W - this.clipX, Math.floor(w)); this.clipH = Math.min(H - this.clipY, Math.floor(h));
  }
  resetClip() { this.clipX = 0; this.clipY = 0; this.clipW = W; this.clipH = H; }
  px(x: number, y: number, c: RGB, a = 1) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < this.clipX || yi < this.clipY || xi >= this.clipX + this.clipW || yi >= this.clipY + this.clipH) return;
    const i = (yi * W + xi) * 3;
    if (a >= 1) { this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; }
    else {
      this.data[i] = Math.round(this.data[i] * (1 - a) + c[0] * a);
      this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + c[1] * a);
      this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + c[2] * a);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    const x0 = Math.max(this.clipX, Math.floor(x)), y0 = Math.max(this.clipY, Math.floor(y));
    const x1 = Math.min(this.clipX + this.clipW, Math.ceil(x + w)), y1 = Math.min(this.clipY + this.clipH, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c, a);
  }
  hline(x: number, y: number, w: number, c: RGB, t = 1) { this.rect(x, y - (t - 1) / 2, w, t, c); }
  vline(x: number, y: number, h: number, c: RGB, t = 1) { this.rect(x - (t - 1) / 2, y, t, h, c); }
  frame(x: number, y: number, w: number, h: number, c: RGB, t = 1) {
    this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c);
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) this.px(x, y, c, a);
    }
  }
  ring(cx: number, cy: number, r: number, t: number, c: RGB) {
    for (let k = 0; k < t; k++) {
      const rr = r - k * 0.7;
      const steps = Math.max(24, Math.floor(rr * 6));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        this.px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, c);
      }
    }
  }
  // thick line as quad
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * t / 2, ny = (dx / len) * t / 2;
    this.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c);
    if (t > 1) { this.circle(x0, y0, t / 2, c); this.circle(x1, y1, t / 2, c); }
  }
  poly(pts: number[][], c: RGB, a = 1) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const y0 = Math.max(this.clipY, Math.floor(minY)), y1 = Math.min(this.clipY + this.clipH - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) {
          xs.push(p[0] + (yc - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(this.clipX, Math.ceil(xs[k])), xb = Math.min(this.clipX + this.clipW - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.px(x, y, c, a);
      }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) {
    const steps = Math.max(24, Math.floor((rx + ry) * 3));
    const pts: number[][] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    this.poly(pts, c, a);
  }
  // starburst (flame / explosion): n spikes alternating radii
  burst(cx: number, cy: number, r: number, c: RGB, spikes = 8, seed = 0) {
    const pts: number[][] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = (i % 2 === 0) ? r : r * (0.35 + 0.3 * hash2(i, seed));
      pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
    }
    this.poly(pts, c);
  }
  // light grain over a region
  grain(x: number, y: number, w: number, h: number, amt = 0.05) {
    for (let yy = Math.floor(y); yy < y + h; yy += 2) {
      for (let xx = Math.floor(x); xx < x + w; xx += 2) {
        const v = hash2(xx, yy);
        if (v < amt) this.px(xx, yy, v < amt / 2 ? [0, 0, 0] : [255, 255, 255], 0.10);
      }
    }
  }
}

// ---------- TrueType font ----------
class Font {
  buf: Buffer;
  upm: number; numGlyphs: number;
  cmap4: { start: number; end: number; delta: number; ro: number }[] = [];
  cmap12: { start: number; end: number; startGlyph: number }[] = [];
  glyphOff: number[] = [];
  glyfOff = 0; locaFmt = 0;
  advances: number[] = [];
  asc = 0; desc = 0;
  constructor(path: string) {
    this.buf = readFileSync(path);
    const b = this.buf;
    const u16 = (o: number) => b.readUInt16BE(o);
    const u32 = (o: number) => b.readUInt32BE(o);
    const numTables = u16(4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      tables[b.toString("ascii", o, o + 4)] = u32(o + 8);
    }
    const head = tables["head"], maxp = tables["maxp"], hhea = tables["hhea"],
      hmtx = tables["hmtx"], cmap = tables["cmap"], loca = tables["loca"], glyf = tables["glyf"];
    if (head === undefined || !maxp || !hhea || !hmtx || !cmap || loca === undefined || glyf === undefined)
      throw new Error("missing table in " + path);
    this.upm = u16(head + 18);
    this.locaFmt = b.readInt16BE(head + 50);
    this.numGlyphs = u16(maxp + 4);
    this.asc = b.readInt16BE(hhea + 4); this.desc = b.readInt16BE(hhea + 6);
    const numH = u16(hhea + 34);
    for (let i = 0; i < numH; i++) this.advances.push(u16(hmtx + i * 4));
    for (let i = numH; i < this.numGlyphs; i++) this.advances.push(this.advances[numH - 1] || this.upm);
    // loca
    this.glyfOff = glyf;
    for (let i = 0; i <= this.numGlyphs; i++) {
      this.glyphOff.push(this.locaFmt === 1 ? u32(loca + i * 4) : u16(loca + i * 2) * 2);
    }
    // cmap: prefer format 12, else 4
    const nSub = u16(cmap + 2);
    for (let i = 0; i < nSub; i++) {
      const so = cmap + 4 + i * 8;
      const fmt = u16(cmap + u32(so + 4));
      const sub = cmap + u32(so + 4);
      if (fmt === 12) {
        const n = u32(sub + 12);
        for (let g = 0; g < n; g++) {
          const go = sub + 16 + g * 12;
          this.cmap12.push({ start: u32(go), end: u32(go + 4), startGlyph: u32(go + 8) });
        }
      } else if (fmt === 4 && this.cmap12.length === 0) {
        const segCount = u16(sub + 6) / 2;
        const endOff = sub + 14, startOff = endOff + segCount * 2 + 2, deltaOff = startOff + segCount * 2, roOff = deltaOff + segCount * 2;
        for (let s = 0; s < segCount; s++) {
          this.cmap4.push({
            start: u16(startOff + s * 2), end: u16(endOff + s * 2),
            delta: b.readInt16BE(deltaOff + s * 2), ro: u16(roOff + s * 2),
          });
        }
        // store glyphIdArray base for rangeOffset lookups
        (this as unknown as { roBase: number }).roBase = roOff;
      }
    }
    if (this.cmap12.length === 0 && this.cmap4.length === 0) throw new Error("no cmap in " + path);
  }
  gid(cp: number): number {
    if (this.cmap12.length) {
      for (const g of this.cmap12) if (cp >= g.start && cp <= g.end) return g.startGlyph + (cp - g.start);
      return 0;
    }
    for (let s = 0; s < this.cmap4.length; s++) {
      const seg = this.cmap4[s];
      if (cp >= seg.start && cp <= seg.end) {
        if (seg.ro === 0) return (cp + seg.delta) & 0xffff;
        const roBase = (this as unknown as { roBase: number }).roBase;
        const idxOff = roBase + s * 2 + seg.ro + (cp - seg.start) * 2;
        const g = this.buf.readUInt16BE(idxOff);
        return g === 0 ? 0 : (g + seg.delta) & 0xffff;
      }
    }
    return 0;
  }
  advance(gid: number): number { return this.advances[gid] ?? this.upm; }
  // outline -> array of contours; each contour is array of {x,y,on}
  outline(gid: number): { x: number; y: number; on: boolean }[][] {
    const b = this.buf;
    const o0 = this.glyphOff[gid], o1 = this.glyphOff[gid + 1];
    if (o0 === o1 || gid >= this.numGlyphs) return [];
    const go = this.glyfOff + o0;
    const nCont = b.readInt16BE(go);
    if (nCont < 0) return this.composite(go);
    const endPts: number[] = [];
    for (let i = 0; i < nCont; i++) endPts.push(b.readUInt16BE(go + 10 + i * 2));
    const insLen = b.readUInt16BE(go + 10 + nCont * 2);
    let p = go + 12 + nCont * 2 + insLen;
    const nPts = endPts.length ? endPts[endPts.length - 1] + 1 : 0;
    const flags: number[] = [];
    while (flags.length < nPts) {
      const f = b[p++];
      flags.push(f);
      if (f & 8) { const rep = b[p++]; for (let r = 0; r < rep; r++) flags.push(f); }
    }
    const xs: number[] = []; let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 2) { const d = b[p++]; x += (f & 16) ? d : -d; }
      else if (!(f & 16)) { x += b.readInt16BE(p); p += 2; }
      xs.push(x);
    }
    const ys: number[] = []; let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 4) { const d = b[p++]; y += (f & 32) ? d : -d; }
      else if (!(f & 32)) { y += b.readInt16BE(p); p += 2; }
      ys.push(y);
    }
    const contours: { x: number; y: number; on: boolean }[][] = [];
    let start = 0;
    for (const end of endPts) {
      const c: { x: number; y: number; on: boolean }[] = [];
      for (let i = start; i <= end; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      contours.push(c); start = end + 1;
    }
    return contours;
  }
  composite(go: number): { x: number; y: number; on: boolean }[][] {
    const b = this.buf;
    let p = go + 10;
    const out: { x: number; y: number; on: boolean }[][] = [];
    for (;;) {
      const flags = b.readUInt16BE(p); const cg = b.readUInt16BE(p + 2); p += 4;
      let dx = 0, dy = 0, sx = 1, sy = 1;
      if (flags & 1) { dx = b.readInt16BE(p); dy = b.readInt16BE(p + 2); p += 4; }
      else { dx = b[p]; dy = b[p + 1]; p += 2; }
      if (flags & 8) { sx = b.readInt16BE(p) / 16384; sy = sx; p += 2; }
      else if (flags & 64) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 2) / 16384; p += 4; }
      else if (flags & 128) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 2) / 16384; p += 8; }
      for (const c of this.outline(cg)) {
        out.push(c.map((pt) => ({ x: pt.x * sx + dx, y: pt.y * sy + dy, on: pt.on })));
      }
      if (!(flags & 32)) break;
    }
    return out;
  }
}

type Seg = { x0: number; y0: number; x1: number; y1: number; dir: number };
function flatten(contours: { x: number; y: number; on: boolean }[][], scale: number): Seg[] {
  const segs: Seg[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => {
    if (ay === by) return;
    segs.push({ x0: ax * scale, y0: -ay * scale, x1: bx * scale, y1: -by * scale, dir: by > ay ? 1 : -1 });
  };
  for (const c of contours) {
    if (c.length < 2) continue;
    // build point list starting at an on-curve point
    let pts = c;
    if (!c[0].on) {
      const si = c.findIndex((p) => p.on);
      if (si < 0) { pts = c; } else pts = [...c.slice(si), ...c.slice(0, si)];
    }
    const n = pts.length;
    const get = (i: number) => pts[((i % n) + n) % n];
    let cur = get(0);
    let i = 1;
    while (i <= n) {
      const p = get(i);
      if (p.on) { add(cur.x, cur.y, p.x, p.y); cur = p; i++; }
      else {
        const nxt = get(i + 1);
        const mx = (p.x + nxt.x) / 2, my = (p.y + nxt.y) / 2;
        // quadratic bezier cur -> p -> mid, 6 steps
        let px = cur.x, py = cur.y;
        for (let s = 1; s <= 6; s++) {
          const t = s / 6, u = 1 - t;
          const qx = u * u * cur.x + 2 * u * t * p.x + t * t * mx;
          const qy = u * u * cur.y + 2 * u * t * p.y + t * t * my;
          add(px, py, qx, qy); px = qx; py = qy;
        }
        cur = { x: mx, y: my, on: true };
        i += 2;
        if (i > n) break;
      }
    }
  }
  return segs;
}

type GlyphBmp = { w: number; h: number; left: number; top: number; a: Uint8Array };
const glyphCache = new Map<string, GlyphBmp>();
function rasterGlyph(font: Font, size: number, gid: number): GlyphBmp {
  const key = `${(font as unknown as { buf: Buffer }).buf.length}:${size}:${gid}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const scale = size / font.upm;
  const contours = font.outline(gid);
  if (contours.length === 0) {
    const adv = Math.ceil(font.advance(gid) * scale);
    const empty: GlyphBmp = { w: Math.max(adv, 1), h: 1, left: 0, top: 0, a: new Uint8Array(Math.max(adv, 1)) };
    glyphCache.set(key, empty); return empty;
  }
  const segs = flatten(contours, scale);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x0, s.x1); maxX = Math.max(maxX, s.x0, s.x1);
    minY = Math.min(minY, s.y0, s.y1); maxY = Math.max(maxY, s.y0, s.y1);
  }
  const SS = 2;
  const left = Math.floor(minX), top = Math.floor(minY);
  const w = Math.max(1, Math.ceil(maxX) - left), h = Math.max(1, Math.ceil(maxY) - top);
  const sup = new Float32Array(w * SS * h * SS);
  for (let sy = 0; sy < h * SS; sy++) {
    const yc = top + (sy + 0.5) / SS;
    const xs: { x: number; dir: number }[] = [];
    for (const s of segs) {
      if ((s.y0 <= yc && s.y1 > yc) || (s.y1 <= yc && s.y0 > yc)) {
        xs.push({ x: s.x0 + (yc - s.y0) * (s.x1 - s.x0) / (s.y1 - s.y0), dir: s.dir });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length; k++) {
      const nx = k + 1 < xs.length ? xs[k + 1].x : xs[k].x;
      wind += xs[k].dir;
      if (wind !== 0) {
        const xa = Math.max(0, Math.floor((xs[k].x - left) * SS));
        const xb = Math.min(w * SS, Math.ceil((nx - left) * SS));
        for (let xx = xa; xx < xb; xx++) sup[sy * w * SS + xx] = 1;
      }
    }
  }
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += sup[(y * SS + dy) * w * SS + x * SS + dx];
    a[y * w + x] = Math.round((s / (SS * SS)) * 255);
  }
  const bmp: GlyphBmp = { w, h, left, top, a };
  glyphCache.set(key, bmp);
  return bmp;
}

// ---------- text ----------
const cv = new Canvas();
let FONTS: Record<string, Font> = {};
function loadFonts(dir: string) {
  const names = ["PlayfairDisplay-Black", "PlayfairDisplay-Bold", "PlayfairDisplay-ExtraBold",
    "BarlowCondensed-Regular", "BarlowCondensed-Medium", "BarlowCondensed-SemiBold", "BarlowCondensed-Bold"];
  for (const n of names) {
    const f = new Font(join(dir, n + ".ttf"));
    if (f.numGlyphs < 100) throw new Error("font unusable: " + n);
    FONTS[n] = f;
  }
  BARLOW = [FONTS["BarlowCondensed-Regular"]];
  BARLOW_M = [FONTS["BarlowCondensed-Medium"]];
  BARLOW_SB = [FONTS["BarlowCondensed-SemiBold"]];
  BARLOW_B = [FONTS["BarlowCondensed-Bold"]];
  PLAY_BLACK = [FONTS["PlayfairDisplay-Black"]];
  PLAY_BOLD = [FONTS["PlayfairDisplay-Bold"]];
  PLAY_XB = [FONTS["PlayfairDisplay-ExtraBold"]];
}
function pickFont(chain: Font[], cp: number): Font {
  for (const f of chain) if (f.gid(cp) !== 0) return f;
  return chain[0];
}
function textWidth(s: string, size: number, chain: Font[], track = 0): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    const f = pickFont(chain, cp);
    w += f.advance(f.gid(cp)) * (size / f.upm) + track;
  }
  return w - (s.length ? track : 0);
}
function drawText(x: number, y: number, s: string, size: number, chain: Font[], color: RGB, align: "l" | "c" | "r" = "l", track = 0) {
  // y = baseline
  let w = textWidth(s, size, chain, track);
  let cx = align === "c" ? x - w / 2 : align === "r" ? x - w : x;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    const f = pickFont(chain, cp);
    const gid = f.gid(cp);
    const bmp = rasterGlyph(f, size, gid);
    const bx = Math.round(cx + bmp.left), by = Math.round(y + bmp.top);
    for (let yy = 0; yy < bmp.h; yy++) {
      for (let xx = 0; xx < bmp.w; xx++) {
        const av = bmp.a[yy * bmp.w + xx];
        if (av) cv.px(bx + xx, by + yy, color, av / 255);
      }
    }
    cx += f.advance(gid) * (size / f.upm) + track;
  }
}
function wrapText(s: string, maxW: number, size: number, chain: Font[], track = 0): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const test = cur ? cur + " " + wd : wd;
    if (textWidth(test, size, chain, track) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// draw wrapped text, returns lines used; shrinks size until it fits maxLines
function drawPara(x: number, y: number, s: string, maxW: number, size: number, chain: Font[], color: RGB, maxLines: number, lh: number): number {
  let sz = size, lines = wrapText(s, maxW, sz, chain);
  while (lines.length > maxLines && sz > 7) { sz -= 0.5; lines = wrapText(s, maxW, sz, chain); }
  lines = lines.slice(0, maxLines);
  lines.forEach((ln, i) => drawText(x, y + i * lh, ln, sz, chain, color));
  return lines.length;
}
function fitSize(s: string, maxW: number, size: number, chain: Font[]): number {
  let sz = size;
  while (sz > 6 && textWidth(s, sz, chain) > maxW) sz -= 0.5;
  return sz;
}

// ---------- scene helpers ----------
// window grid on a dark building
function windows(x: number, y: number, cols: number, rows: number, cw: number, ch: number, gx: number, gy: number, lit: RGB, dark: RGB, litProb: number, seed: number) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const wx = x + c * (cw + gx), wy = y + r * (ch + gy);
    cv.rect(wx, wy, cw, ch, hash2(c * 7 + seed, r * 13 + seed) < litProb ? lit : dark);
  }
}
function smoke(x: number, y: number, n: number, c: RGB, seed: number) {
  for (let i = 0; i < n; i++) {
    const r = 3 + hash2(i, seed) * 6;
    cv.circle(x + (hash2(i * 3, seed) - 0.5) * 26 - i * 1.5, y - i * 4, r, c, 0.55);
  }
}
function flame(x: number, y: number, s: number) {
  cv.burst(x, y, s, ORANGE, 7, 3);
  cv.burst(x, y, s * 0.62, YELLOW, 6, 5);
  cv.circle(x, y, s * 0.28, [255, 240, 180]);
}
function stars(x: number, y: number, w: number, h: number, n: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const sx = x + hash2(i * 11, seed) * w, sy = y + hash2(i * 17, seed + 1) * h;
    cv.rect(sx, sy, 1.4, 1.4, [255, 244, 200]);
  }
}
function person(x: number, y: number, s: number, suit: RGB, skin: RGB) {
  cv.circle(x, y - s * 0.85, s * 0.22, skin);
  cv.poly([[x - s * 0.28, y], [x + s * 0.28, y], [x + s * 0.18, y - s * 0.62], [x - s * 0.18, y - s * 0.62]], suit);
}
function flagPole(x: number, y: number, h: number, w: number, stripes: RGB[]) {
  cv.vline(x, y - h, h, [220, 220, 210], 1.4);
  const sh = 7;
  stripes.forEach((c, i) => cv.rect(x + 1, y - h + i * (sh / stripes.length), w, sh / stripes.length + 0.6, c));
}

// ---------- LEAD scenes (216 x 96) ----------
function sceneCOP31(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [35, 43, 66]); // night hall
  stars(x, y, w, 34, 14, 7);
  cv.rect(x, y + 34, w, h - 34, [46, 38, 34]); // warm wall
  // tall windows with dusk glow
  cv.rect(x + 8, y + 6, 26, 30, [214, 158, 90]); cv.frame(x + 8, y + 6, 26, 30, [20, 20, 26], 2);
  cv.rect(x + w - 34, y + 6, 26, 30, [214, 158, 90]); cv.frame(x + w - 34, y + 6, 26, 30, [20, 20, 26], 2);
  // globe on stand
  cv.circle(x + w - 22, y + 52, 9, [62, 122, 107]);
  cv.circle(x + w - 25, y + 50, 3, [120, 170, 110]); cv.circle(x + w - 19, y + 55, 2.4, [120, 170, 110]);
  cv.rect(x + w - 24, y + 61, 4, 6, [90, 70, 40]);
  // clock
  cv.circle(x + 22, y + 52, 8, [240, 232, 210]); cv.ring(x + 22, y + 52, 8, 2, INK);
  cv.line(x + 22, y + 52, x + 22, y + 46, INK, 1.4); cv.line(x + 22, y + 52, x + 27, y + 54, INK, 1.4);
  // long table
  cv.rect(x + 6, y + 66, w - 12, 10, [107, 74, 47]);
  cv.rect(x + 6, y + 66, w - 12, 2, [140, 100, 60]);
  // 5 delegates behind table
  const suits: RGB[] = [[74, 85, 104], [91, 74, 58], [63, 74, 58], [107, 58, 58], [47, 58, 74]];
  for (let i = 0; i < 5; i++) {
    const dx = x + 30 + i * 38;
    person(dx, y + 66, 15, suits[i], [214, 178, 140]);
    // papers + warm lamp dots on table
    cv.rect(dx - 8, y + 68, 12, 3, [240, 232, 210]);
  }
  cv.circle(x + 108, y + 64, 3, YELLOW); cv.circle(x + 150, y + 64, 3, YELLOW);
  // NO DEAL sign — big red banner above table
  cv.rect(x + 58, y + 40, 100, 20, RED);
  drawText(x + 108, y + 55, "NO DEAL", 15, [FONTS["BarlowCondensed-Bold"]], WHITE, "c", 0.5);
  cv.rect(x, y + h - 4, w, 4, [20, 24, 38]);
}
function sceneDymer(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [18, 26, 50]); // night sky
  stars(x, y, w, 40, 18, 11);
  cv.circle(x + w - 24, y + 16, 9, [240, 232, 200]); // moon
  // drone silhouette with red lights
  const dx = x + 150, dy = y + 18;
  cv.ellipse(dx, dy, 12, 3, [8, 10, 16]);
  cv.line(dx - 16, dy - 2, dx + 16, dy - 2, [8, 10, 16], 2);
  cv.circle(dx - 14, dy - 3, 1.8, RED); cv.circle(dx + 14, dy - 3, 1.8, RED);
  cv.line(dx, dy + 2, dx + 6, y + 34, [255, 210, 90], 1); // faint beam hint
  // apartment block, dark, lit windows
  cv.rect(x + 10, y + 22, 96, h - 22, [38, 42, 58]);
  cv.rect(x + 10, y + 22, 96, 3, [52, 56, 74]);
  windows(x + 16, y + 30, 6, 4, 8, 7, 6, 6, YELLOW, [24, 28, 42], 0.55, 21);
  // collapsed right section: jagged rubble
  cv.poly([[x + 106, y + 40], [x + 128, y + 30], [x + 150, y + 44], [x + 162, y + 58], [x + 150, y + h], [x + 106, y + h]], [58, 60, 72]);
  cv.poly([[x + 112, y + 62], [x + 126, y + 52], [x + 140, y + 64], [x + 134, y + 78], [x + 118, y + 78]], [40, 42, 52]);
  smoke(x + 130, y + 40, 4, [140, 140, 150], 31);
  // rubble pile + red ladder + rescuers
  cv.poly([[x + 100, y + h], [x + 130, y + 76], [x + 158, y + 84], [x + 176, y + h]], [70, 66, 60]);
  cv.line(x + 116, y + h, x + 136, y + 58, RED, 3);
  cv.line(x + 122, y + h, x + 142, y + 58, RED, 3);
  for (let r = 0; r < 5; r++) cv.line(x + 119 + r * 4, y + h - 4 - r * 8, x + 125 + r * 4, y + h - 4 - r * 8, RED, 1.4);
  person(x + 168, y + h, 13, [180, 60, 50], [214, 178, 140]);
  person(x + 188, y + h, 13, [60, 90, 140], [200, 165, 130]);
  cv.circle(x + 178, y + h - 14, 2.5, YELLOW); // torch light
  cv.rect(x, y + h - 3, w, 3, [12, 16, 28]);
}
function sceneBahrain(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [16, 24, 46]); // night
  stars(x, y, w, 30, 12, 17);
  cv.circle(x + w - 20, y + 14, 7, [240, 232, 200]);
  // radar dish 1 (large) + dish 2
  const dish = (cx: number, cy: number, s: number) => {
    cv.line(cx, cy, cx - 4, y + h - 8, [200, 200, 195], 3);
    cv.line(cx, cy, cx + 6, y + h - 8, [200, 200, 195], 3);
    cv.ellipse(cx, cy, s, s * 0.42, [225, 225, 218]);
    cv.ellipse(cx, cy - 2, s * 0.7, s * 0.3, [180, 180, 175]);
    cv.circle(cx, cy, 3, [120, 120, 118]);
  };
  dish(x + 52, y + 52, 26); dish(x + 150, y + 60, 18);
  // bright missile trails + explosions
  cv.line(x + 120, y + 8, x + 60, y + 48, YELLOW, 2.5);
  cv.line(x + 170, y + 4, x + 148, y + 52, YELLOW, 2);
  flame(x + 58, y + 44, 13); flame(x + 152, y + 50, 10);
  smoke(x + 60, y + 34, 3, [120, 120, 130], 41);
  // base buildings + fence + fire at industrial site
  cv.rect(x, y + h - 22, w, 22, [30, 34, 48]);
  windows(x + 8, y + h - 18, 8, 1, 7, 6, 5, 0, YELLOW, [24, 28, 42], 0.6, 51);
  flame(x + w - 30, y + h - 16, 9);
  cv.rect(x, y + h - 26, w, 2, [90, 90, 95]);
  cv.rect(x, y + h - 3, w, 3, [10, 12, 22]);
}

// ---------- GRID scenes (161 x 56) ----------
function sceneSparta(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, NIGHT);
  cv.rect(x, y + h - 16, w, 16, [24, 48, 66]); // sea
  cv.line(x, y + h - 16, x + w, y + h - 16, [120, 160, 190], 1);
  // cargo ship silhouette
  cv.poly([[x + 18, y + h - 16], [x + 130, y + h - 16], [x + 122, y + h - 6], [x + 26, y + h - 6]], [30, 32, 40]);
  cv.rect(x + 30, y + h - 30, 60, 14, [52, 56, 70]);
  cv.rect(x + 96, y + h - 34, 10, 18, [52, 56, 70]);
  windows(x + 34, y + h - 28, 5, 1, 5, 4, 4, 0, YELLOW, [24, 28, 42], 0.4, 61);
  flame(x + 78, y + h - 30, 11); flame(x + 108, y + h - 26, 8);
  smoke(x + 80, y + h - 44, 4, [130, 130, 140], 71);
  // drone
  cv.ellipse(x + 140, y + 10, 7, 2, [10, 12, 18]); cv.circle(x + 134, y + 9, 1.4, RED);
}
function scenePeru(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [196, 178, 140]); // dusk sky
  cv.poly([[x, y + h], [x + 40, y + 12], [x + 80, y + h]], [107, 122, 74]);
  cv.poly([[x + 55, y + h], [x + 105, y + 6], [x + 155, y + h]], [88, 102, 60]);
  cv.poly([[x + 32, y + 20], [x + 40, y + 12], [x + 48, y + 20]], [240, 232, 210]);
  cv.poly([[x + 97, y + 14], [x + 105, y + 6], [x + 113, y + 14]], [240, 232, 210]);
  // shaking building + cracks + fleeing people
  cv.rect(x + 18, y + h - 26, 34, 26, [150, 128, 96]);
  cv.line(x + 26, y + h - 26, x + 32, y + h - 12, [60, 40, 30], 1.6);
  cv.line(x + 32, y + h - 12, x + 28, y + h - 2, [60, 40, 30], 1.6);
  windows(x + 22, y + h - 22, 2, 2, 6, 5, 5, 4, YELLOW, [70, 60, 48], 0.5, 81);
  person(x + 70, y + h, 10, [120, 50, 40], [214, 178, 140]);
  person(x + 88, y + h, 10, [50, 80, 110], [200, 165, 130]);
  person(x + 106, y + h, 10, [90, 90, 70], [214, 178, 140]);
  cv.rect(x, y + h - 3, w, 3, [90, 82, 60]);
}
function sceneJerusalem(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [232, 214, 176]); // warm stone
  cv.rect(x, y + h - 20, w, 20, [200, 178, 138]);
  // domed building
  cv.rect(x + 45, y + 22, 70, h - 22, [214, 190, 148]);
  cv.ellipse(x + 80, y + 24, 22, 12, [190, 150, 80]);
  cv.rect(x + 78, y + 10, 4, 8, [190, 150, 80]);
  for (let i = 0; i < 4; i++) cv.rect(x + 50 + i * 16, y + 34, 6, h - 34, [190, 168, 122]);
  cv.rect(x + 45, y + 22, 70, 3, [170, 130, 70]);
  flagPole(x + 20, y + 20, 26, 14, [WHITE, [0, 40, 120], WHITE]);
  flagPole(x + 138, y + 20, 26, 14, [WHITE, [0, 40, 120], WHITE]);
  // podium + figure
  cv.rect(x + 118, y + h - 16, 18, 16, [120, 90, 60]);
  person(x + 127, y + h - 16, 11, [40, 44, 60], [214, 178, 140]);
}
function sceneKryvyi(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [20, 28, 52]); // night
  stars(x, y, w, 22, 8, 91);
  // missile streak, bright
  cv.line(x + 150, y + 4, x + 96, y + 30, ORANGE, 3);
  cv.line(x + 150, y + 4, x + 96, y + 30, YELLOW, 1.4);
  flame(x + 94, y + 32, 12);
  // damaged hospital block
  cv.rect(x + 14, y + 16, 64, h - 16, [44, 48, 64]);
  windows(x + 20, y + 22, 4, 3, 7, 6, 6, 5, YELLOW, [26, 30, 44], 0.5, 101);
  cv.poly([[x + 46, y + 16], [x + 62, y + 26], [x + 58, y + 38], [x + 44, y + 34]], [18, 20, 30]); // blast hole
  smoke(x + 56, y + 14, 4, [140, 140, 150], 111);
  // rubble + ambulance with lights
  cv.poly([[x + 78, y + h], [x + 100, y + h - 14], [x + 122, y + h - 6], [x + 130, y + h]], [66, 62, 56]);
  cv.rect(x + 118, y + h - 14, 30, 12, [240, 240, 235]);
  cv.rect(x + 118, y + h - 14, 30, 3, RED);
  cv.circle(x + 124, y + h - 2, 2.4, INK); cv.circle(x + 142, y + h - 2, 2.4, INK);
  cv.circle(x + 133, y + h - 16, 3, YELLOW); cv.circle(x + 133, y + h - 16, 1.4, RED);
  person(x + 92, y + h, 10, [180, 60, 50], [214, 178, 140]);
  cv.rect(x, y + h - 3, w, 3, [12, 16, 28]);
}
function sceneMexico(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [214, 164, 110]); // desert dusk
  cv.circle(x + w - 22, y + 14, 10, [240, 190, 110]);
  cv.poly([[x, y + h], [x + 30, y + 26], [x + 60, y + h]], [150, 110, 70]);
  // cactus
  cv.rect(x + 8, y + h - 26, 4, 26, [70, 110, 60]);
  cv.rect(x + 2, y + h - 18, 4, 8, [70, 110, 60]); cv.rect(x + 2, y + h - 12, 8, 3, [70, 110, 60]);
  // road + police cars
  cv.rect(x, y + h - 14, w, 14, [60, 58, 56]);
  cv.line(x, y + h - 7, x + w, y + h - 7, [220, 200, 120], 1.4);
  const car = (cx: number) => {
    cv.rect(cx, y + h - 26, 34, 12, [30, 34, 44]);
    cv.rect(cx + 6, y + h - 32, 20, 7, [40, 46, 60]);
    cv.circle(cx + 8, y + h - 13, 3, INK); cv.circle(cx + 26, y + h - 13, 3, INK);
    cv.rect(cx + 14, y + h - 34, 6, 3, RED); cv.rect(cx + 20, y + h - 34, 6, 3, [40, 120, 220]);
  };
  car(x + 40); car(x + 92);
  person(x + 140, y + h - 12, 11, [90, 60, 40], [200, 165, 130]);
}
function sceneHongKong(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [24, 40, 62]); // dusk skyline
  cv.circle(x + 20, y + 12, 7, [240, 200, 120]);
  const bgs: RGB[] = [[40, 58, 84], [52, 66, 92], [36, 52, 78], [58, 72, 96]];
  for (let i = 0; i < 4; i++) {
    const bx = x + 8 + i * 38, bh = 26 + ((i * 13) % 14);
    cv.rect(bx, y + h - bh, 30, bh, bgs[i]);
    windows(bx + 4, y + h - bh + 4, 3, 3, 4, 4, 4, 4, YELLOW, [22, 30, 48], 0.5, 121 + i);
  }
  // ballot box with big check
  cv.rect(x + 108, y + h - 30, 34, 24, RED);
  cv.rect(x + 104, y + h - 34, 42, 5, [150, 10, 30]);
  cv.line(x + 114, y + h - 20, x + 122, y + h - 12, WHITE, 3);
  cv.line(x + 122, y + h - 12, x + 136, y + h - 26, WHITE, 3);
  cv.rect(x, y + h - 3, w, 3, [14, 22, 36]);
}
function sceneHormuz(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [16, 42, 52]); // night sea
  cv.rect(x, y + h - 18, w, 18, [20, 58, 66]);
  cv.line(x, y + h - 18, x + w, y + h - 18, [140, 190, 200], 1);
  // two tankers, both ablaze
  const tanker = (tx: number, tw: number) => {
    cv.poly([[tx, y + h - 18], [tx + tw, y + h - 18], [tx + tw - 8, y + h - 8], [tx + 8, y + h - 8]], [34, 36, 44]);
    cv.rect(tx + 8, y + h - 30, tw - 24, 12, [58, 60, 72]);
    flame(tx + tw / 2 - 6, y + h - 32, 10); flame(tx + tw / 2 + 14, y + h - 28, 7);
    smoke(tx + tw / 2, y + h - 44, 3, [130, 130, 140], 131);
  };
  tanker(x + 8, 66); tanker(x + 84, 66);
  // lifeboat + waves
  cv.ellipse(x + 78, y + h - 6, 10, 3, [220, 120, 40]);
  person(x + 78, y + h - 8, 8, [220, 120, 40], [214, 178, 140]);
  cv.line(x + 10, y + h - 4, x + 40, y + h - 4, [140, 190, 200], 1);
}
function sceneMQ1(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [14, 22, 44]); // night sky
  stars(x, y, w, 26, 10, 141);
  cv.circle(x + 18, y + 12, 6, [230, 222, 200]);
  // MQ-1 drone silhouette, large
  cv.ellipse(x + 86, y + 22, 26, 4, [190, 190, 185]);
  cv.rect(x + 82, y + 20, 8, 5, [160, 160, 155]);
  cv.line(x + 62, y + 22, x + 62, y + 12, [160, 160, 155], 2);
  cv.line(x + 110, y + 22, x + 110, y + 12, [160, 160, 155], 2);
  cv.circle(x + 86, y + 22, 2, RED);
  // missile trail + bright explosion
  cv.line(x + 150, y + 4, x + 108, y + 20, YELLOW, 2.5);
  flame(x + 104, y + 22, 11);
  smoke(x + 104, y + 12, 3, [130, 130, 140], 151);
  // sea below
  cv.rect(x, y + h - 12, w, 12, [18, 48, 58]);
  cv.line(x, y + h - 12, x + w, y + h - 12, [140, 190, 200], 1);
}
function sceneBrussels(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [200, 208, 216]); // pale sky
  // Berlaymont: grey-blue slab + star circle
  cv.rect(x + 30, y + 12, 100, h - 12, [96, 112, 128]);
  cv.rect(x + 30, y + 12, 100, 4, [70, 86, 102]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) cv.rect(x + 36 + c * 11, y + 22 + r * 9, 6, 4, [60, 74, 90]);
  cv.circle(x + 80, y + 26, 13, [30, 50, 90]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    cv.circle(x + 80 + Math.cos(a) * 9, y + 26 + Math.sin(a) * 9, 1.3, YELLOW);
  }
  // flags + document
  flagPole(x + 12, y + 22, 26, 12, [[0, 40, 120], WHITE, [200, 16, 46]]);
  flagPole(x + 140, y + 22, 26, 12, [[200, 16, 46], WHITE, [200, 16, 46]]);
  cv.rect(x + 118, y + h - 18, 26, 14, [245, 242, 230]);
  cv.line(x + 121, y + h - 14, x + 141, y + h - 14, RED, 1.4);
  cv.line(x + 121, y + h - 10, x + 138, y + h - 10, [90, 84, 72], 1);
  cv.rect(x, y + h - 3, w, 3, [70, 86, 102]);
}
function sceneSomalia(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [222, 196, 150]); // warm Mogadishu day
  // skyline silhouette
  cv.rect(x, y + 26, 26, 18, [170, 140, 100]);
  cv.rect(x + 30, y + 18, 20, 26, [160, 130, 92]);
  cv.rect(x + 54, y + 30, 30, 14, [170, 140, 100]);
  cv.circle(x + 140, y + 12, 8, [240, 200, 110]);
  // embassy building
  cv.rect(x + 88, y + 22, 58, h - 22, [240, 232, 210]);
  cv.rect(x + 88, y + 22, 58, 4, [180, 60, 50]);
  cv.rect(x + 112, y + 34, 10, h - 34, [90, 70, 50]);
  windows(x + 94, y + 30, 2, 2, 6, 5, 8, 4, [120, 140, 170], [200, 190, 160], 0.3, 161);
  windows(x + 126, y + 30, 2, 2, 6, 5, 8, 4, [120, 140, 170], [200, 190, 160], 0.3, 163);
  // flags: Somalia blue + UAE
  flagPole(x + 92, y + 22, 16, 10, [[65, 130, 200]]);
  cv.circle(x + 98, y + 18, 1.6, WHITE);
  flagPole(x + 138, y + 22, 16, 10, [[0, 122, 61], WHITE, INK]);
  // envoy with suitcase + diplomatic car + palm
  person(x + 40, y + h, 12, [40, 44, 60], [150, 110, 80]);
  cv.rect(x + 48, y + h - 6, 8, 6, [120, 80, 40]);
  cv.rect(x + 8, y + h - 16, 30, 10, [30, 34, 44]);
  cv.rect(x + 12, y + h - 21, 18, 6, [40, 46, 60]);
  cv.circle(x + 14, y + h - 5, 3, INK); cv.circle(x + 32, y + h - 5, 3, INK);
  cv.rect(x + 152, y + h - 24, 3, 24, [110, 80, 50]);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.5;
    cv.line(x + 153, y + h - 24, x + 153 + Math.cos(a) * 10, y + h - 24 + Math.sin(a) * 8, [70, 110, 60], 2);
  }
  cv.rect(x, y + h - 3, w, 3, [160, 130, 92]);
}
function sceneGaza(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [196, 190, 164]); // overcast
  // flood water
  cv.rect(x, y + h - 16, w, 16, [90, 140, 170]);
  cv.line(x, y + h - 16, x + w, y + h - 16, [140, 190, 210], 1);
  // tents + aid truck
  cv.poly([[x + 10, y + h - 16], [x + 26, y + h - 38], [x + 42, y + h - 16]], [220, 210, 180]);
  cv.poly([[x + 48, y + h - 16], [x + 62, y + h - 34], [x + 76, y + h - 16]], [200, 188, 158]);
  cv.rect(x + 96, y + h - 30, 40, 16, [240, 240, 235]);
  cv.rect(x + 96, y + h - 30, 40, 4, RED);
  cv.circle(x + 104, y + h - 13, 3, INK); cv.circle(x + 128, y + h - 13, 3, INK);
  // aid boxes + four small flags
  cv.rect(x + 80, y + h - 22, 10, 6, [180, 140, 80]); cv.rect(x + 82, y + h - 28, 8, 6, [160, 120, 70]);
  const fl: RGB[][] = [[[0, 40, 120]], [[200, 16, 46]], [[0, 122, 61]], [[0, 40, 120]]];
  for (let i = 0; i < 4; i++) flagPole(x + 108 + i * 12, y + 12, 12, 8, fl[i]);
  person(x + 56, y + h - 14, 10, [120, 50, 40], [214, 178, 140]);
  cv.rect(x, y + h - 3, w, 3, [140, 130, 100]);
}
function sceneVegas(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [16, 20, 44]); // night strip
  stars(x, y, w, 18, 8, 171);
  // skyline with neon
  const cols: RGB[] = [[200, 40, 90], [245, 197, 66], [60, 180, 200], [150, 90, 200]];
  for (let i = 0; i < 4; i++) {
    const bx = x + 6 + i * 22, bh = 18 + ((i * 11) % 12);
    cv.rect(bx, y + 24 - bh + 12, 18, bh, [40, 46, 70]);
    cv.rect(bx, y + 24 - bh + 12, 18, 2, cols[i]);
  }
  // checkered flag
  cv.vline(x + 118, y + 8, 22, [220, 220, 210], 1.6);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cv.rect(x + 119 + c * 5, y + 8 + r * 5, 5, 5, (r + c) % 2 ? WHITE : INK);
  // race car, red, low + speed lines + confetti
  cv.rect(x + 30, y + h - 20, 64, 8, [200, 16, 46]);
  cv.poly([[x + 44, y + h - 20], [x + 52, y + h - 28], [x + 72, y + h - 28], [x + 80, y + h - 20]], [170, 10, 36]);
  cv.circle(x + 42, y + h - 11, 4, INK); cv.circle(x + 82, y + h - 11, 4, INK);
  cv.circle(x + 42, y + h - 11, 1.6, [200, 200, 200]); cv.circle(x + 82, y + h - 11, 1.6, [200, 200, 200]);
  cv.line(x + 8, y + h - 18, x + 24, y + h - 18, YELLOW, 1.6);
  cv.line(x + 8, y + h - 14, x + 20, y + h - 14, WHITE, 1.4);
  for (let i = 0; i < 8; i++) cv.rect(x + 20 + hash2(i, 181) * 120, y + 30 + hash2(i, 183) * 8, 2, 2, cols[i % 4]);
  cv.rect(x, y + h - 4, w, 4, [30, 32, 44]);
}

// ---------- content ----------
let BARLOW: Font[] = [];
let BARLOW_M: Font[] = [];
let BARLOW_SB: Font[] = [];
let BARLOW_B: Font[] = [];
let PLAY_BLACK: Font[] = [];
let PLAY_BOLD: Font[] = [];
let PLAY_XB: Font[] = [];

type Lead = { n: number; loc: string; cat: string; head: string; body: string; src: string; status: string; scene: (x: number, y: number, w: number, h: number) => void };
const LEADS: Lead[] = [
  { n: 1, loc: "ANTALYA, TÜRKIYE", cat: "CLIMATE", head: "COP31 collapses with no deal",
    body: "After two days of overtime, the summit ends Sunday with no deal. The EU and ~130 nations reject a text that drops fossil fuels; President Kurum admits no consensus. The longest COP in history; the biggest setback since COP15 in 2009.",
    src: "Reuters · CNN · AP", status: "CONFIRMED", scene: sceneCOP31 },
  { n: 2, loc: "DYMER, UKRAINE", cat: "WAR", head: "Strike on Dymer block kills at least 10",
    body: "A drone hits a five-storey block 45 km north of Kyiv early on Sunday; the building partly collapses. A boy of seven is pulled alive after 14 hours; a 79-year-old woman is rescued; 11 people were unaccounted for.",
    src: "Kyiv regional officials · SES", status: "CONFIRMED", scene: sceneDymer },
  { n: 3, loc: "MANAMA, BAHRAIN", cat: "IRAN", head: "Iran claims two US radars hit; US denies damage",
    body: "The IRGC claims a missile + drone operation destroyed two US Patriot radars at Al-Riffa and Awali. US: no damage to its personnel or facilities. Bahrain: air defences intercept several targets; fire at a civilian industrial site; 2 hurt.",
    src: "IRIB / Al Jazeera · CBS / US official · Bahrain", status: "CLAIM", scene: sceneBahrain },
];
type Grid = { n: number; loc: string; cat: string; head: string; body: string; chip: string; status: string; scene: (x: number, y: number, w: number, h: number) => void };
const GRID: Grid[] = [
  { n: 4, loc: "GULF OF FINLAND", cat: "SEA", head: "Russian cargo ship Sparta II still ablaze", body: "Sanctioned ship linked to Russia's defence ministry, hit by a suspected Ukrainian drone.", chip: "STILL ABLAZE", status: "REPORTED", scene: sceneSparta },
  { n: 5, loc: "PERU", cat: "EARTHQUAKE", head: "Magnitude 6.8 quake shakes Peru's Andes", body: "Tremors send Lima residents fleeing; early reports cite no damage or casualties.", chip: "6.8", status: "REPORTED", scene: scenePeru },
  { n: 6, loc: "JERUSALEM", cat: "POLITICS", head: "Eisenkot asked to form Israel's government", body: "President Herzog passes over Netanyahu; mandate ceremony on Sunday.", chip: "MANDATE", status: "REPORTED", scene: sceneJerusalem },
  { n: 7, loc: "UKRAINE", cat: "WAR", head: "Missiles hit Zelenskyy's hometown, 2 dead", body: "Kryvyi Rih: 60 hurt, a hospital and 25 blocks hit.", chip: "2 DEAD", status: "REPORTED", scene: sceneKryvyi },
  { n: 8, loc: "MEXICO", cat: "CARTELS", head: "11 killed after cartel boss is captured", body: "\u201CEl Chapo Isidro\u201D Meza Flores seized in Sinaloa.", chip: "11 KILLED", status: "REPORTED", scene: sceneMexico },
  { n: 9, loc: "HONG KONG", cat: "ELECTION", head: "Hong Kong votes fill all 723 seats", body: "723 seats from 856 candidates, 31 subsectors; record 98.79% turnout; 5,640 voters.", chip: "723 SEATS", status: "CONFIRMED", scene: sceneHongKong },
  { n: 10, loc: "HORMUZ", cat: "SEA", head: "Two tankers hit and set ablaze near Hormuz", body: "UKMTO: two tankers hit by unknown projectiles near Khasab, Oman; crews evacuated.", chip: "2 TANKERS", status: "REPORTED", scene: sceneHormuz },
  { n: 11, loc: "HORMUZ", cat: "AIR", head: "Iran claims 20th US MQ-1 drone downed", body: "IRGC claims it downed a US MQ-1 drone east of Hormuz, the 20th of the war. Unverified.", chip: "20TH DRONE", status: "CLAIM", scene: sceneMQ1 },
  { n: 12, loc: "BRUSSELS", cat: "TRADE", head: "EU and Indonesia sign landmark trade deal", body: "Signed Saturday in Brussels after ~10 years of talks; removes 98.5% of tariffs.", chip: "98.5%", status: "REPORTED", scene: sceneBrussels },
  { n: 13, loc: "SOMALIA", cat: "DIPLOMACY", head: "Somalia orders UAE envoy to leave", body: "Mogadishu withdraws its ambassador too.", chip: "ENVOY OUT", status: "REPORTED", scene: sceneSomalia },
  { n: 14, loc: "GAZA", cat: "AID", head: "Four nations press Israel on Gaza aid", body: "Australia, Canada, Italy and Britain cite flood suffering.", chip: "4 NATIONS", status: "REPORTED", scene: sceneGaza },
  { n: 15, loc: "LAS VEGAS", cat: "FORMULA 1", head: "Verstappen wins the Las Vegas Grand Prix", body: "Third win in four years; race with 35 lead changes; beats Antonelli and Russell.", chip: "35 LEAD CHANGES", status: "REPORTED", scene: sceneVegas },
];
const WIRE_LEFT = [
  "16  US — COURTS: Court backs $7.25bn Roundup settlement",
  "17  RUGBY: England thrash the All Blacks 37-12",
  "18  FOOTBALL: Arsenal held 2-2; Leeds stun Chelsea 4-1",
  "19  Estonia to close its Russia border; Moscow cries \u201CIron Curtain\u201D",
  "20  France: police jailed for racist violence, a landmark ruling",
  "21  France: 6th straight Saturday of cost-of-living protests",
  "22  US: Trump warns of a \u201Ctremendous tax\u201D on AI centres abroad",
  "23  US: man convicted of starting the deadly 2025 Palisades fire",
  "24  US: State Dept details $12bn of Venezuelan oil revenue",
  "25  US: Trump ousts cyber director after outage criticism",
  "26  Ebola: the death toll passes 5,700, containment goes on",
];
const WIRE_RIGHT = [
  "27  Myanmar: France seeks UN action on the genocide ruling",
  "28  India-China: commanders meet on the Arunachal frontier",
  "29  Japan: forces to train live-fire at Indian facilities, a first",
  "30  India: Air India extends Jeddah suspension to 24 Nov",
  "31  India: ICMR signs off 100 health technology transfers",
  "32  Cricket: Rahul's century headlines India's Test in NZ",
  "33  Cricket: Cummins wins unanimous backing as Australia captain",
  "34  Switzerland: 4,000-year-old bronze ring found in melting ice",
  "35  Australia: bystanders pull a driver from a burning car, Canberra",
  "36  Football: PSG win 3-2 at Nice; Doue hurt badly",
];
const DATE_CHECK = "DATE CHECK — FULL-DAY EDITION: wires through the end of Sunday 22 November 2026. Left out as Saturday 21 November news: the Kyiv bridge strikes, the Shenzhen summit and India's Nitish Setu opening — and the Lviv strike (Friday 20 Nov). Now included (22 November): COP31's collapse, the Dymer strike, Iran's Bahrain radar claim, Hong Kong's vote count, the Hormuz tanker fires, the MQ-1 claim. COP31's vote is no longer pending — the summit ended with no deal.";

const STATUS_BG: Record<string, RGB> = { CONFIRMED: [31, 122, 58], CLAIM: [200, 16, 46], REPORTED: [138, 109, 59] };
function statusChip(x: number, y: number, s: string) {
  const w = textWidth(s, 8.5, BARLOW_B) + 10;
  cv.rect(x - w, y, w, 12, STATUS_BG[s] || [90, 84, 72]);
  drawText(x - w / 2, y + 9.5, s, 8.5, BARLOW_B, WHITE, "c");
}
function numBadge(x: number, y: number, n: number) {
  cv.circle(x + 8, y + 8, 8.5, RED);
  drawText(x + 8, y + 12, String(n), 10, BARLOW_B, WHITE, "c");
}
function chipData(x: number, y: number, s: string) {
  const w = textWidth(s, 8, BARLOW_B) + 8;
  cv.rect(x, y, w, 11, CREAM);
  drawText(x + 4, y + 9, s, 8, BARLOW_B, RED, "l");
}

// ---------- map ----------
const CONTINENTS: number[][][] = [
  [[-168, 66], [-140, 70], [-125, 71], [-110, 68], [-95, 69], [-85, 66], [-80, 73], [-70, 62], [-55, 52], [-60, 45], [-70, 42], [-75, 35], [-80, 32], [-85, 30], [-90, 21], [-97, 16], [-94, 17], [-87, 13], [-83, 9], [-79, 9], [-92, 15], [-105, 20], [-110, 24], [-117, 33], [-125, 40], [-124, 48], [-130, 55], [-150, 60], [-165, 60]],
  [[-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-70, -18], [-70, -23], [-70, -30], [-72, -37], [-73, -44], [-70, -52], [-66, -55], [-68, -50], [-62, -41], [-57, -35], [-52, -32], [-48, -28], [-41, -22], [-35, -9], [-35, -6], [-40, -3], [-44, -2], [-50, 0], [-55, 5], [-60, 8], [-68, 11], [-75, 10]],
  [[-10, 36], [-9, 43], [-1, 46], [-4, 48], [2, 51], [7, 54], [8, 57], [12, 58], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [25, 65], [20, 70], [30, 71], [40, 67], [45, 68], [55, 68], [60, 69], [68, 72], [60, 68], [50, 60], [45, 55], [40, 52], [35, 48], [30, 46], [28, 44], [23, 40], [22, 37], [19, 42], [12, 44], [8, 44], [3, 42], [0, 39], [-2, 37], [-6, 36]],
  [[-6, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [34, 28], [35, 24], [37, 20], [39, 15], [41, 11], [43, 11], [48, 11], [51, 10], [51, 12], [46, 5], [42, 0], [40, -5], [40, -10], [36, -18], [33, -26], [28, -33], [20, -35], [17, -32], [15, -27], [12, -18], [12, -10], [9, -1], [9, 4], [4, 6], [-8, 5], [-13, 8], [-17, 15], [-17, 20], [-16, 25], [-15, 30], [-10, 31]],
  [[30, 36], [35, 36], [36, 42], [40, 46], [45, 48], [50, 46], [55, 50], [60, 55], [65, 60], [68, 65], [70, 72], [75, 73], [80, 73], [90, 75], [100, 77], [110, 76], [120, 73], [130, 72], [140, 72], [150, 70], [160, 69], [170, 66], [178, 65], [170, 60], [162, 58], [158, 52], [150, 59], [142, 55], [140, 45], [135, 43], [130, 42], [127, 40], [122, 38], [120, 32], [115, 23], [110, 20], [105, 10], [100, 8], [98, 15], [95, 16], [92, 21], [90, 22], [85, 20], [80, 15], [78, 8], [76, 10], [72, 20], [68, 23], [62, 25], [57, 26], [52, 26], [48, 29], [48, 24], [44, 41], [40, 41], [36, 36]],
  [[113, -22], [114, -30], [115, -35], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
];
function inPoly(lon: number, lat: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const PINS: { n: number; lon: number; lat: number; dx: number; dy: number }[] = [
  { n: 1, lon: 30.7, lat: 36.9, dx: 0, dy: 0 },
  { n: 2, lon: 30.3, lat: 50.8, dx: 0, dy: 0 },
  { n: 3, lon: 50.6, lat: 26.2, dx: -7, dy: -6 },
  { n: 4, lon: 24.5, lat: 59.8, dx: 0, dy: 0 },
  { n: 5, lon: -77.0, lat: -12.0, dx: 0, dy: 0 },
  { n: 6, lon: 35.2, lat: 31.8, dx: 8, dy: -7 },
  { n: 7, lon: 33.4, lat: 47.9, dx: 0, dy: 0 },
  { n: 8, lon: -107.9, lat: 25.0, dx: 0, dy: 0 },
  { n: 9, lon: 114.2, lat: 22.3, dx: 0, dy: 0 },
  { n: 10, lon: 56.3, lat: 26.5, dx: 0, dy: 0 },
  { n: 11, lon: 57.5, lat: 26.0, dx: 11, dy: -9 },
  { n: 12, lon: 4.4, lat: 50.8, dx: 0, dy: 0 },
  { n: 13, lon: 45.3, lat: 2.0, dx: 0, dy: 0 },
  { n: 14, lon: 34.5, lat: 31.5, dx: -10, dy: 8 },
  { n: 15, lon: -115.1, lat: 36.2, dx: 0, dy: 0 },
];
function drawMap(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [238, 228, 204]);
  cv.frame(x, y, w, h, [120, 110, 88], 1);
  const px = (lon: number) => x + ((lon + 180) / 360) * w;
  const py = (lat: number) => y + ((78 - lat) / 136) * h;
  for (let gy = y + 2; gy < y + h - 2; gy += 5) {
    for (let gx = x + 2; gx < x + w - 2; gx += 5) {
      const lon = ((gx - x) / w) * 360 - 180, lat = 78 - ((gy - y) / h) * 136;
      let on = false;
      for (const c of CONTINENTS) if (inPoly(lon, lat, c)) { on = true; break; }
      if (on) cv.rect(gx, gy, 1.6, 1.6, [40, 50, 80], 0.55);
    }
  }
  for (const p of PINS) {
    const tx = px(p.lon), ty = py(p.lat);
    const cx = tx + p.dx, cy = ty + p.dy;
    if (p.dx || p.dy) cv.line(tx, ty, cx, cy, RED, 1);
    cv.circle(tx, ty, 1.8, RED);
    cv.circle(cx, cy, 6.5, RED);
    cv.ring(cx, cy, 6.5, 1, WHITE);
    drawText(cx, cy + 3, String(p.n), p.n >= 10 ? 7.5 : 8.5, BARLOW_B, WHITE, "c");
  }
  drawText(x + w - 6, y + 12, "pins = story numbers", 8, BARLOW_SB, GREY, "r");
}

// ---------- page build ----------
function build() {
  cv.fill(CREAM);
  // --- top bar ---
  const topY = 8;
  drawText(14, topY + 11, "36 STORIES \u00B7 7 REGIONS \u00B7 ALL FROM THIS ONE DAY", 11, BARLOW_B, INK);
  const chips: [string, RGB][] = [
    ["EUROPE 10", [90, 110, 140]], ["MIDDLE EAST 5", [170, 60, 60]], ["AMERICAS 8", [60, 130, 120]],
    ["ASIA-PACIFIC 7", [90, 140, 80]], ["AFRICA 2", [190, 130, 60]], ["OCEANIA 2", [120, 100, 160]], ["WORLD 2", [110, 105, 95]],
  ];
  let cx = 14 + textWidth("36 STORIES \u00B7 7 REGIONS \u00B7 ALL FROM THIS ONE DAY", 11, BARLOW_B) + 10;
  for (const [label, c] of chips) {
    const w = textWidth(label, 9.5, BARLOW_B) + 10;
    cv.rect(cx, topY, w, 14, c);
    drawText(cx + w / 2, topY + 11, label, 9.5, BARLOW_B, WHITE, "c");
    cx += w + 4;
  }
  drawText(1010, topY + 11, "PRESS TIME 23:59 UTC", 11, BARLOW_B, RED, "r");
  // --- masthead ---
  const mast = "Sunday 22 November 2026";
  const mSize = fitSize(mast, 980, 66, PLAY_BLACK);
  drawText(512, 88, mast, mSize, PLAY_BLACK, INK, "c");
  cv.rect(14, 96, 996, 2, RED);
  // --- timeline bar ---
  cv.rect(14, 100, 996, 22, NAVY);
  const tl: [string, RGB][] = [
    ["THE DAY IN UTC  ", YELLOW], ["03:00 ", YELLOW], ["COP31 objections due  \u00B7  ", WHITE],
    ["05:30 ", YELLOW], ["Verstappen wins Vegas  \u00B7  ", WHITE],
    ["06:00 ", YELLOW], ["COP31 plenary (no deal)  \u00B7  ", WHITE],
    ["MORNING ", YELLOW], ["Dymer strike  \u00B7  ", WHITE],
    ["EVENING ", YELLOW], ["Hong Kong results  \u00B7  ", WHITE],
    ["NIGHT ", YELLOW], ["COP31 collapses", WHITE],
  ];
  let tx = 22;
  for (const [s, c] of tl) { drawText(tx, 115, s, 10.5, BARLOW_B, c); tx += textWidth(s, 10.5, BARLOW_B); }
  // --- leads ---
  const leadX = [14, 240, 466];
  for (let i = 0; i < 3; i++) {
    const L = LEADS[i], x = leadX[i], w = 216;
    L.scene(x, 126, w, 80);
    numBadge(x, 126, L.n);
    statusChip(x + w, 126, L.status);
    drawText(x, 220, L.loc + " — " + L.cat, 10.5, BARLOW_B, RED);
    drawPara(x, 240, L.head, w, 18.5, PLAY_BOLD, INK, 2, 21);
    drawPara(x, 274, L.body, w, 10.5, BARLOW, INK, 5, 12.5);
    drawText(x, 340, L.src, 8.5, BARLOW_SB, GREY);
  }
  // --- sidebar: THE DAY IN NUMBERS ---
  const sbX = 690, sbW = 320;
  cv.rect(sbX, 126, sbW, 218, NAVY);
  drawText(sbX + 14, 148, "THE DAY IN NUMBERS", 13, BARLOW_B, WHITE);
  cv.rect(sbX + 14, 154, sbW - 28, 1.5, YELLOW);
  const nums: [string, string][] = [
    ["186", "drones at Ukraine overnight"],
    ["10", "Dymer dead, at least"],
    ["2", "US radars claimed hit"],
    ["723", "Hong Kong seats filled"],
    ["98.5%", "tariffs removed, EU\u2013Indonesia"],
    ["$7.25bn", "Roundup settlement"],
  ];
  nums.forEach(([n, label], i) => {
    const ry = 162 + i * 30;
    drawText(sbX + 14, ry + 20, n, 20, PLAY_BLACK, RED);
    drawText(sbX + 92, ry + 19, label, 10.5, BARLOW_SB, WHITE);
    if (i < 5) cv.rect(sbX + 14, ry + 26, sbW - 28, 0.7, [60, 68, 92]);
  });
  // --- grid 12 ---
  const gw = 161, gh = 132, gx0 = 14, gy0 = 362;
  for (let i = 0; i < 12; i++) {
    const g = GRID[i];
    const gx = gx0 + (i % 6) * (gw + 6), gy = gy0 + Math.floor(i / 6) * (gh + 8);
    g.scene(gx, gy, gw, 56);
    numBadge(gx, gy, g.n);
    chipData(gx + gw - textWidth(g.chip, 8, BARLOW_B) - 8, gy + 3, g.chip);
    drawText(gx, gy + 70, g.loc + " — " + g.cat, 9, BARLOW_B, RED);
    drawPara(gx, gy + 86, g.head, gw, 14, PLAY_BOLD, INK, 2, 16);
    drawPara(gx, gy + 112, g.body, gw, 10, BARLOW, INK, 2, 12);
    if (i % 6 === 5) { /* row end */ }
  }
  // --- bottom left: ALSO list ---
  drawText(14, 658, "ALSO ON SUNDAY 22 NOVEMBER — 21 MORE STORIES", 13, BARLOW_B, RED);
  cv.rect(14, 662, 640, 1.5, RED);
  const wireRow = (items: string[], x0: number) => {
    items.forEach((s, i) => {
      const m = s.match(/^(\d+)\s+(.*)$/) as RegExpMatchArray;
      const num = m[1], rest = m[2];
      const by = 678 + i * 12.5;
      drawText(x0, by, num, 10.5, BARLOW_B, RED);
      const sz = fitSize(rest, 315 - textWidth(num + "  ", 10.5, BARLOW_B), 10.5, BARLOW_SB);
      drawText(x0 + textWidth(num + "  ", 10.5, BARLOW_B), by, rest, sz, BARLOW_SB, INK);
    });
  };
  wireRow(WIRE_LEFT, 14);
  wireRow(WIRE_RIGHT, 340);
  // --- map ---
  drawText(14, 826, "WHERE IT HAPPENED", 12, BARLOW_B, RED);
  drawMap(14, 832, 640, 112);
  drawText(334, 954, "1 ANTALYA \u00B7 2 DYMER \u00B7 3 BAHRAIN \u00B7 4 GULF OF FINLAND \u00B7 5 PERU \u00B7 6 JERUSALEM \u00B7 7 KRYVYI RIH \u00B7 8 SINALOA \u00B7 9 HONG KONG \u00B7 10 HORMUZ \u00B7 11 HORMUZ (MQ-1) \u00B7 12 BRUSSELS \u00B7 13 MOGADISHU \u00B7 14 GAZA \u00B7 15 LAS VEGAS", 7.5, BARLOW_SB, GREY, "c");
  // --- DATE CHECK (right column) ---
  const dcX = 664, dcW = 346, dcY = 642, dcH = 302;
  cv.rect(dcX, dcY, dcW, dcH, [250, 244, 230]);
  cv.frame(dcX, dcY, dcW, dcH, RED, 2);
  drawText(dcX + 12, dcY + 22, "DATE CHECK", 15, BARLOW_B, RED);
  const tag = "FULL-DAY EDITION";
  const tw = textWidth(tag, 9, BARLOW_B) + 10;
  cv.rect(dcX + dcW - 12 - tw, dcY + 10, tw, 14, RED);
  drawText(dcX + dcW - 12 - tw / 2, dcY + 21, tag, 9, BARLOW_B, WHITE, "c");
  cv.rect(dcX + 12, dcY + 28, dcW - 24, 1.5, RED);
  const dcLines = drawPara(dcX + 12, dcY + 46, DATE_CHECK, dcW - 24, 11, BARLOW, INK, 9, 14);
  const dy2 = dcY + 46 + (dcLines - 1) * 14 + 12;
  cv.rect(dcX + 12, dy2, dcW - 24, 1, [180, 170, 150]);
  drawText(dcX + 12, dy2 + 16, "NOW INCLUDED — 22 NOVEMBER", 10.5, BARLOW_B, RED);
  drawPara(dcX + 12, dy2 + 32, "COP31's collapse \u00B7 Dymer strike \u00B7 Bahrain radar claim \u00B7 Hong Kong vote count \u00B7 Hormuz tanker fires \u00B7 MQ-1 claim", dcW - 24, 10.5, BARLOW_SB, INK, 2, 13);
  drawText(dcX + 12, dy2 + 62, "LEFT OUT — SATURDAY 21 NOVEMBER", 10.5, BARLOW_B, GREY);
  drawPara(dcX + 12, dy2 + 78, "Kyiv bridge strikes \u00B7 Shenzhen summit \u00B7 Nitish Setu opening \u00B7 Lviv strike (Friday 20 Nov)", dcW - 24, 10.5, BARLOW_SB, INK, 2, 13);
  // clock + press-time strip at bottom of box
  const cy0 = dcY + dcH - 34;
  cv.circle(dcX + 26, cy0 + 10, 10, WHITE); cv.ring(dcX + 26, cy0 + 10, 10, 2, RED);
  cv.line(dcX + 26, cy0 + 10, dcX + 26, cy0 + 3, RED, 1.6); cv.line(dcX + 26, cy0 + 10, dcX + 32, cy0 + 12, RED, 1.6);
  drawText(dcX + 44, cy0 + 14, "WIRES THROUGH END OF SUNDAY \u00B7 PRESS TIME 23:59 UTC", 9.5, BARLOW_B, INK);
  drawText(dcX + 44, cy0 + 26, "ALL 36 STORIES \u00B7 ONE DAY \u00B7 ONE PAGE", 9.5, BARLOW_B, RED);
  // --- footer ---
  drawText(14, 968, "Sources: Reuters \u00B7 CNN \u00B7 AP \u00B7 Xinhua \u00B7 China Daily \u00B7 UKMTO \u00B7 IRIB \u00B7 Al Jazeera \u00B7 European Commission \u00B7 Finnish Border Guard \u00B7 F1 \u00B7 France 24 \u00B7 Kyiv regional officials \u00B7 SES \u00B7 Bahrain", 8.5, BARLOW_SB, GREY);
  drawText(14, 980, "CERTAINTY: CONFIRMED — official / 2+ outlets \u00B7 CLAIM — one side's claim \u00B7 REPORTED — witnesses / one source \u00B7 PENDING — not settled yet", 8.5, BARLOW_SB, GREY);
  drawText(1010, 980, "Drawn illustrations — no photographs. All stories: Sun 22 Nov 2026 (UTC).", 8.5, BARLOW_SB, GREY, "r");
  cv.rect(14, 988, 996, 1.5, RED);
  cv.rect(14, 990, 996, 34, NAVY);
  drawText(26, 1012, "THE WORLD IN ONE DAY", 13, BARLOW_B, WHITE);
  drawText(998, 1012, "SUNDAY 22 NOVEMBER 2026 \u00B7 ONE PAGE", 13, BARLOW_B, WHITE, "r");
  // grain
  cv.grain(0, 0, W, H, 0.03);
}

// ---------- main ----------
function main() {
  const dir = dirname(fileURLToPath(import.meta.url));
  loadFonts(join(dir, "fonts"));
  build();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(cv.data, W, H);
  writeFileSync(join(outDir, "entry.png"), png);
}
main();
