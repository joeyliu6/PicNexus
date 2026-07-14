import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateObsidianRelease } from '../validate-obsidian-release.mjs';

const INSTALL_GUIDE_URL = 'https://github.com/joeyliu6/PicNexus/blob/main/docs/reference/guides/obsidian-plugin-installation.md';

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'picnexus-release-test-'));
  const manifest = {
    id: 'picnexus',
    name: 'PicNexus',
    version: '1.0.0',
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
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(packageLock));
  writeFileSync(join(root, 'versions.json'), JSON.stringify(versions));
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  writeFileSync(
    join(root, 'README.md'),
    overrides.readme ?? `Connects to http://127.0.0.1:<port>. See ${INSTALL_GUIDE_URL}.`,
  );
  writeFileSync(join(root, 'LICENSE'), 'Apache-2.0');
  writeFileSync(join(root, 'CONTRIBUTING.md'), '# Contributing');
  writeFileSync(join(root, 'eslint.config.mjs'), 'export default [];');
  writeFileSync(
    join(root, '.github', 'workflows', 'attest-release.yml'),
    'release:\nworkflow_dispatch:\nid-token: write\nattestations: write\nartifact-metadata: write\nuses: actions/attest@v4\n',
  );
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
    assert.equal(result.version, '1.0.0');
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
  withFixture({ versions: { '1.0.0': '1.5.0' } }, root => {
    assert.throws(() => validateObsidianRelease(root), /versions\.json must map/);
  });
});

test('rejects a repository that does not ignore node_modules', () => {
  withFixture({}, root => {
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    assert.throws(() => validateObsidianRelease(root), /\.gitignore must exclude node_modules/);
  });
});

test('rejects a README that does not link to the canonical installation guide', () => {
  withFixture({ readme: 'Connects to http://127.0.0.1:<port>.' }, root => {
    assert.throws(() => validateObsidianRelease(root), /must link to the canonical Obsidian installation guide/);
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

test('rejects a repository without an attestation workflow', () => {
  withFixture({ remove: [join('.github', 'workflows', 'attest-release.yml')] }, root => {
    assert.throws(
      () => validateObsidianRelease(root),
      /Required repository file is missing: \.github\/workflows\/attest-release\.yml/,
    );
  });
});
