// 「在图库中定位」（交接说明 8.1：命令面板选中图片按 Ctrl+Enter）：别处发起请求，图库显示时接手——
// 跳到那张图所在的那一天、选中它并打开详情。
import { shallowRef } from 'vue';

export interface LocateRequest {
  id: string;
  /** 上传时间：图库按它找到那一天，不必再查一次库 */
  timestamp: number;
}

/** 待处理的定位请求；图库接手后置空（每次请求都是新对象，同一张再定位一次也会触发） */
export const locateRequest = shallowRef<LocateRequest | null>(null);

export function requestLocate(id: string, timestamp: number): void {
  locateRequest.value = { id, timestamp };
}
