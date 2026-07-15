#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

export const CLEAN_TARGETS = Object.freeze([
  'logs',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  'sidecars/nami-token-fetcher/dist',
  'sidecars/qiyu-token-fetcher/dist',
  'src-tauri/gen',
]);

export const RUST_CLEAN_TARGETS = Object.freeze([
  'src-tauri/target',
]);

export const DEEP_CLEAN_TARGETS = Object.freeze([
  '.ci-artifacts',
  '.husky/_',
  'node_modules',
  'plugins/obsidian/node_modules',
  'sidecars/nami-token-fetcher/node_modules',
  'sidecars/qiyu-token-fetcher/node_modules',
  ...RUST_CLEAN_TARGETS,
]);

export function resolveRepositoryPath(root, repositoryRelativePath) {
  if (isAbsolute(repositoryRelativePath)) {
    throw new Error(`Refusing absolute cleanup path: ${repositoryRelativePath}`);
  }
  const target = resolve(root, repositoryRelativePath);
  const relativePath = relative(root, target);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Refusing cleanup path outside repository: ${repositoryRelativePath}`);
  }
  return target;
}

export function isGeneratedSidecarFile(fileName) {
  return /^(?:nami|qiyu)-token-fetcher-(?:x86_64-pc-windows-msvc\.exe|x86_64-apple-darwin|aarch64-apple-darwin|x86_64-unknown-linux-gnu)$/.test(fileName);
}

async function removeTarget(root, repositoryRelativePath, output) {
  const target = resolveRepositoryPath(root, repositoryRelativePath);
  if (!existsSync(target)) {
    output(`skip ${repositoryRelativePath}`);
    return;
  }
  output(`remove ${repositoryRelativePath}`);
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

async function removeRootLogs(root, output) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.log')) {
      await removeTarget(root, entry.name, output);
    }
  }
}

async function removeGeneratedSidecars(root, output) {
  const binariesDirectory = resolveRepositoryPath(root, 'src-tauri/binaries');
  if (!existsSync(binariesDirectory)) return;
  for (const entry of await readdir(binariesDirectory, { withFileTypes: true })) {
    if (entry.isFile() && isGeneratedSidecarFile(entry.name)) {
      await removeTarget(root, join('src-tauri/binaries', entry.name), output);
    }
  }
}

export async function cleanWorkspace({
  root = repositoryRoot,
  deep = false,
  rustOnly = false,
  output = console.log,
} = {}) {
  if (deep && rustOnly) {
    throw new Error('Cannot combine --deep and --rust cleanup modes.');
  }

  const failures = [];
  const targets = rustOnly
    ? RUST_CLEAN_TARGETS
    : deep
      ? [...CLEAN_TARGETS, ...DEEP_CLEAN_TARGETS]
      : CLEAN_TARGETS;
  for (const target of targets) {
    try {
      await removeTarget(root, target, output);
    } catch (error) {
      failures.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!rustOnly) {
    try {
      await removeRootLogs(root, output);
      if (deep) await removeGeneratedSidecars(root, output);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) {
    throw new Error(`Cleanup incomplete:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
}

async function main() {
  await cleanWorkspace({
    deep: process.argv.includes('--deep'),
    rustOnly: process.argv.includes('--rust'),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
