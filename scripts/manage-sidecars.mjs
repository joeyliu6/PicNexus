#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

export const SIDECAR_TARGETS = Object.freeze({
  'x86_64-pc-windows-msvc': {
    platform: 'win32',
    arch: 'x64',
    extension: '.exe',
    scripts: { qiyu: 'pkg:win', nami: 'pkg:win:x64' },
  },
  'x86_64-apple-darwin': {
    platform: 'darwin',
    arch: 'x64',
    extension: '',
    scripts: { qiyu: 'pkg:mac', nami: 'pkg:mac' },
  },
  'aarch64-apple-darwin': {
    platform: 'darwin',
    arch: 'arm64',
    extension: '',
    scripts: { qiyu: 'pkg:mac-arm', nami: 'pkg:mac-arm' },
  },
  'x86_64-unknown-linux-gnu': {
    platform: 'linux',
    arch: 'x64',
    extension: '',
    scripts: { qiyu: 'pkg:linux', nami: 'pkg:linux' },
  },
});

const SIDECARS = Object.freeze([
  { key: 'qiyu', directory: 'qiyu-token-fetcher', binary: 'qiyu-token-fetcher' },
  { key: 'nami', directory: 'nami-token-fetcher', binary: 'nami-token-fetcher' },
]);

export function resolveHostTarget(platform = process.platform, arch = process.arch) {
  const match = Object.entries(SIDECAR_TARGETS).find(([, value]) => (
    value.platform === platform && value.arch === arch
  ));
  if (!match) {
    throw new Error(
      `Unsupported sidecar host: ${platform}/${arch}. Supported targets: ${Object.keys(SIDECAR_TARGETS).join(', ')}`,
    );
  }
  return match[0];
}

export function resolveTarget(requestedTarget, platform = process.platform, arch = process.arch) {
  const target = requestedTarget || resolveHostTarget(platform, arch);
  const config = SIDECAR_TARGETS[target];
  if (!config) {
    throw new Error(`Unsupported sidecar target: ${target}. Supported targets: ${Object.keys(SIDECAR_TARGETS).join(', ')}`);
  }
  if (config.platform !== platform) {
    throw new Error(`Target ${target} must be built on ${config.platform}, current platform is ${platform}`);
  }
  return { target, config };
}

export function expectedBinaryPaths(target, root = repositoryRoot) {
  const config = SIDECAR_TARGETS[target];
  if (!config) throw new Error(`Unsupported sidecar target: ${target}`);
  return SIDECARS.map((sidecar) => join(
    root,
    'src-tauri',
    'binaries',
    `${sidecar.binary}-${target}${config.extension}`,
  ));
}

export function parseTarget(args) {
  const equalsArgument = args.find((argument) => argument.startsWith('--target='));
  if (equalsArgument) {
    const value = equalsArgument.slice('--target='.length);
    if (!value) throw new Error('Missing value for --target');
    return value;
  }
  const targetIndex = args.indexOf('--target');
  if (targetIndex < 0) return undefined;
  const value = args[targetIndex + 1];
  if (!value || value.startsWith('--')) throw new Error('Missing value for --target');
  return value;
}

function runNpm(args, cwd = repositoryRoot) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function installDependencies() {
  for (const sidecar of SIDECARS) {
    runNpm(['ci'], join(repositoryRoot, 'sidecars', sidecar.directory));
  }
}

function buildSidecars(target, config) {
  for (const sidecar of SIDECARS) {
    const directory = join(repositoryRoot, 'sidecars', sidecar.directory);
    runNpm(['run', 'build'], directory);
    runNpm(['run', config.scripts[sidecar.key]], directory);
  }
  verifySidecars(target);
}

export function verifySidecars(target, root = repositoryRoot) {
  const missing = [];
  for (const binaryPath of expectedBinaryPaths(target, root)) {
    if (!existsSync(binaryPath) || statSync(binaryPath).size === 0) {
      missing.push(relative(root, binaryPath));
    }
  }
  if (missing.length) {
    throw new Error(`Missing or empty sidecar binaries:\n${missing.map((path) => `- ${path}`).join('\n')}`);
  }
  return expectedBinaryPaths(target, root);
}

async function main() {
  const [command = 'verify', ...args] = process.argv.slice(2);
  const { target, config } = resolveTarget(parseTarget(args));

  if (command === 'setup') {
    installDependencies();
    buildSidecars(target, config);
  } else if (command === 'build') {
    buildSidecars(target, config);
  } else if (command === 'verify') {
    verifySidecars(target);
  } else {
    throw new Error(`Unknown sidecar command: ${command}. Expected setup, build, or verify.`);
  }

  process.stdout.write(`Sidecars ready for ${target}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
