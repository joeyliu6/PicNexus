const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';

function findExecutable(command) {
  const lookup = isWindows ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) return null;

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function resolveExecutable(command, envName) {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv;
    return null;
  }

  return findExecutable(command);
}

function missingExecutableMessage(command, envName, installHint) {
  return [
    `Missing required executable: ${command}`,
    `Hint: ${installHint}`,
    `You can also set ${envName} to an absolute executable path.`,
  ].join('\n');
}

const missing = [];

if (isMac) {
  missing.push([
    'tauri-driver does not currently support macOS desktop WebViews.',
    'Run npm run test:e2e for the mocked web harness and use the release checklist for macOS desktop smoke.',
  ].join('\n'));
} else if (!isWindows && !isLinux) {
  missing.push(`Unsupported platform for the Tauri desktop smoke test: ${process.platform}`);
}

if (!resolveExecutable('tauri-driver', 'TAURI_DRIVER')) {
  missing.push(missingExecutableMessage(
    'tauri-driver',
    'TAURI_DRIVER',
    'cargo install tauri-driver --locked',
  ));
}

if (isWindows && !resolveExecutable('msedgedriver', 'TAURI_NATIVE_DRIVER')) {
  missing.push(missingExecutableMessage(
    'msedgedriver',
    'TAURI_NATIVE_DRIVER',
    'Download the Microsoft Edge WebDriver matching your Edge version, or run: cargo install --git https://github.com/chippers/msedgedriver-tool && msedgedriver-tool',
  ));
}

if (isLinux && !resolveExecutable('WebKitWebDriver', 'TAURI_NATIVE_DRIVER')) {
  missing.push(missingExecutableMessage(
    'WebKitWebDriver',
    'TAURI_NATIVE_DRIVER',
    'Install webkit2gtk-driver. On Ubuntu: sudo apt-get install -y webkit2gtk-driver xvfb',
  ));
}

if (missing.length > 0) {
  process.stderr.write([
    'Cannot run npm run test:tauri:e2e yet. Missing platform prerequisites:',
    '',
    missing.join('\n\n'),
    '',
  ].join('\n'));
  process.exit(1);
}
