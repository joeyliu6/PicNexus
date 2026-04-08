import { computed, type Ref } from 'vue';
import type { HistoryItem } from '../../config/types';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { buildHistoryFailureLine } from '../../utils/uploadFailureMessage';
import { formatFileSize, formatTime, getSuccessfulServices, truncateMiddle } from '../../utils/formatters';

export { formatFileSize, formatTime, truncateMiddle };

function getFailedResults(item: HistoryItem) {
  return item.results.filter(r => r.status === 'failed');
}

export function useLightboxInfo(item: Ref<HistoryItem | null>) {
  const displayFileName = computed(() => {
    if (!item.value?.localFileName) return '';
    return truncateMiddle(item.value.localFileName);
  });

  const successfulServicesText = computed(() => {
    if (!item.value) return '';
    return getSuccessfulServices(item.value)
      .map(serviceId => getServiceDisplayName(serviceId))
      .join('、');
  });

  const failedResults = computed(() => {
    if (!item.value) return [];
    return getFailedResults(item.value);
  });

  const failedServicesText = computed(() =>
    failedResults.value
      .map(result => getServiceDisplayName(result.serviceId))
      .join('、'),
  );

  const failedServicesTooltip = computed(() =>
    failedResults.value
      .map(result =>
        buildHistoryFailureLine(
          getServiceDisplayName(result.serviceId),
          result.error,
          [result.serviceId],
        ),
      )
      .join('；'),
  );

  return {
    displayFileName,
    successfulServicesText,
    failedResults,
    failedServicesText,
    failedServicesTooltip,
  };
}
