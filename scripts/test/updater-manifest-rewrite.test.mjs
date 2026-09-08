import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteUpdaterManifest } from '../rewrite-updater-manifest.mjs';

// 结构照抄 v1.1.0 真实 latest.json（签名截短）。notes 保留中文，
// 因为改写后要重新序列化上传，非 ASCII 往返是真实风险。
function makeManifest(overrides = {}) {
  return {
    version: '1.1.0',
    notes: '## 推荐下载\n\n| 使用场景 | 推荐文件 |\n| Windows 普通用户 | `x64-setup.exe` |',
    pub_date: '2026-08-21T12:09:42.810Z',
    platforms: {
      'darwin-aarch64': { signature: 'sig-darwin-arm', url: 'https://example.com/PicNexus_aarch64.app.tar.gz' },
      'darwin-x86_64': { signature: 'sig-darwin-x64', url: 'https://example.com/PicNexus_x64.app.tar.gz' },
      'linux-x86_64': { signature: 'sig-linux', url: 'https://example.com/PicNexus_1.1.0_amd64.AppImage' },
      'linux-x86_64-deb': { signature: 'sig-deb', url: 'https://example.com/PicNexus_1.1.0_amd64.deb' },
      'windows-x86_64': { signature: 'sig-msi', url: 'https://example.com/PicNexus_1.1.0_x64_en-US.msi' },
      'windows-x86_64-msi': { signature: 'sig-msi', url: 'https://example.com/PicNexus_1.1.0_x64_en-US.msi' },
      'windows-x86_64-nsis': { signature: 'sig-nsis', url: 'https://example.com/PicNexus_1.1.0_x64-setup.exe' },
      ...(overrides.platforms ?? {}),
    },
    ...(overrides.top ?? {}),
  };
}

test('points the generic Windows key at the NSIS installer', () => {
  const { manifest, previousUrl, nextUrl } = rewriteUpdaterManifest(makeManifest());

  assert.ok(manifest.platforms['windows-x86_64'].url.endsWith('-setup.exe'));
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'sig-nsis');
  assert.ok(previousUrl, 'previousUrl should be present when the generic key had a url');
  assert.match(previousUrl, /\.msi$/);
  assert.match(nextUrl, /-setup\.exe$/);
});

test('drops the msi key so a fixed bundle stamp cannot fall back to it', () => {
  const { manifest } = rewriteUpdaterManifest(makeManifest());

  assert.equal('windows-x86_64-msi' in manifest.platforms, false);
  // nsis 键本身保持原样
  assert.deepEqual(manifest.platforms['windows-x86_64-nsis'], {
    signature: 'sig-nsis',
    url: 'https://example.com/PicNexus_1.1.0_x64-setup.exe',
  });
});

test('copies rather than aliases the nsis entry', () => {
  const { manifest } = rewriteUpdaterManifest(makeManifest());

  assert.notEqual(manifest.platforms['windows-x86_64'], manifest.platforms['windows-x86_64-nsis']);
  manifest.platforms['windows-x86_64'].url = 'mutated';
  assert.equal(manifest.platforms['windows-x86_64-nsis'].url, 'https://example.com/PicNexus_1.1.0_x64-setup.exe');
});

test('leaves every other platform and top-level field untouched', () => {
  const input = makeManifest();
  const { manifest } = rewriteUpdaterManifest(input);

  for (const key of ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-x86_64-deb', 'windows-x86_64-nsis']) {
    assert.deepEqual(manifest.platforms[key], input.platforms[key], `${key} changed`);
  }
  assert.equal(manifest.version, input.version);
  assert.equal(manifest.notes, input.notes);
  assert.equal(manifest.pub_date, input.pub_date);

  const expected = Object.keys(input.platforms).filter((k) => k !== 'windows-x86_64-msi').sort();
  assert.deepEqual(Object.keys(manifest.platforms).sort(), expected);
});

test('does not mutate the input manifest', () => {
  const input = makeManifest();
  const before = JSON.stringify(input);
  rewriteUpdaterManifest(input);

  assert.equal(JSON.stringify(input), before);
});

test('survives a serialize round trip with non-ASCII notes intact', () => {
  const { manifest } = rewriteUpdaterManifest(makeManifest());
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const parsed = JSON.parse(serialized);

  assert.deepEqual(parsed, manifest);
  assert.match(parsed.notes, /推荐下载/);
});

// 静默降级比报错更糟：真跌回 MSI 时没人会发现，只会再收到一次「更新好慢」的反馈。
test('throws when the NSIS artifact is missing', () => {
  const manifest = makeManifest();
  delete manifest.platforms['windows-x86_64-nsis'];

  assert.throws(() => rewriteUpdaterManifest(manifest), /windows-x86_64-nsis missing/);
});

test('throws when the NSIS url is not a setup.exe', () => {
  const manifest = makeManifest({
    platforms: { 'windows-x86_64-nsis': { signature: 'sig', url: 'https://example.com/PicNexus_1.1.0_x64_en-US.msi' } },
  });

  assert.throws(() => rewriteUpdaterManifest(manifest), /is not an NSIS installer/);
});

test('throws when the NSIS signature is empty or missing', () => {
  const empty = makeManifest({
    platforms: { 'windows-x86_64-nsis': { signature: '', url: 'https://example.com/a_x64-setup.exe' } },
  });
  assert.throws(() => rewriteUpdaterManifest(empty), /signature is empty/);

  const missing = makeManifest({
    platforms: { 'windows-x86_64-nsis': { url: 'https://example.com/a_x64-setup.exe' } },
  });
  assert.throws(() => rewriteUpdaterManifest(missing), /signature is empty/);
});

test('throws on a manifest without a usable platforms object', () => {
  assert.throws(() => rewriteUpdaterManifest({ version: '1.0.0' }), /no platforms object/);
  assert.throws(() => rewriteUpdaterManifest({ platforms: [] }), /no platforms object/);
  assert.throws(() => rewriteUpdaterManifest(null), /not an object/);
  assert.throws(() => rewriteUpdaterManifest([]), /not an object/);
});

test('tolerates a manifest that has no generic key yet', () => {
  const manifest = makeManifest();
  delete manifest.platforms['windows-x86_64'];

  const result = rewriteUpdaterManifest(manifest);
  assert.equal(result.previousUrl, null);
  assert.match(result.manifest.platforms['windows-x86_64'].url, /-setup\.exe$/);
});
