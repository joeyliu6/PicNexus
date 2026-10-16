// 「从 URL 下载」对话框的开关：投放区「⋯」、命令面板、第一次使用页都能打开它（对话框挂在首页）
import { ref } from 'vue';

const open = ref(false);

export function useUrlDialog() {
  return { open, show: () => { open.value = true; } };
}
