import { describe, expect, it } from 'vitest';
import { copyHint, indexRowsByHistory, promotableBackup, siblingRows, thumbnailCopyOrder } from '@/composables/link-check/rowCopies';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';

const ok = () => createCheckLinkResult({ is_valid: true });
const dead = () => createCheckLinkResult({ is_valid: false, error_type: 'http_5xx', status_code: 502 });

function hintFor(rows: ReturnType<typeof createLinkCheckRow>[], target = rows[0]) {
  const index = indexRowsByHistory(rows);
  return copyHint(target, siblingRows(target, index));
}

describe('rowCopies', () => {
  it('按 historyId 分组，siblingRows 不含自己', () => {
    const a = createLinkCheckRow({ historyId: 'h1', serviceId: 'jd' });
    const b = createLinkCheckRow({ historyId: 'h1', serviceId: 'qiyu' });
    const c = createLinkCheckRow({ historyId: 'h2', serviceId: 'jd' });
    const index = indexRowsByHistory([a, b, c]);
    expect(siblingRows(a, index)).toEqual([b]);
    expect(siblingRows(c, index)).toEqual([]);
  });

  it('坏了但其他图床都正常 → 绿色「其他图床正常」', () => {
    const rows = [
      createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:a', checkResult: dead() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'qiyu', checkResult: ok() }),
    ];
    expect(hintFor(rows)).toMatchObject({ text: '其他图床正常', tone: 'ok' });
  });

  it('部分备份可用 → 报可用数量', () => {
    const rows = [
      createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:a', checkResult: dead() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:b', checkResult: dead() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() }),
    ];
    expect(hintFor(rows)).toMatchObject({ text: '1 个备份可用', tone: 'ok' });
  });

  it('只有这一份 → 红色「无备份」', () => {
    const rows = [createLinkCheckRow({ historyId: 'h', checkResult: dead() })];
    expect(hintFor(rows)).toMatchObject({ text: '无备份', tone: 'error' });
  });

  it('备份全坏 → 红色「备份也失效」；有备份还没检测 → 不下结论', () => {
    const allDead = [
      createLinkCheckRow({ historyId: 'h', serviceId: 'a', checkResult: dead() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'b', checkResult: dead() }),
    ];
    expect(hintFor(allDead)).toMatchObject({ text: '备份也失效', tone: 'error' });

    const pending = [
      createLinkCheckRow({ historyId: 'h', serviceId: 'a', checkResult: dead() }),
      createLinkCheckRow({ historyId: 'h', serviceId: 'b' }),
    ];
    expect(hintFor(pending)).toBeNull();
  });

  it('正常、未检测、防盗链的行不提示', () => {
    const hotlink = createCheckLinkResult({ is_valid: false, status_code: 403, browser_might_work: true });
    for (const checkResult of [ok(), undefined, hotlink]) {
      expect(hintFor([createLinkCheckRow({ historyId: 'h', checkResult })])).toBeNull();
    }
  });

  it('单条重检结果优先于批量结果', () => {
    const row = createLinkCheckRow({ historyId: 'h', checkResult: dead(), recheckResult: ok() });
    expect(hintFor([row])).toBeNull();
  });

  it('缩略图优先用能访问的副本，坏的垫底', () => {
    const self = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:a', checkResult: dead() });
    const deadSibling = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:b', checkResult: dead() });
    const unchecked = createLinkCheckRow({ historyId: 'h', serviceId: 'zhihu' });
    const alive = createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() });
    const order = thumbnailCopyOrder(self, [deadSibling, unchecked, alive]);
    expect(order.map((r) => r.serviceId)).toEqual(['jd', 'webdav:a', 'zhihu', 'webdav:b']);
  });

  it('只有坏掉的主链接才建议改用备份，且取第一个可用的', () => {
    const primary = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:a', isPrimary: true, checkResult: dead() });
    const deadSibling = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:b', checkResult: dead() });
    const jd = createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() });
    const qiyu = createLinkCheckRow({ historyId: 'h', serviceId: 'qiyu', checkResult: ok() });
    expect(promotableBackup(primary, [deadSibling, jd, qiyu])?.serviceId).toBe('jd');

    const nonPrimary = { ...primary, isPrimary: false };
    expect(promotableBackup(nonPrimary, [jd])).toBeUndefined();

    const healthy = { ...primary, checkResult: ok() };
    expect(promotableBackup(healthy, [jd])).toBeUndefined();

    const hotlink = { ...primary, checkResult: createCheckLinkResult({ is_valid: false, status_code: 403, browser_might_work: true }) };
    expect(promotableBackup(hotlink, [jd])).toBeUndefined();

    expect(promotableBackup(primary, [deadSibling])).toBeUndefined();
  });
});

