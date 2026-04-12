import { computed, type Ref } from 'vue';
import type { HistoryItem } from '../../config/types';
import { getServiceDisplayName } from '../../constants/serviceNames';
import { formatFileSize, formatTime, getSuccessfulServices, truncateMiddle } from '../../utils/formatters';

export { formatFileSize, formatTime, truncateMiddle };

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

  return {
    displayFileName,
    successfulServicesText,
  };
}
