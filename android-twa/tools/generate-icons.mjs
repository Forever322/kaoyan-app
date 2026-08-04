#!/usr/bin/env node
/**
 * generate-icons.mjs — 从 public/icons/icon-512.png 生成标准 Android 启动图标
 *
 * 零依赖（仅用 Node 内置 zlib），生成内容：
 *  1. 自适应图标（API 26+）：mipmap-anydpi-v26/ic_launcher.xml、ic_launcher_round.xml
 *     - background: 纯色（取自图标边框蓝）
 *     - foreground: 各密度透明 PNG（图标内容按 66% 安全区缩放）
 *     - monochrome: 复用 foreground（Android 13+ 主题图标）
 *  2. 旧版 PNG（API < 26）：mdpi~xxxhdpi 方形 + 圆形
 *
 * 用法（仓库根目录）：
 *   node android-twa/tools/generate-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'public', 'icons', 'icon-512.png');
const RES = path.join(ROOT, 'android-twa', 'app', 'src', 'main', 'res');

// 自适应图标：108dp 画布，内容安全区约 66dp → 前景内容缩放 66%
const FG_SCALE = 0.66;
const DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

// ---------- PNG 解码 ----------
function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
    let off = 8;
    let w = 0;
    let h = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        if (type === 'IHDR') {
            w = buf.readUInt32BE(off + 8);
            h = buf.readUInt32BE(off + 12);
            if (buf[off + 16] !== 8 || buf[off + 17] !== 6) {
                throw new Error('仅支持 8 位 RGBA PNG');
            }
        } else if (type === 'IDAT') {
            idat.push(buf.subarray(off + 8, off + 8 + len));
        }
        off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * 4;
    const px = new Uint8Array(w * h * 4);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = new Uint8Array(stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= 4 ? cur[i - 4] : 0; // 左
            const c = prev[i]; // 上
            const d = i >= 4 ? prev[i - 4] : 0; // 左上
            let x = line[i];
            switch (filter) {
                case 1:
                    x = (x + a) & 255;
                    break;
                case 2:
                    x = (x + c) & 255;
                    break;
                case 3:
                    x = (x + ((a + c) >> 1)) & 255;
                    break;
                case 4: {
                    const p = a + c - d;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - c);
                    const pc = Math.abs(p - d);
                    x = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d)) & 255;
                    break;
                }
            }
            cur[i] = x;
        }
        px.set(cur, y * stride);
        prev = cur;
    }
    return { w, h, px };
}

// ---------- PNG 编码 ----------
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
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
}

function encodePng(w, h, rgba) {
    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        raw[y * (1 + w * 4)] = 0; // filter: None
        rgba.copy ? rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4)
            : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ---------- 变换 ----------
// 最近邻缩放（像素风图标保真，避免模糊）
function resize(src, sw, sh, dw, dh) {
    const out = Buffer.alloc(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
            const si = (sy * sw + sx) * 4;
            const di = (y * dw + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
        }
    }
    return out;
}

// 前景图层：图标内容居中、按安全区缩放，画布其余部分透明
function toForeground(src, sw, sh, canvas) {
    const out = Buffer.alloc(canvas * canvas * 4);
    const size = Math.round(canvas * FG_SCALE);
    const off = Math.round((canvas - size) / 2);
    const scaled = resize(src, sw, sh, size, size);
    for (let y = 0; y < size; y++) {
        scaled.copy(out, ((off + y) * canvas + off) * 4, y * size * 4, (y + 1) * size * 4);
    }
    return out;
}

// 圆形遮罩（圆形启动图标）
function toRound(src, size) {
    const r = size / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - r;
            const dy = y + 0.5 - r;
            if (dx * dx + dy * dy > r * r) src[(y * size + x) * 4 + 3] = 0;
        }
    }
    return src;
}

// ---------- 主流程 ----------
const { w, h, px } = decodePng(fs.readFileSync(SRC));
console.log(`源图标: ${w}x${h}`);

const mipmapXml = path.join(RES, 'mipmap-anydpi-v26');
fs.mkdirSync(mipmapXml, { recursive: true });

// 1. 自适应图标（每个密度的前景 PNG）
for (const [name, canvas] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const fg = toForeground(px, w, h, canvas);
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), encodePng(canvas, canvas, fg));
    console.log(`✓ mipmap-${name}/ic_launcher_foreground.png (${canvas}x${canvas})`);
}

// 2. 旧版图标：方形 + 圆形
for (const [name, canvas] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = path.join(RES, `mipmap-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const square = resize(px, w, h, canvas, canvas);
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), encodePng(canvas, canvas, square));
    const round = toRound(resize(px, w, h, canvas, canvas), canvas);
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), encodePng(canvas, canvas, round));
    console.log(`✓ mipmap-${name}/ic_launcher.png + ic_launcher_round.png (${canvas}x${canvas})`);
}

// 3. 自适应图标 XML
const adaptiveXml = (indent) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
${indent}<background android:drawable="@color/ic_launcher_background" />
${indent}<foreground android:drawable="@mipmap/ic_launcher_foreground" />
${indent}<monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
fs.writeFileSync(path.join(mipmapXml, 'ic_launcher.xml'), adaptiveXml('    '));
fs.writeFileSync(path.join(mipmapXml, 'ic_launcher_round.xml'), adaptiveXml('    '));
console.log('✓ mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml');
console.log('完成。背景色见 res/values/colors.xml (@color/ic_launcher_background)');
