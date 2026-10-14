import { describe, expect, it } from 'vitest';
import {
  describeImage,
  groupRowsByImage,
  imageKind,
  isLostForGood,
  linkVerdict,
  promoteTarget,
  summarizeImages,
} from '@/composables/link-check/imageHealth';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';

/** 工厂会给缺省的 status_code 补 404；超时、连不上这类结果没有状态码，要显式抹掉 */
function bad(overrides: Partial<CheckLinkResult>): CheckLinkResult {
  return { ...createCheckLinkResult({ is_valid: false, ...overrides }), status_code: overrides.status_code };
}

const ok = () => createCheckLinkResult({ is_valid: true });
const gone = () => bad({ error_type: 'http_4xx', status_code: 404 });
const timeout = () => bad({ error_type: 'timeout' });
const hotlink = () => bad({ error_type: 'http_4xx', status_code: 403, browser_might_work: true });
const redirect = () => bad({ error_type: 'redirect', status_code: 302, browser_might_work: true });

const NAMES: Record<string, string> = {
  weibo: '微博',
  jd: '京东',
  nami: '纳米',
  r2: 'Cloudflare R2',
  github: 'GitHub',
  qiyu: '七鱼',
};
const nameOf = (serviceId: string) => NAMES[serviceId] ?? serviceId;

function row(serviceId: string, checkResult?: CheckLinkResult, extra: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return createLinkCheckRow({ historyId: 'h', serviceId, checkResult, ...extra });
}

/** 一张图：第一份是主链接 */
function image(...rows: LinkCheckRow[]) {
  rows.forEach((r, i) => { r.isPrimary = i === 0; });
  return groupRowsByImage(rows)[0];
}

describe('linkVerdict', () => {
  it('只分用户能据此行动的几类', () => {
    expect(linkVerdict(undefined)).toBe('unchecked');
    expect(linkVerdict(ok())).toBe('ok');
    expect(linkVerdict(hotlink())).toBe('limited');
    expect(linkVerdict(redirect())).toBe('limited');
    expect(linkVerdict(gone())).toBe('gone');
    expect(linkVerdict(bad({ error_type: 'http_4xx', status_code: 410 }))).toBe('gone');
  });

  it('原因可能是暂时的、或说不清图还在不在的，都算 failing，不算 gone', () => {
    const failing: Array<Partial<CheckLinkResult>> = [
      { error_type: 'timeout' },
      { error_type: 'network' },
      { error_type: 'http_5xx', status_code: 502 },
      { error_type: 'http_4xx', status_code: 429 },
      { error_type: 'http_4xx', status_code: 403 },
      { error_type: 'http_4xx', status_code: 401 },
      { error_type: 'suspicious', status_code: 200 },
      { error_type: 'blocked' },
    ];
    for (const overrides of failing) {
      expect(linkVerdict(bad(overrides))).toBe('failing');
    }
  });

  it('只有图床亲口回了 404 / 410 才算不在了：超时之类结果带着旧状态码也不算（清理记录靠它把关）', () => {
    expect(linkVerdict(bad({ error_type: 'timeout', status_code: 404 }))).toBe('failing');
    expect(linkVerdict(bad({ error_type: 'network', status_code: 410 }))).toBe('failing');
  });
});

describe('groupRowsByImage', () => {
  it('按图片分组，保持首次出现的顺序；主链接排第一，其余按记录顺序', () => {
    const a1 = createLinkCheckRow({ historyId: 'a', serviceId: 'weibo' });
    const b1 = createLinkCheckRow({ historyId: 'b', serviceId: 'jd', isPrimary: true });
    const a2 = createLinkCheckRow({ historyId: 'a', serviceId: 'jd', isPrimary: true });
    const a3 = createLinkCheckRow({ historyId: 'a', serviceId: 'qiyu' });

    const entries = groupRowsByImage([a1, b1, a2, a3]);

    expect(entries.map((e) => e.historyId)).toEqual(['a', 'b']);
    expect(entries[0].rows).toEqual([a2, a1, a3]);
    expect(entries[1].rows).toEqual([b1]);
  });

  it('没有标主链接时按记录顺序；标了两个时第一个算数', () => {
    const x = createLinkCheckRow({ historyId: 'a', serviceId: 'weibo' });
    const y = createLinkCheckRow({ historyId: 'a', serviceId: 'jd' });
    expect(groupRowsByImage([x, y])[0].rows).toEqual([x, y]);

    const p1 = createLinkCheckRow({ historyId: 'c', serviceId: 'weibo', isPrimary: true });
    const p2 = createLinkCheckRow({ historyId: 'c', serviceId: 'jd', isPrimary: true });
    expect(groupRowsByImage([p1, p2])[0].rows).toEqual([p1, p2]);
  });
});

