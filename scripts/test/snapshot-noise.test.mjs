import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import zlib from 'node:zlib';
import { compareImages, decodePng, isNoise, MAX_NOISE_DELTA } from '../snapshot-noise.mjs';

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 按指定的行过滤方式编码一张 RGBA PNG（与被测的解码器各写各的，互相印证） */
function encodePng(width, height, pixels, filterOf = () => 0) {
  const channels = 4;
  const stride = width * channels;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y);
    const line = Buffer.alloc(stride + 1);
    line[0] = filter;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      line[x + 1] = (cur - predictor) & 0xff;
    }
    rows.push(line);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function gradient(width, height, shift = 0) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 37 + shift) & 0xff;
    pixels[i * 4 + 1] = (i * 11) & 0xff;
    pixels[i * 4 + 2] = (i * 101) & 0xff;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

test('decodes every row filter back to the same pixels', () => {
  const pixels = gradient(7, 5);
  const image = decodePng(encodePng(7, 5, pixels, (y) => y % 5));
  assert.equal(image.width, 7);
  assert.equal(image.height, 5);
  assert.deepEqual(image.pixels, pixels);
});

test('decodes a real committed screenshot', () => {
  const file = execFileSync('git', ['ls-files', 'tests/redesign/*.png'], { encoding: 'utf8' }).split('\n')[0];
  const image = decodePng(execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 64 * 1024 * 1024 }));
  assert.ok(image.width > 0 && image.height > 0);
  assert.equal(compareImages(image, image).changedPixels, 0);
});

test('small per-channel differences are noise, larger ones are real changes', () => {
  const base = gradient(4, 4);
  const nudged = Buffer.from(base);
  nudged[0] = (nudged[0] + MAX_NOISE_DELTA) & 0xff;
  const noise = compareImages(decodePng(encodePng(4, 4, base)), decodePng(encodePng(4, 4, nudged)));
  assert.deepEqual(noise, { sizeChanged: false, changedPixels: 1, maxDelta: MAX_NOISE_DELTA });
  assert.equal(isNoise(noise), true);

  const moved = Buffer.from(base);
  moved[0] = (moved[0] + MAX_NOISE_DELTA + 1) & 0xff;
  assert.equal(isNoise(compareImages(decodePng(encodePng(4, 4, base)), decodePng(encodePng(4, 4, moved)))), false);
});

test('a size change is never noise', () => {
  const diff = compareImages(decodePng(encodePng(4, 4, gradient(4, 4))), decodePng(encodePng(4, 5, gradient(4, 5))));
  assert.equal(isNoise(diff), false);
});

test('refuses formats it cannot read instead of guessing', () => {
  const png = encodePng(2, 2, gradient(2, 2));
  png[8 + 8 + 9] = 3; // IHDR 颜色类型改成调色板
  assert.throws(() => decodePng(png), /只支持 8 位/);
});
