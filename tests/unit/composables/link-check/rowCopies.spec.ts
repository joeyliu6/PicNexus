import { describe, expect, it } from 'vitest';
import { thumbnailCopyOrder } from '@/composables/link-check/rowCopies';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';

const ok = () => createCheckLinkResult({ is_valid: true });
const dead = () => createCheckLinkResult({ is_valid: false, error_type: 'http_5xx', status_code: 502 });

describe('thumbnailCopyOrder', () => {
  it('缩略图优先用能访问的副本，坏的垫底', () => {
    const self = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:a', checkResult: dead() });
    const deadSibling = createLinkCheckRow({ historyId: 'h', serviceId: 'webdav:b', checkResult: dead() });
    const unchecked = createLinkCheckRow({ historyId: 'h', serviceId: 'zhihu' });
    const alive = createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() });
    const order = thumbnailCopyOrder(self, [deadSibling, unchecked, alive]);
    expect(order.map((r) => r.serviceId)).toEqual(['jd', 'webdav:a', 'zhihu', 'webdav:b']);
  });

  it('单条重检刚拿到的结果优先于旧结果', () => {
    const self = createLinkCheckRow({ historyId: 'h', serviceId: 'weibo', checkResult: ok() });
    const recovered = createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: dead(), recheckResult: ok() });
    expect(thumbnailCopyOrder(self, [recovered]).map((r) => r.serviceId)).toEqual(['weibo', 'jd']);

    const brokeNow = createLinkCheckRow({ historyId: 'h', serviceId: 'weibo', checkResult: ok(), recheckResult: dead() });
    const alive = createLinkCheckRow({ historyId: 'h', serviceId: 'jd', checkResult: ok() });
    expect(thumbnailCopyOrder(brokeNow, [alive]).map((r) => r.serviceId)).toEqual(['jd', 'weibo']);
  });
});
