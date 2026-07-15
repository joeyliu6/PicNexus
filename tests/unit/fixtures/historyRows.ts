import { createHistoryItem, createHistoryResult, createLinkCheckStatusEntry } from '../factories/historyFactory';
import { imageUrls } from './images';

export const historyRows = [
  createHistoryItem({
    id: 'hist-valid-jd',
    localFileName: 'valid-jd.jpg',
    generatedLink: imageUrls.jd,
    linkCheckStatus: {
      jd: createLinkCheckStatusEntry(),
    },
  }),
  createHistoryItem({
    id: 'hist-broken-weibo',
    localFileName: 'broken-weibo.jpg',
    primaryService: 'weibo',
    results: [createHistoryResult({
      serviceId: 'weibo',
      result: {
        serviceId: 'weibo',
        fileKey: 'weibo-key',
        url: imageUrls.weibo,
        size: 2048,
      },
    })],
    generatedLink: imageUrls.weibo,
    linkCheckStatus: {
      weibo: createLinkCheckStatusEntry({
        isValid: false,
        statusCode: 403,
        errorType: 'http_4xx',
        error: 'Forbidden',
        browserMightWork: true,
      }),
    },
  }),
  createHistoryItem({
    id: 'hist-unchecked-r2',
    localFileName: 'unchecked-r2.jpg',
    primaryService: 'r2',
    results: [createHistoryResult({
      serviceId: 'r2',
      result: {
        serviceId: 'r2',
        fileKey: 'r2-key',
        url: imageUrls.r2,
        size: 4096,
      },
    })],
    generatedLink: imageUrls.r2,
  }),
];

export const favoriteHistoryRows = historyRows.map((row, index) => ({
  ...row,
  id: `favorite-${index + 1}`,
  isFavorited: true,
}));
