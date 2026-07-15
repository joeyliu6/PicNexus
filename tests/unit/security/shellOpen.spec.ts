import { beforeEach, describe, expect, it } from 'vitest';
import { getInvokeMock, getShellOpenMock, resetTauriMocks } from '../helpers/tauriMock';
import { openTrustedExternalUrl, openUserExternalUrl } from '@/security/shellOpen';

describe('shellOpen security wrapper', () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it('opens only trusted static links through the shell plugin', async () => {
    await openTrustedExternalUrl('https://github.com/joeyliu6/PicNexus/releases/latest');

    expect(getShellOpenMock()).toHaveBeenCalledWith('https://github.com/joeyliu6/PicNexus/releases/latest');
    await expect(openTrustedExternalUrl('https://example.com')).rejects.toThrow('白名单');
  });

  it('routes user URLs through the Rust open_path validator', async () => {
    await openUserExternalUrl('https://cdn.example.com/a.png');

    expect(getInvokeMock()).toHaveBeenCalledWith('open_path', { path: 'https://cdn.example.com/a.png' });
    await expect(openUserExternalUrl('http://example.com/a.png')).rejects.toThrow('外部 HTTP');
  });
});
