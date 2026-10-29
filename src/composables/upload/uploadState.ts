import { computed, ref } from 'vue';

/** 进行中的上传次数（模块级单例）：每次拖入 / 粘贴 / 选文件各算一次，几次可以同时进行 */
export const activeUploads = ref(0);

/** 有没有上传在进行：useServiceAvailability 据此推迟定期检测 */
export const isUploading = computed(() => activeUploads.value > 0);
