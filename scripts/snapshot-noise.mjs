/**
 * 重录像素基准后，把「只是渲染噪声」的图找出来（可选直接还原）
 *
 * `--update-snapshots=all` 会把每张图都重写一遍：同一台机器上抗锯齿、字体栅格化的细小
 * 出入也会让文件变样。逐张肉眼看几十张「看不出差别」的图既慢又容易漏掉真正变了的那张。
 * 本脚本拿工作区里改过的 PNG 和 `git show HEAD:<图>` 逐像素比：
 *
 *   - 一个像素都没变                         → 噪声
 *   - 有像素变了，但每个通道最多差 MAX_NOISE_DELTA 个色阶 → 噪声（抗锯齿，肉眼看不出）
 *   - 尺寸变了，或有像素差得更多               → 真改动，要逐张看
 *
 * 实测：55 张重录的首页 / 图库 / 链接健康基准，全都有差异像素，最大色差都 ≤ 8，全是噪声；
 * 真改动（换文案、挪 1px、换颜色）的最大色差都在 90 以上。
 *
 * 用法：
 *   node scripts/snapshot-noise.mjs [路径，默认 tests/redesign]           只列出来
 *   node scripts/snapshot-noise.mjs [路径] --restore                       噪声图 git checkout 回去
 *
 * 不引第三方库：Playwright 存的截图是 8 位、不隔行的 RGB / RGBA PNG，这里只解这一种，
 * 解不了的格式直接报错（宁可报错，也不把真改动当成噪声）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/** 每个通道最多差几个色阶仍算噪声 */
export const MAX_NOISE_DELTA = 8;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PNG 颜色类型 → 每像素几个通道（只支持 RGB 与 RGBA） */
const CHANNELS = { 2: 3, 6: 4 };

/** 解出 { width, height, channels, pixels }，pixels 是去掉行过滤后的原始字节 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('不是 PNG 文件');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG 缺少 IHDR');
  const channels = CHANNELS[header.colorType];
  if (header.bitDepth !== 8 || !channels || header.interlace !== 0) {
    throw new Error(`只支持 8 位、不隔行的 RGB / RGBA PNG（这张是 ${header.bitDepth} 位、颜色类型 ${header.colorType}、隔行 ${header.interlace}）`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[out + x - channels] : 0;
      const up = y > 0 ? pixels[out - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[out - stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`未知的行过滤方式 ${filter}`);
      pixels[out + x] = value & 0xff;
    }
  }
  return { width: header.width, height: header.height, channels, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 两张图的差异：尺寸不同时 sizeChanged；否则差异像素数与最大单通道色差（RGB 与 RGBA 混比时按 RGB 比） */
export function compareImages(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sizeChanged: true, changedPixels: 0, maxDelta: 255 };
  let changedPixels = 0;
  let maxDelta = 0;
  const channels = Math.min(a.channels, b.channels);
  for (let i = 0; i < a.width * a.height; i++) {
    let pixelDelta = 0;
    for (let c = 0; c < channels; c++) {
      const delta = Math.abs(a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c]);
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > 0) changedPixels++;
    if (pixelDelta > maxDelta) maxDelta = pixelDelta;
  }
  return { sizeChanged: false, changedPixels, maxDelta };
}

export function isNoise(diff) {
  return !diff.sizeChanged && diff.maxDelta <= MAX_NOISE_DELTA;
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024, ...options });
}

function main(argv) {
  const restore = argv.includes('--restore');
  const spec = argv.find((arg) => !arg.startsWith('--')) ?? 'tests/redesign';
  const changed = String(git(['diff', '--name-only', '--', spec], { encoding: 'utf8' }))
    .split('\n')
    .map((line) => line.trim())
    .filter((file) => file.endsWith('.png'));

  if (changed.length === 0) {
    console.log(`${spec} 下没有改过的 PNG`);
    return;
  }

  const noise = [];
  const real = [];
  for (const file of changed) {
    const diff = compareImages(decodePng(git(['show', `HEAD:${file}`])), decodePng(fs.readFileSync(file)));
    (isNoise(diff) ? noise : real).push({ file, diff });
  }

  const describe = ({ file, diff }) => (diff.sizeChanged
    ? `  ${path.basename(file)}：尺寸变了`
    : `  ${path.basename(file)}：${diff.changedPixels} 个像素不同，最大色差 ${diff.maxDelta}`);
  console.log(`噪声 ${noise.length} 张（最大色差 ≤ ${MAX_NOISE_DELTA}）${restore ? '，已还原' : ''}`);
  console.log(`真改动 ${real.length} 张，逐张看：`);
  real.sort((x, y) => y.diff.maxDelta - x.diff.maxDelta).forEach((item) => console.log(describe(item)));

  if (restore && noise.length > 0) git(['checkout', '--', ...noise.map((item) => item.file)]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
