import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RUNTIME_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

const REQUIRED_REPOSITORY_FILES = [
  ...RUNTIME_ASSETS,
  'README.md',
  'LICENSE',
  'versions.json',
  'package.json',
  'package-lock.json',
];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const PLUGIN_ID_PATTERN = /^[a-z][a-z-]*[a-z]$/;
const MAX_RUNTIME_BYTES = 10 * 1024 * 1024;

function readJson(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateManifest(manifest, errors) {
  if (!manifest) return;

  if (manifest.id !== 'picnexus') {
    errors.push('manifest.json id must be "picnexus".');
  }
  if (!PLUGIN_ID_PATTERN.test(manifest.id ?? '')) {
    errors.push('manifest.json id must contain only lowercase letters and hyphens.');
  }
  if ((manifest.id ?? '').includes('obsidian')) {
    errors.push('manifest.json id must not contain "obsidian".');
  }
  if ((manifest.id ?? '').endsWith('plugin')) {
    errors.push('manifest.json id must not end with "plugin".');
  }
  if (!SEMVER_PATTERN.test(manifest.version ?? '')) {
    errors.push('manifest.json version must use x.y.z without a v prefix.');
  }
  if (!SEMVER_PATTERN.test(manifest.minAppVersion ?? '')) {
    errors.push('manifest.json minAppVersion must use x.y.z.');
  }
  if (typeof manifest.description !== 'string' || manifest.description.length === 0) {
    errors.push('manifest.json description is required.');
  } else {
    if (manifest.description.length > 250) {
      errors.push('manifest.json description must be 250 characters or fewer.');
    }
    if (!manifest.description.endsWith('.')) {
      errors.push('manifest.json description must end with a period.');
    }
    if (!/^[\x20-\x7e]+$/.test(manifest.description)) {
      errors.push('manifest.json description must use basic printable Latin characters.');
    }
  }
  if (manifest.isDesktopOnly !== true) {
    errors.push('manifest.json isDesktopOnly must be true because PicNexus requires the desktop app.');
  }
  if (typeof manifest.author !== 'string' || manifest.author.trim().length === 0) {
    errors.push('manifest.json author is required.');
  }
  try {
    const authorUrl = new URL(manifest.authorUrl);
    if (!['http:', 'https:'].includes(authorUrl.protocol)) throw new Error('unsupported protocol');
  } catch {
    errors.push('manifest.json authorUrl must be a valid HTTP(S) URL.');
  }
}

function validateRepositoryFiles(pluginDir, errors) {
  for (const name of REQUIRED_REPOSITORY_FILES) {
    const filePath = resolve(pluginDir, name);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      errors.push(`Required repository file is missing: ${name}`);
    }
  }

  let runtimeBytes = 0;
  for (const name of RUNTIME_ASSETS) {
    const filePath = resolve(pluginDir, name);
    if (!existsSync(filePath)) continue;
    const size = statSync(filePath).size;
    runtimeBytes += size;
    if (size === 0) errors.push(`Runtime asset is empty: ${name}`);
  }
  if (runtimeBytes > MAX_RUNTIME_BYTES) {
    errors.push(`Runtime assets exceed ${MAX_RUNTIME_BYTES} bytes in total.`);
  }
}

function validateVersionFiles(pluginDir, manifest, errors) {
  if (!manifest) return;

  const packageJson = readJson(resolve(pluginDir, 'package.json'), 'package.json', errors);
  const packageLock = readJson(resolve(pluginDir, 'package-lock.json'), 'package-lock.json', errors);
  const versions = readJson(resolve(pluginDir, 'versions.json'), 'versions.json', errors);

  if (packageJson && packageJson.version !== manifest.version) {
    errors.push('package.json version must match manifest.json version.');
  }
  if (packageLock && packageLock.version !== manifest.version) {
    errors.push('package-lock.json version must match manifest.json version.');
  }
  if (packageLock?.packages?.['']?.version !== manifest.version) {
    errors.push('package-lock.json root package version must match manifest.json version.');
  }
  if (versions && versions[manifest.version] !== manifest.minAppVersion) {
    errors.push('versions.json must map the current plugin version to minAppVersion.');
  }

  const readmePath = resolve(pluginDir, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    if (!readme.includes('127.0.0.1')) {
      errors.push('README.md must disclose the localhost network connection.');
    }
  }
}

export function validateObsidianRelease(pluginDirectory = 'plugins/picnexus') {
  const pluginDir = resolve(pluginDirectory);
  const errors = [];

  validateRepositoryFiles(pluginDir, errors);
  const manifestPath = resolve(pluginDir, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? readJson(manifestPath, 'manifest.json', errors)
    : null;

  validateManifest(manifest, errors);
  validateVersionFiles(pluginDir, manifest, errors);

  if (errors.length > 0) {
    throw new Error(`Obsidian release validation failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    id: manifest.id,
    version: manifest.version,
    minAppVersion: manifest.minAppVersion,
    pluginDir,
    assets: [...RUNTIME_ASSETS],
  };
}

function runCli() {
  const args = process.argv.slice(2);
  const printVersion = args.includes('--print-version');
  const pluginDir = args.find(arg => !arg.startsWith('--')) ?? 'plugins/picnexus';

  try {
    const result = validateObsidianRelease(pluginDir);
    process.stdout.write(printVersion ? `${result.version}\n` : `${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli();
}
