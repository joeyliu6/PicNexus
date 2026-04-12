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

  const successfulServices = computed(() => {
    if (!item.value) return [];
    return getSuccessfulServices(item.value);
  });

  const successfulServicesText = computed(() => {
    return successfulServices.value
      .map(serviceId => getServiceDisplayName(serviceId))
      .join('、');
  });

  return {
    displayFileName,
    successfulServices,
    successfulServicesText,
  };
}
