import {
  createCheckLinkResult,
  createLinkCheckRow,
} from '../factories/linkCheckFactory';
import { imageUrls } from './images';

export const linkCheckRows = [
  createLinkCheckRow({
    historyId: 'hist-valid-jd',
    serviceId: 'jd',
    url: imageUrls.jd,
    rawUrl: imageUrls.jd,
    fileName: 'valid-jd.jpg',
    checkResult: createCheckLinkResult({
      link: imageUrls.jd,
      is_valid: true,
      error_type: 'success',
      status_code: 200,
    }),
  }),
  createLinkCheckRow({
    historyId: 'hist-broken-weibo',
    serviceId: 'weibo',
    url: imageUrls.weibo,
    rawUrl: imageUrls.weibo,
    fileName: 'broken-weibo.jpg',
    checkResult: createCheckLinkResult({
      link: imageUrls.weibo,
      is_valid: false,
      error_type: 'http_4xx',
      status_code: 403,
      error: 'Forbidden',
      browser_might_work: true,
    }),
  }),
  createLinkCheckRow({
    historyId: 'hist-timeout-r2',
    serviceId: 'r2',
    url: imageUrls.r2,
    rawUrl: imageUrls.r2,
    fileName: 'timeout-r2.jpg',
    checkResult: createCheckLinkResult({
      link: imageUrls.r2,
      is_valid: false,
      error_type: 'timeout',
      status_code: undefined,
      error: 'Timeout',
    }),
  }),
  createLinkCheckRow({
    historyId: 'hist-unchecked',
    serviceId: 'jd',
    url: imageUrls.broken,
    rawUrl: imageUrls.broken,
    fileName: 'unchecked.jpg',
  }),
];

export const selectedLinkCheckRows = linkCheckRows.slice(0, 2);
