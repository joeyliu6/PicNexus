/**
 * useDebouncedTrue
 * 不对称 debounce：source=true 需持续 delayMs 才传递；source=false 立即传递。
 *
 * 用途：过滤短时 loading 状态。例如 layout 重算 < 300ms 时不闪 spinner，
 * 避免用户看到"闪一下就消失"的视觉噪音。
 */
import { ref, watch, onScopeDispose, type Ref } from 'vue';

export function useDebouncedTrue(source: Ref<boolean>, delayMs: number): Ref<boolean> {
  const out = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  watch(
    source,
    (v) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (v) {
        timer = setTimeout(() => {
          out.value = true;
          timer = null;
        }, delayMs);
      } else {
        out.value = false;
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  return out;
}