describe('imageKind', () => {
  it('主链接没检查过 → 未检查（备份查没查过都一样）', () => {
    expect(imageKind(image(row('weibo'), row('jd', ok())))).toBe('unchecked');
  });

  it('主链接正常：备份都好 / 没查 / 受限 → 正常；有备份坏了 → 备份失效', () => {
    expect(imageKind(image(row('jd', ok())))).toBe('ok');
    expect(imageKind(image(row('jd', ok()), row('weibo'), row('qiyu', hotlink())))).toBe('ok');
    expect(imageKind(image(row('jd', ok()), row('weibo', gone())))).toBe('backup-broken');
    expect(imageKind(image(row('jd', ok()), row('weibo', timeout())))).toBe('backup-broken');
  });

  it('主链接受限（防盗链 / 跳转）→ 受限，不算打不开', () => {
    expect(imageKind(image(row('weibo', hotlink()), row('jd', ok())))).toBe('limited');
    expect(imageKind(image(row('weibo', redirect())))).toBe('limited');
  });

  it('主链接打不开：有能用的备份 → 可修复；没有 → 打不开', () => {
    expect(imageKind(image(row('weibo', gone()), row('jd', ok())))).toBe('fixable');
    expect(imageKind(image(row('r2', timeout()), row('jd', ok())))).toBe('fixable');
    expect(imageKind(image(row('nami', gone())))).toBe('broken');
    expect(imageKind(image(row('weibo', gone()), row('jd', gone())))).toBe('broken');
    expect(imageKind(image(row('weibo', gone()), row('jd')))).toBe('broken');
    expect(imageKind(image(row('weibo', gone()), row('jd', hotlink())))).toBe('broken');
  });

  it('默认只看已落定的结果；单条重检的临时结果要显式传入才算', () => {
    const entry = image(row('weibo', gone(), { recheckResult: ok() }), row('jd', ok()));
    expect(imageKind(entry)).toBe('fixable');
    expect(imageKind(entry, (r) => r.recheckResult ?? r.checkResult)).toBe('ok');
  });
});

describe('promoteTarget', () => {
  it('主链接打不开时，按记录顺序取第一份能用的备份', () => {
    const first = row('qiyu', ok());
    const entry = image(row('weibo', gone()), row('nami', gone()), first, row('jd', ok()));
    expect(promoteTarget(entry)).toBe(first);
  });

  it('主链接正常 / 受限 / 没检查，或没有能用的备份 → 不建议改用', () => {
    expect(promoteTarget(image(row('jd', ok()), row('weibo', ok())))).toBeUndefined();
    expect(promoteTarget(image(row('weibo', hotlink()), row('jd', ok())))).toBeUndefined();
    expect(promoteTarget(image(row('weibo'), row('jd', ok())))).toBeUndefined();
    expect(promoteTarget(image(row('weibo', gone()), row('jd', timeout())))).toBeUndefined();
  });

  it('看最新结果：重检刚发现主链接恢复了，就不再建议改用', () => {
    const entry = image(row('weibo', gone(), { recheckResult: ok() }), row('jd', ok()));
    expect(promoteTarget(entry)).toBeUndefined();
  });
});

describe('isLostForGood', () => {
  it('每一份都明确不在了（404 / 410）才算找不回；有一份只是超时就不算', () => {
    expect(isLostForGood(image(row('nami', gone())))).toBe(true);
    expect(isLostForGood(image(row('weibo', gone()), row('jd', gone())))).toBe(true);
    expect(isLostForGood(image(row('weibo', gone()), row('jd', timeout())))).toBe(false);
    expect(isLostForGood(image(row('weibo', gone()), row('jd')))).toBe(false);
    expect(isLostForGood(image(row('weibo', hotlink())))).toBe(false);
  });
});

