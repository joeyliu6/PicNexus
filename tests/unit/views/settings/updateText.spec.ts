import { describe, expect, it } from 'vitest';
import { downloadSize, releaseNotes, updateFailureTitle } from '@/views/settings/updateText';

describe('updateText', () => {
  it('lists the bullet lines of the release notes, plain text, at most six', () => {
    const body = '## [1.2.0]\n- **图库**支持按健康状态筛选\n* 补充备份支持 `仅处理`失效的图片\n说明段落不算\n- 3\n- 4\n- 5\n- 6\n- 7';
    expect(releaseNotes(body)).toEqual(['图库支持按健康状态筛选', '补充备份支持 仅处理失效的图片', '3', '4', '5', '6']);
  });

  it('writes 更新失败：reason, without doubling a reason that already says 失败', () => {
    expect(updateFailureTitle('下载被中断')).toBe('更新失败：下载被中断');
    expect(updateFailureTitle('检查更新失败')).toBe('检查更新失败');
  });

  it('writes the download size like 11 / 18 MB', () => {
    const MB = 1024 * 1024;
    expect(downloadSize(11 * MB, 18 * MB)).toBe('11 / 18 MB');
    expect(downloadSize(2.5 * MB, 8 * MB)).toBe('2.5 / 8.0 MB');
  });
});
