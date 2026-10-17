import { describe, expect, it } from 'vitest';
import { SETTING_COMMANDS } from '@/shell/commandIndex';
import { SETTING_ROWS, SETTINGS_GROUPS, groupForTab, rowForSection } from '@/views/settings/settingsGroups';

describe('settingsGroups', () => {
  it('每个命令面板设置项都指向设置页真有的一行，且「设置 › 分组」写对了', () => {
    for (const command of SETTING_COMMANDS) {
      const section = (command.target as { section: string }).section;
      const row = rowForSection(section);
      expect(row, section).not.toBeNull();
      const group = SETTINGS_GROUPS.find((g) => g.id === SETTING_ROWS[row!])!;
      expect(command.sub).toBe(`设置 › ${group.name}`);
    }
  });

  it('托盘、首页还在用的旧 tab 名照旧认', () => {
    expect(groupForTab('compression')).toBe('upload');
    expect(groupForTab('advanced')).toBe('upload');
    expect(groupForTab('general')).toBe('general');
    expect(groupForTab('backup')).toBe('backup');
    expect(groupForTab('hosting')).toBeNull();
    expect(rowForSection('imageCompression')).toBe('compression');
  });
});
