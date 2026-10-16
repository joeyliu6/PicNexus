import { describe, expect, it } from 'vitest';
import { resolveNavigateTarget } from '@/shell/navigatePayload';

describe('resolveNavigateTarget', () => {
  it('maps the legacy view names to the new pages', () => {
    expect(resolveNavigateTarget('upload')).toEqual({ path: '/home' });
    expect(resolveNavigateTarget('history')).toEqual({ path: '/gallery' });
    expect(resolveNavigateTarget('link-check')).toEqual({ path: '/health' });
    expect(resolveNavigateTarget('settings')).toEqual({ path: '/settings' });
  });

  it('sends the hosting tab to the hosts page and keeps the section', () => {
    expect(resolveNavigateTarget({ view: 'settings', tab: 'hosting', section: 'weibo' }))
      .toEqual({ path: '/hosts', settingsSection: 'weibo' });
  });

  it('passes other settings tabs and sections through', () => {
    expect(resolveNavigateTarget({ view: 'settings', tab: 'compression', section: 'imageCompression' }))
      .toEqual({ path: '/settings', settingsTab: 'compression', settingsSection: 'imageCompression' });
  });

  it('passes the link-check tab through', () => {
    expect(resolveNavigateTarget({ view: 'link-check', tab: 'rescue' })).toEqual({ path: '/health', linkCheckTab: 'rescue' });
  });

  it('ignores unknown or malformed payloads', () => {
    expect(resolveNavigateTarget('nowhere')).toBeNull();
    expect(resolveNavigateTarget({ view: 42 })).toBeNull();
    expect(resolveNavigateTarget(null)).toBeNull();
  });
});
