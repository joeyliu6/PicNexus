import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { assertAllowedExternalUrl } from './networkPolicy';

const TRUSTED_EXTERNAL_URLS = [
  /^https:\/\/github\.com\/joeyliu6\/PicNexus(?:\/.*)?$/i,
  /^https:\/\/sm\.ms\/home\/apitoken(?:\?.*)?$/i,
  /^https:\/\/github\.com\/settings\/tokens\/new(?:\?.*)?$/i,
  /^https:\/\/api\.imgur\.com\/oauth2\/addclient(?:\?.*)?$/i,
];

export async function openTrustedExternalUrl(url: string): Promise<void> {
  assertAllowedExternalUrl(url);
  if (!TRUSTED_EXTERNAL_URLS.some(pattern => pattern.test(url))) {
    throw new Error('该链接不在安全外链白名单中');
  }
  await open(url);
}

export async function openUserExternalUrl(url: string): Promise<void> {
  assertAllowedExternalUrl(url);
  await invoke('open_path', { path: url });
}
