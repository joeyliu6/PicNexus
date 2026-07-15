import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  expectedBinaryPaths,
  parseTarget,
  resolveHostTarget,
  resolveTarget,
} from '../manage-sidecars.mjs';
import {
  cleanWorkspace,
  isGeneratedSidecarFile,
  resolveRepositoryPath,
} from '../clean-workspace.mjs';

test('maps supported hosts to Tauri target triples', () => {
  assert.equal(resolveHostTarget('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(resolveHostTarget('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(resolveHostTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu');
  assert.throws(() => resolveHostTarget('win32', 'arm64'), /Unsupported sidecar host/);
});

test('rejects targets for a different host platform', () => {
  assert.throws(
    () => resolveTarget('aarch64-apple-darwin', 'win32', 'x64'),
    /must be built on darwin/,
  );
  assert.equal(
    resolveTarget('x86_64-apple-darwin', 'darwin', 'arm64').target,
    'x86_64-apple-darwin',
  );
});

test('requires a value when --target is present', () => {
  assert.equal(parseTarget([]), undefined);
  assert.equal(parseTarget(['--target', 'x86_64-unknown-linux-gnu']), 'x86_64-unknown-linux-gnu');
  assert.throws(() => parseTarget(['--target']), /Missing value/);
  assert.throws(() => parseTarget(['--target=']), /Missing value/);
});

test('builds exact externalBin file names', () => {
  const root = resolve('test-repository');
  assert.deepEqual(expectedBinaryPaths('x86_64-pc-windows-msvc', root), [
    join(root, 'src-tauri', 'binaries', 'qiyu-token-fetcher-x86_64-pc-windows-msvc.exe'),
    join(root, 'src-tauri', 'binaries', 'nami-token-fetcher-x86_64-pc-windows-msvc.exe'),
  ]);
});

test('cleanup guard rejects repository root and parent traversal', () => {
  const root = resolve('test-repository');
  assert.throws(() => resolveRepositoryPath(root, '.'), /Refusing cleanup path/);
  assert.throws(() => resolveRepositoryPath(root, '..'), /Refusing cleanup path/);
  assert.equal(resolveRepositoryPath(root, 'dist'), join(root, 'dist'));
});

test('deep cleanup only recognizes generated sidecar names', () => {
  assert.equal(isGeneratedSidecarFile('nami-token-fetcher-x86_64-pc-windows-msvc.exe'), true);
  assert.equal(isGeneratedSidecarFile('qiyu-token-fetcher-aarch64-apple-darwin'), true);
  assert.equal(isGeneratedSidecarFile('README.md'), false);
  assert.equal(isGeneratedSidecarFile('custom-helper.exe'), false);
});

test('deep cleanup removes generated paths and preserves tool configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'picnexus-clean-'));
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await mkdir(join(root, '.codex'), { recursive: true });
    await mkdir(join(root, 'src-tauri', 'binaries'), { recursive: true });
    await mkdir(join(root, 'src-tauri', 'target'), { recursive: true });
    await writeFile(join(root, 'dist', 'bundle.js'), 'generated');
    await writeFile(join(root, 'node_modules', 'package.txt'), 'generated');
    await writeFile(join(root, '.codex', 'settings.json'), '{}');
    await writeFile(join(root, 'src-tauri', 'target', 'artifact.rlib'), 'generated');
    await writeFile(join(root, 'src-tauri', 'binaries', 'README.md'), 'keep');
    await writeFile(join(root, 'src-tauri', 'binaries', 'custom-helper.exe'), 'keep');
    await writeFile(
      join(root, 'src-tauri', 'binaries', 'qiyu-token-fetcher-x86_64-pc-windows-msvc.exe'),
      'generated',
    );

    await cleanWorkspace({ root, deep: true, output: () => {} });

    assert.equal(existsSync(join(root, 'dist')), false);
    assert.equal(existsSync(join(root, 'node_modules')), false);
    assert.equal(existsSync(join(root, 'src-tauri', 'target')), false);
    assert.equal(existsSync(join(root, 'src-tauri', 'binaries', 'qiyu-token-fetcher-x86_64-pc-windows-msvc.exe')), false);
    assert.equal(existsSync(join(root, '.codex', 'settings.json')), true);
    assert.equal(existsSync(join(root, 'src-tauri', 'binaries', 'README.md')), true);
    assert.equal(existsSync(join(root, 'src-tauri', 'binaries', 'custom-helper.exe')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rust-only cleanup removes target and preserves other generated paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'picnexus-clean-rust-'));
  const sidecarNames = ['nami-token-fetcher', 'qiyu-token-fetcher'];
  try {
    await mkdir(join(root, 'src-tauri', 'target'), { recursive: true });
    await mkdir(join(root, 'src-tauri', 'binaries'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.codex'), { recursive: true });
    for (const sidecarName of sidecarNames) {
      await mkdir(join(root, 'sidecars', sidecarName, 'node_modules'), { recursive: true });
      await writeFile(join(root, 'sidecars', sidecarName, 'node_modules', 'package.txt'), 'generated');
      await writeFile(
        join(root, 'src-tauri', 'binaries', `${sidecarName}-x86_64-pc-windows-msvc.exe`),
        'generated',
      );
    }
    await writeFile(join(root, 'src-tauri', 'target', 'artifact.rlib'), 'generated');
    await writeFile(join(root, 'node_modules', 'package.txt'), 'generated');
    await writeFile(join(root, 'dist', 'bundle.js'), 'generated');
    await writeFile(join(root, '.codex', 'settings.json'), '{}');

    await cleanWorkspace({ root, rustOnly: true, output: () => {} });

    assert.equal(existsSync(join(root, 'src-tauri', 'target')), false);
    for (const sidecarName of sidecarNames) {
      assert.equal(existsSync(join(root, 'sidecars', sidecarName, 'node_modules', 'package.txt')), true);
      assert.equal(existsSync(join(root, 'src-tauri', 'binaries', `${sidecarName}-x86_64-pc-windows-msvc.exe`)), true);
    }
    assert.equal(existsSync(join(root, 'node_modules', 'package.txt')), true);
    assert.equal(existsSync(join(root, 'dist', 'bundle.js')), true);
    assert.equal(existsSync(join(root, '.codex', 'settings.json')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup rejects deep and rust-only modes together', async () => {
  await assert.rejects(
    cleanWorkspace({ deep: true, rustOnly: true, output: () => {} }),
    /Cannot combine --deep and --rust cleanup modes/,
  );
});
