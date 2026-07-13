import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateObsidianRelease } from '../validate-obsidian-release.mjs';

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'picnexus-release-test-'));
  const manifest = {
    id: 'picnexus',
    name: 'PicNexus',
    version: '1.0.10',
    minAppVersion: '1.4.0',
    description: 'Upload images through the PicNexus desktop app.',
    author: 'joeyliu6',
    authorUrl: 'https://github.com/joeyliu6',
    isDesktopOnly: true,
    ...overrides.manifest,
  };
  const packageJson = { name: 'picnexus-obsidian', version: manifest.version, ...overrides.packageJson };
  const packageLock = {
    name: 'picnexus-obsidian',
    version: manifest.version,
    packages: { '': { name: 'picnexus-obsidian', version: manifest.version } },
    ...overrides.packageLock,
  };
  const versions = { [manifest.version]: manifest.minAppVersion, ...overrides.versions };

  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(packageLock));
  writeFileSync(join(root, 'versions.json'), JSON.stringify(versions));
  writeFileSync(join(root, 'README.md'), 'Connects to http://127.0.0.1:<port>.');
  writeFileSync(join(root, 'LICENSE'), 'Apache-2.0');
  writeFileSync(join(root, 'main.js'), 'module.exports = class PicNexusPlugin {};');
  writeFileSync(join(root, 'styles.css'), '.picnexus-status { color: var(--text-muted); }');

  for (const name of overrides.remove ?? []) {
    rmSync(join(root, name));
  }
  return root;
}

function withFixture(overrides, callback) {
  const root = createFixture(overrides);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts a complete official release layout', () => {
  withFixture({}, root => {
    const result = validateObsidianRelease(root);
    assert.equal(result.id, 'picnexus');
    assert.equal(result.version, '1.0.10');
    assert.deepEqual(result.assets, ['main.js', 'manifest.json', 'styles.css']);
  });
});

test('rejects plugin IDs containing obsidian', () => {
  withFixture({ manifest: { id: 'obsidian-picnexus' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /must be "picnexus"[\s\S]*must not contain "obsidian"/);
  });
});

test('rejects package versions that drift from the manifest', () => {
  withFixture({ packageJson: { version: '1.0.9' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /package\.json version must match/);
  });
});

test('rejects missing runtime assets', () => {
  withFixture({ remove: ['main.js'] }, root => {
    assert.throws(() => validateObsidianRelease(root), /Required repository file is missing: main\.js/);
  });
});

test('rejects an outdated versions mapping', () => {
  withFixture({ versions: { '1.0.10': '1.5.0' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /versions\.json must map/);
  });
});

test('rejects an invalid author URL', () => {
  withFixture({ manifest: { authorUrl: 'javascript:alert(1)' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /authorUrl must be a valid HTTP\(S\) URL/);
  });
});

test('rejects an empty runtime asset', () => {
  withFixture({}, root => {
    writeFileSync(join(root, 'styles.css'), '');
    assert.throws(() => validateObsidianRelease(root), /Runtime asset is empty: styles\.css/);
  });
});

test('rejects a root lockfile version mismatch', () => {
  withFixture({ packageLock: { version: '1.0.9' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /package-lock\.json version must match/);
  });
});

test('rejects descriptions that violate directory requirements', () => {
  withFixture({ manifest: { description: '上传图片' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /must end with a period[\s\S]*basic printable Latin/);
  });
});
