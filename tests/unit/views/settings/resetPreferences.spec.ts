import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { resetPreferences } from '@/views/settings/resetPreferences';

describe('resetPreferences', () => {
  const mine: UserConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    enabledServices: ['r2'],
    availableServices: ['jd', 'r2'],
    services: { r2: { enabled: true, accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', path: '', publicDomain: 'https://img.example.com' } },
    webdav: { profiles: [{ id: 'p', name: '坚果云', url: 'https://dav.example.com', username: 'u', passwordEncrypted: 'x', remotePath: '/PicNexus/' }], activeId: 'p' },
    linkOutput: { defaultFormat: 'markdown', customTemplate: '<img src="{url}">', autoCopy: false, copyFromService: 'r2' },
    theme: { mode: 'dark', enableTransitions: false, transitionDuration: 300, homeDecor: false },
    editorServer: { ...DEFAULT_CONFIG.editorServer!, enabled: true, port: 40000, authToken: 'token' },
    linkHealth: { docFolders: ['D:/notes'], autoCheck: { enabled: false, intervalDays: 30 } },
    onboardingCompleted: true,
  };

  it('puts preferences back to the factory values', () => {
    const reset = resetPreferences(mine);
    expect(reset.linkOutput).toEqual(DEFAULT_CONFIG.linkOutput);
    expect(reset.theme).toEqual(DEFAULT_CONFIG.theme);
    expect(reset.editorServer?.port).toBe(DEFAULT_CONFIG.editorServer!.port);
    expect(reset.linkHealth?.autoCheck).toEqual(DEFAULT_CONFIG.linkHealth!.autoCheck);
  });

  it('keeps host accounts, the sync connection, document folders, the onboarding flag and the editor token', () => {
    const reset = resetPreferences(mine);
    expect(reset.services).toEqual(mine.services);
    expect(reset.enabledServices).toEqual(['r2']);
    expect(reset.availableServices).toEqual(['jd', 'r2']);
    expect(reset.webdav).toEqual(mine.webdav);
    expect(reset.linkHealth?.docFolders).toEqual(['D:/notes']);
    expect(reset.onboardingCompleted).toBe(true);
    expect(reset.editorServer?.authToken).toBe('token');
  });
});
