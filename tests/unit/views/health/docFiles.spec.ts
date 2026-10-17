// 文档读写：先备份再替换、非 UTF-8 不碰、BOM 补回、同名文件备份不互相覆盖、撤销时改过的不还原、失败原因
import { beforeEach, describe, expect, it } from 'vitest';
import { getFsMocks, resetTauriMocks, utf8Bytes } from '../../helpers/tauriMock';
import { describeDocError, relativeToFolder, restoreDocs, writeDocs } from '@/views/health/docFiles';
import type { DocWrite } from '@/views/health/docIndex';

const OLD = 'https://weibo.example/a.png';
const NEW = 'https://jd.example/a.png';

function write(path: string, folder = 'C:/docs'): DocWrite {
  return { folder, path, name: path.split(/[/\\]/).pop()!, replacements: new Map([[OLD, NEW]]), places: 1 };
}

const STAMP = new Date(2026, 9, 17, 9, 30, 5);

describe('writeDocs', () => {
  beforeEach(() => resetTauriMocks());

  it('先备份到 文件夹/.picnexus-backup/时间戳/相对路径，再写回替换后的内容', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${OLD})`));

    const outcome = await writeDocs([write('C:/docs/blog/a.md')], STAMP);

    expect(fs.copyFile).toHaveBeenCalledWith('C:/docs/blog/a.md', 'C:/docs/.picnexus-backup/20261017_093005/blog/a.md');
    expect(fs.writeTextFile).toHaveBeenCalledWith('C:/docs/blog/a.md', `![](${NEW})`);
    expect(outcome.written).toEqual([{ path: 'C:/docs/blog/a.md', backup: 'C:/docs/.picnexus-backup/20261017_093005/blog/a.md', content: `![](${NEW})`, places: 1 }]);
    expect(outcome.failed).toEqual([]);
  });

  it('非 UTF-8 不备份、不写回，原因写清', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]));

    const outcome = await writeDocs([write('C:/docs/gbk.md')], STAMP);

    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(outcome.failed[0].message).toBe('gbk.md 编码不受支持（非 UTF-8），已跳过');
  });

  it('原文件带 BOM 写回时补回', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${OLD})`, true));
    const outcome = await writeDocs([write('C:/docs/bom.md')], STAMP);
    expect(fs.writeTextFile).toHaveBeenCalledWith('C:/docs/bom.md', `\uFEFF![](${NEW})`);
    expect(outcome.written[0].content).toBe(`![](${NEW})`);
  });

  it('替换后内容没变（链接在代码块里等）就不备份也不写', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes('```\n![](https://weibo.example/a.png)\n```'));
    const outcome = await writeDocs([write('C:/docs/code.md')], STAMP);
    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(outcome.written).toEqual([]);
  });

  it('Windows verbatim 路径也算得出相对路径；算不出时退回 hash 前缀，同名文件备份互不覆盖', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${OLD})`));
    await writeDocs([
      write('\\\\?\\C:\\docs\\a\\README.md', '\\\\?\\C:\\docs'),
      write('E:/x/README.md', 'D:/other'),
      write('E:/y/README.md', 'D:/other'),
    ], STAMP);
    const backups = fs.copyFile.mock.calls.map((call) => call[1] as string);
    expect(backups[0]).toMatch(/\/a\/README\.md$/);
    expect(backups[1]).toMatch(/\/[0-9a-f]{8}_README\.md$/);
    expect(new Set(backups).size).toBe(3);
  });

  it('一个文档写不成，其余照常', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${OLD})`));
    fs.writeTextFile.mockRejectedValueOnce(new Error('The process cannot access the file because it is being used by another process. (os error 32)'));
    const outcome = await writeDocs([write('C:/docs/README.md'), write('C:/docs/b.md')], STAMP);
    expect(outcome.failed.map((f) => f.message)).toEqual(['README.md 被其他程序占用，请关闭后重试']);
    expect(outcome.written.map((w) => w.path)).toEqual(['C:/docs/b.md']);
  });
});

describe('restoreDocs', () => {
  beforeEach(() => resetTauriMocks());

  it('内容还是修复时写进去的那份：按备份还原', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${NEW})`));
    const outcome = await restoreDocs([{ path: 'C:/docs/a.md', backup: 'C:/docs/.picnexus-backup/x/a.md', content: `![](${NEW})`, places: 1 }]);
    expect(fs.copyFile).toHaveBeenCalledWith('C:/docs/.picnexus-backup/x/a.md', 'C:/docs/a.md');
    expect(outcome.restored).toEqual(['C:/docs/a.md']);
  });

  it('修复后又被改过：不还原，免得把用户的新改动盖掉', async () => {
    const fs = getFsMocks();
    fs.readFile.mockResolvedValue(utf8Bytes(`![](${NEW})\n新写的一段`));
    const outcome = await restoreDocs([{ path: 'C:/docs/a.md', backup: 'b', content: `![](${NEW})`, places: 1 }]);
    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(outcome.modified).toEqual(['C:/docs/a.md']);
  });
});

describe('describeDocError', () => {
  it('被占用 / 没有写入权限 / 找不到了 / 其他', () => {
    expect(describeDocError('a.md', new Error('Access is denied. (os error 5)'))).toBe('a.md 没有写入权限，请检查文件权限后重试');
    expect(describeDocError('a.md', 'forbidden path: C:/x')).toBe('a.md 没有写入权限，请检查文件权限后重试');
    expect(describeDocError('a.md', new Error('The system cannot find the file specified. (os error 2)'))).toBe('a.md 找不到了，可能已被移动或删除');
    expect(describeDocError('a.md', new Error('disk full'))).toBe('a.md 写入失败，请稍后重试');
  });
});

describe('relativeToFolder', () => {
  it('大小写不同也认得出前缀', () => {
    expect(relativeToFolder('C:\\Users\\Foo', 'c:\\users\\foo\\notes\\a.md')).toBe('notes/a.md');
    expect(relativeToFolder('D:/x', 'C:/y/a.md')).toBeNull();
  });
});