describe('describeImage', () => {
  const text = (...rows: LinkCheckRow[]) => describeImage(image(...rows), nameOf).text;

  it('可修复：说清坏在哪、哪份备份能用', () => {
    expect(text(row('weibo', gone()), row('jd', ok()))).toBe('微博上的图已不存在，京东上的备份能用');
  });

  it('打不开：说清备份的情况', () => {
    expect(text(row('nami', gone()))).toBe('纳米上的图已不存在，没有备份');
    expect(text(row('weibo', gone()), row('jd', gone()))).toBe('微博上的图已不存在，备份也打不开');
    expect(text(row('weibo', gone()), row('jd'))).toBe('微博上的图已不存在，备份还没检查');
    expect(text(row('weibo', gone()), row('jd', hotlink()))).toBe('微博上的图已不存在，备份受限，浏览器里也许能看');
  });

  it('原因说白话；中文和英文图床名之间留空格', () => {
    expect(text(row('r2', timeout()))).toBe('Cloudflare R2 连接超时，没有备份');
    expect(text(row('github', bad({ error_type: 'network' })), row('jd', ok())))
      .toBe('GitHub 连不上，京东上的备份能用');
    expect(text(row('jd', bad({ error_type: 'http_5xx', status_code: 502 }))))
      .toBe('京东图床出故障了，没有备份');
    expect(text(row('jd', bad({ error_type: 'suspicious', status_code: 200 }))))
      .toBe('京东返回的不像是图片，没有备份');
    expect(text(row('jd', bad({ error_type: 'blocked' }))))
      .toBe('京东的链接被安全策略拦下，没有备份');
  });

  it('空格只补在图床名与前后文字的交界处，不改用户自己起的名字', () => {
    const entry = image(row('webdav:home', gone()), row('jd', ok()));
    const names = (id: string) => (id === 'webdav:home' ? '家里NAS盘' : nameOf(id));
    expect(describeImage(entry, names).text).toBe('家里NAS盘上的图已不存在，京东上的备份能用');

    const latinEnd = image(row('webdav:nas', gone()));
    expect(describeImage(latinEnd, (id) => (id === 'webdav:nas' ? '我的NAS' : nameOf(id))).text)
      .toBe('我的NAS 上的图已不存在，没有备份');
  });

  it('受限：告诉用户浏览器里多半能看', () => {
    expect(text(row('weibo', hotlink()))).toBe('微博限制了外站引用，浏览器里多半能正常显示');
    expect(text(row('weibo', redirect()))).toBe('微博的链接会跳转，浏览器里多半能正常显示');
  });

  it('备份失效：先说图能打开，再说哪份备份坏了', () => {
    expect(text(row('jd', ok()), row('weibo', gone()))).toBe('能正常打开，微博上的备份已失效');
    expect(text(row('jd', ok()), row('weibo', gone()), row('nami', timeout()))).toBe('能正常打开，2 个备份已失效');
  });

  it('正常：列出在哪些图床；只有一份时点明', () => {
    expect(text(row('jd', ok()))).toBe('能正常打开 · 只在京东上有一份');
    expect(text(row('jd', ok()), row('weibo', ok()))).toBe('能正常打开 · 京东、微博');
    expect(text(row('jd', ok()), row('weibo', ok()), row('qiyu', ok()), row('r2', ok()))).toBe('能正常打开 · 京东等 4 个图床');
  });

  it('没检查', () => {
    expect(text(row('jd'))).toBe('还没检查');
  });

  it('显示用最新结果：重检刚发现恢复了，就说能打开', () => {
    expect(text(row('weibo', gone(), { recheckResult: ok() }), row('jd', ok()))).toBe('能正常打开 · 微博、京东');
  });

  it('悬停详情逐份列出状态，标出在用的那份', () => {
    const detail = describeImage(image(row('weibo', gone()), row('jd', ok())), nameOf).detail;
    expect(detail).toContain('微博（在用）：不存在');
    expect(detail).toContain('京东：正常');
  });
});

describe('summarizeImages', () => {
  it('按类计数，并给出结论卡需要的其他数字', () => {
    const rows = [
      createLinkCheckRow({ historyId: 'fix', serviceId: 'weibo', isPrimary: true, checkResult: gone(), checkedAt: 100 }),
      createLinkCheckRow({ historyId: 'fix', serviceId: 'jd', checkResult: ok(), checkedAt: 300 }),
      createLinkCheckRow({ historyId: 'lost', serviceId: 'nami', isPrimary: true, checkResult: gone(), checkedAt: 200 }),
      createLinkCheckRow({ historyId: 'slow', serviceId: 'r2', isPrimary: true, checkResult: timeout() }),
      createLinkCheckRow({ historyId: 'fine', serviceId: 'jd', isPrimary: true, checkResult: ok() }),
      createLinkCheckRow({ historyId: 'new', serviceId: 'jd', isPrimary: true }),
      createLinkCheckRow({ historyId: 'new', serviceId: 'weibo' }),
    ];

    const summary = summarizeImages(groupRowsByImage(rows));

    expect(summary).toMatchObject({
      images: 5,
      links: 7,
      uncheckedLinks: 2,
      kinds: { fixable: 1, broken: 2, ok: 1, unchecked: 1, limited: 0, 'backup-broken': 0 },
      lostForGood: 1,
      singleCopy: 3,
      lastCheckedAt: 300,
    });
  });

  it('一次都没检查过 → lastCheckedAt 为 null', () => {
    const summary = summarizeImages(groupRowsByImage([createLinkCheckRow({ historyId: 'a', isPrimary: true })]));
    expect(summary.lastCheckedAt).toBeNull();
    expect(summary.kinds.unchecked).toBe(1);
  });
});
