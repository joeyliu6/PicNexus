const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const rootDir = __dirname;
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const appBinary = isWindows ? 'picnexus.exe' : 'picnexus';
const appPath = path.join(rootDir, 'src-tauri', 'target', 'debug', appBinary);

let tauriDriverProcess;
let resolvedTauriDriverPath;
let resolvedNativeDriverPath;

function findExecutable(command) {
  const lookup = isWindows ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], {
    cwd: rootDir,
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
    throw new Error(`${envName} points to a missing executable: ${fromEnv}`);
  }

  return findExecutable(command);
}

function missingExecutableMessage(command, envName, installHint) {
  return [
    `Missing required executable: ${command}`,
    `Install or expose it before running npm run test:tauri:e2e.`,
    `Hint: ${installHint}`,
    `You can also set ${envName} to an absolute executable path.`,
  ].join('\n');
}

function runCommand(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertPlatformSupport() {
  if (isMac) {
    throw new Error([
      'tauri-driver does not currently support macOS desktop WebViews.',
      'Run npm run test:e2e for the mocked web harness and use the release checklist for macOS desktop smoke.',
    ].join('\n'));
  }

  if (!isWindows && !isLinux) {
    throw new Error(`Unsupported platform for the Tauri desktop smoke test: ${process.platform}`);
  }
}

function assertNativeDriver() {
  if (isWindows) {
    return resolveExecutable(
      'msedgedriver',
      'TAURI_NATIVE_DRIVER',
    );
  }

  return resolveExecutable(
    'WebKitWebDriver',
    'TAURI_NATIVE_DRIVER',
  );
}

function assertPrerequisites() {
  assertPlatformSupport();

  const missing = [];
  resolvedTauriDriverPath = resolveExecutable('tauri-driver', 'TAURI_DRIVER');
  if (!resolvedTauriDriverPath) {
    missing.push(missingExecutableMessage(
      'tauri-driver',
      'TAURI_DRIVER',
      'cargo install tauri-driver --locked',
    ));
  }

  resolvedNativeDriverPath = assertNativeDriver();
  if (!resolvedNativeDriverPath) {
    missing.push(isWindows
      ? missingExecutableMessage(
        'msedgedriver',
        'TAURI_NATIVE_DRIVER',
        'Download the Microsoft Edge WebDriver matching your Edge version, or run: cargo install --git https://github.com/chippers/msedgedriver-tool && msedgedriver-tool',
      )
      : missingExecutableMessage(
        'WebKitWebDriver',
        'TAURI_NATIVE_DRIVER',
        'Install webkit2gtk-driver. On Ubuntu: sudo apt-get install -y webkit2gtk-driver xvfb',
      ));
  }

  if (missing.length > 0) {
    throw new Error(missing.join('\n\n'));
  }
}

function startTauriDriver() {
  if (!resolvedTauriDriverPath || !resolvedNativeDriverPath) {
    assertPrerequisites();
  }

  tauriDriverProcess = spawn(
    resolvedTauriDriverPath,
    ['--native-driver', resolvedNativeDriverPath],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  tauriDriverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[tauri-driver] ${data}`);
  });
  tauriDriverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[tauri-driver] ${data}`);
  });
  tauriDriverProcess.on('exit', (code, signal) => {
    if (!tauriDriverProcess) return;
    if (code !== 0 && code !== null) {
      process.stderr.write(`[tauri-driver] exited with code ${code}\n`);
    } else if (signal) {
      process.stderr.write(`[tauri-driver] exited with signal ${signal}\n`);
    }
  });
}

function stopTauriDriver() {
  if (!tauriDriverProcess || tauriDriverProcess.killed) return;
  tauriDriverProcess.kill();
  tauriDriverProcess = undefined;
}

exports.config = {
  runner: 'local',
  specs: ['./tests/tauri-e2e/**/*.tauri.e2e.cjs'],
  protocol: 'http',
  host: '127.0.0.1',
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  maxInstances: 1,
  logLevel: 'warn',
  bail: 1,
  waitforTimeout: 60_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
  capabilities: [{
    'tauri:options': {
      application: appPath,
    },
  }],

  onPrepare() {
    assertPrerequisites();
    runCommand(npxCommand, ['vite', 'build']);
    runCommand('cargo', ['build', '--features', 'custom-protocol'], path.join(rootDir, 'src-tauri'));

    if (!fs.existsSync(appPath)) {
      throw new Error(`Tauri debug binary was not found after build: ${appPath}`);
    }
  },

  beforeSession() {
    startTauriDriver();
  },

  afterSession() {
    stopTauriDriver();
  },

  onComplete() {
    stopTauriDriver();
  },
};

process.once('exit', stopTauriDriver);
process.once('SIGINT', () => {
  stopTauriDriver();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopTauriDriver();
  process.exit(143);
});
