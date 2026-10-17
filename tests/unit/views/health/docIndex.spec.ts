// 文档索引：文档里的链接对上哪张图的哪一份、「用于 N 个文档」、修复时每个文档换哪几条
import { describe, expect, it } from 'vitest';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { buildHealthImages } from '@/views/health/healthModel';
import { buildDocIndex, docProblems, planDocWrites, problemDetail, type ScannedFolder } from '@/views/health/docIndex';

const ok: CheckLinkResult = { link: '', is_valid: true, error_type: 'success', browser_might_work: false, response_time: 100 };
const gone: CheckLinkResult = { link: '', is_valid: false, error_type: 'http_4xx', status_code: 404, browser_might_work: false };

function row(historyId: string, serviceId: string, result: CheckLinkResult | undefined, isPrimary = false, url = `https://${serviceId}.example/${historyId}.png`): LinkCheckRow {
  return { historyId, serviceId, url, rawUrl: url.replace('https://proxy.example/', ''), fileName: `${historyId}.png`, uploadedAt: 1, isPrimary, checkResult: result, checkedAt: result ? 1 : undefined };
}

/** 去掉代理前缀：https://proxy.example/<原链接> */
const strip = (url: string) => url.replace('https://proxy.example/', '');

const images = buildHealthImages([
  // a：微博失效（文档里写的是加了代理前缀的那条），京东可用
  row('a', 'weibo', gone, true, 'https://proxy.example/https://weibo.example/a.png'),
  row('a', 'jd', ok),
  // b：只有微博一份，失效
  row('b', 'weibo', gone, true),
  // c：正常
  row('c', 'jd', ok, true),
]);

const folders: ScannedFolder[] = [{
  folder: 'D:\\Notes',
  docs: [
    { filePath: 'D:\\Notes\\blog\\2025.md', fileName: '2025.md', links: [
      { url: 'https://proxy.example/https://weibo.example/a.png', lineNumber: 3 },
      { url: ' https://weibo.example/a.png ', lineNumber: 9 },
      { url: 'https://weibo.example/b.png', lineNumber: 12 },
    ] },
    { filePath: 'D:\\Notes\\README.md', fileName: 'README.md', links: [
      { url: 'https://jd.example/c.png', lineNumber: 1 },
      { url: 'https://elsewhere.example/x.png', lineNumber: 2 },
    ] },
    { filePath: 'D:\\Notes\\empty.md', fileName: 'empty.md', links: [] },
  ],
}];

const index = buildDocIndex(folders, images, strip);
const urlOf = (imageId: string, host: string) => images.find((i) => i.id === imageId)?.copies.find((c) => c.host === host)?.row.url;

describe('buildDocIndex', () => {
  it('原始链接、加前缀的链接都对得上；别处来的图片不计入', () => {
    expect(index.refs.map((r) => [r.imageId, r.host, r.line])).toEqual([
      ['a', 'weibo', 3], ['a', 'weibo', 9], ['b', 'weibo', 12], ['c', 'jd', 1],
    ]);
    expect(index.docCount).toBe(3);
  });

  it('「用于 N 个文档」按文档数，同一文档多处只算一个', () => {
    expect(index.docsByImage.get('a')?.size).toBe(1);
    expect(index.docsByImage.get('c')?.size).toBe(1);
    expect(index.docsByImage.has('missing')).toBe(false);
  });
});

describe('planDocWrites', () => {
  it('失效的那几处换成可用的那份，无可用备份的保持原样', () => {
    const [write] = planDocWrites(index, images, urlOf);
    expect(write.path).toBe('D:\\Notes\\blog\\2025.md');
    expect([...write.replacements]).toEqual([
      ['https://proxy.example/https://weibo.example/a.png', 'https://jd.example/a.png'],
      ['https://weibo.example/a.png', 'https://jd.example/a.png'],
    ]);
    expect(write.places).toBe(2);
  });

  it('只修指定的几张图', () => {
    expect(planDocWrites(index, images, urlOf, new Set(['c']))).toEqual([]);
  });

  it('文档引用的旧备份失效、这张图在用的那份正常：换成在用的那份', () => {
    const switched = buildHealthImages([row('a', 'weibo', gone), row('a', 'jd', ok, true)]);
    const idx = buildDocIndex([{ folder: 'D:\\N', docs: [{ filePath: 'D:\\N\\x.md', fileName: 'x.md', links: [{ url: 'https://weibo.example/a.png', lineNumber: 1 }] }] }], switched, strip);
    const writes = planDocWrites(idx, switched, (id, host) => switched[0].copies.find((c) => c.host === host)?.row.url);
    expect([...writes[0].replacements.values()]).toEqual(['https://jd.example/a.png']);
  });
});

describe('docProblems', () => {
  it('列出有失效引用的文档：几处失效、几处可替换', () => {
    const [problem] = docProblems(index, images);
    expect(problem).toMatchObject({ name: '2025.md', dead: 3, fixable: 2 });
    expect(problemDetail(problem)).toBe('3 处失效，2 处可替换');
  });

  it('说法：均可替换 / 可替换 / 无可用备份', () => {
    const base = { folder: '', path: '', name: '' };
    expect(problemDetail({ ...base, dead: 2, fixable: 2 })).toBe('2 处失效，均可替换');
    expect(problemDetail({ ...base, dead: 1, fixable: 1 })).toBe('1 处失效，可替换');
    expect(problemDetail({ ...base, dead: 1, fixable: 0 })).toBe('1 处失效，无可用备份');
  });
});
