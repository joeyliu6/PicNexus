import { ref } from 'vue';

/** 全局上传状态（模块级单例），供 useUpload 和 useServiceAvailability 共享 */
export const isUploading = ref(false);
